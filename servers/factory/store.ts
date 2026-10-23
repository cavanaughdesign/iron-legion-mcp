import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Release,
  Issue,
  Job,
  Event,
  Artifact,
  Role,
  Plan,
  IssueStatus,
} from "./contracts.js";

export class FactoryStore {
  readonly db: Database.Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS factory_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory_releases(id TEXT PRIMARY KEY, project TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory_issues(id TEXT PRIMARY KEY, release_id TEXT NOT NULL REFERENCES factory_releases(id), key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, complexity TEXT NOT NULL, acceptance TEXT NOT NULL, depends_on TEXT NOT NULL, status TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, sendbacks INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0, feedback TEXT NOT NULL DEFAULT '', branch TEXT, worktree TEXT, head TEXT, pr INTEGER, github_issue INTEGER, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(release_id,key));
        CREATE TABLE IF NOT EXISTS factory_jobs(id TEXT PRIMARY KEY, issue_id TEXT REFERENCES factory_issues(id), release_id TEXT NOT NULL REFERENCES factory_releases(id), role TEXT NOT NULL, status TEXT NOT NULL, token TEXT NOT NULL, lease_until INTEGER NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, output TEXT NOT NULL DEFAULT '', head TEXT);
        CREATE UNIQUE INDEX IF NOT EXISTS factory_one_active_job ON factory_jobs(issue_id) WHERE status='running';
        CREATE UNIQUE INDEX IF NOT EXISTS factory_one_manager ON factory_jobs(release_id) WHERE status='running' AND role='manager';
        CREATE TABLE IF NOT EXISTS factory_events(id INTEGER PRIMARY KEY AUTOINCREMENT, release_id TEXT NOT NULL REFERENCES factory_releases(id), issue_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory_artifacts(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES factory_jobs(id), issue_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory_requests(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS factory_operations(key TEXT PRIMARY KEY, status TEXT NOT NULL, result TEXT, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS factory_release_events ON factory_events(release_id,id);
        CREATE INDEX IF NOT EXISTS factory_queue ON factory_issues(release_id,status,priority);
        INSERT OR IGNORE INTO factory_migrations VALUES(1,datetime('now'));
      `);
    })();
  }
  close() {
    this.db.close();
  }
  beginOperation(
    key: string,
  ): { replay: true; result: any } | { replay: false } {
    return this.atomic(() => {
      const row = this.db
        .prepare("SELECT status,result FROM factory_operations WHERE key=?")
        .get(key) as { status: string; result: string } | undefined;
      if (row?.status === "completed")
        return { replay: true, result: JSON.parse(row.result) };
      if (row)
        throw new Error(
          "An external operation is active or uncertain. Reconcile it before retrying.",
        );
      this.db
        .prepare("INSERT INTO factory_operations VALUES(?,'running',NULL,?)")
        .run(key, new Date().toISOString());
      return { replay: false };
    });
  }
  endOperation(key: string, result: unknown) {
    this.db
      .prepare(
        "UPDATE factory_operations SET status='completed',result=?,updated_at=? WHERE key=?",
      )
      .run(JSON.stringify(result), new Date().toISOString(), key);
  }
  uncertainOperation(key: string) {
    this.db
      .prepare(
        "UPDATE factory_operations SET status='uncertain',updated_at=? WHERE key=?",
      )
      .run(new Date().toISOString(), key);
  }
  clearOperation(key: string) {
    this.db.prepare("DELETE FROM factory_operations WHERE key=?").run(key);
  }
  reconcileOperations(issueId: string) {
    this.db
      .prepare(
        "DELETE FROM factory_operations WHERE key=? AND status!='completed'",
      )
      .run(`issue:${issueId}`);
    for (const kind of ["pr", "merge"])
      this.db
        .prepare(
          "DELETE FROM factory_operations WHERE key LIKE ? AND status!='completed'",
        )
        .run(`${kind}:${issueId}:%`);
  }
  atomic<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
  releases(): Release[] {
    return this.db
      .prepare(
        "SELECT * FROM factory_releases ORDER BY created_at DESC, rowid DESC LIMIT 100",
      )
      .all() as Release[];
  }
  release(id: string): Release {
    const r = this.db
      .prepare("SELECT * FROM factory_releases WHERE id=?")
      .get(id) as Release | undefined;
    if (!r) throw new Error("Release not found.");
    return r;
  }
  issues(releaseId: string): Issue[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM factory_issues WHERE release_id=? ORDER BY priority DESC,rowid",
        )
        .all(releaseId) as any[]
    ).map(decode);
  }
  issue(id: string): Issue {
    const i = this.db
      .prepare("SELECT * FROM factory_issues WHERE id=?")
      .get(id);
    if (!i) throw new Error("Issue not found.");
    return decode(i);
  }
  patch(id: string, patch: Partial<Issue>, revision?: number): Issue {
    const allowed = new Set([
      "status",
      "tries",
      "sendbacks",
      "priority",
      "feedback",
      "branch",
      "worktree",
      "head",
      "pr",
      "github_issue",
    ]);
    const pairs = Object.entries(patch).filter(([k]) => allowed.has(k));
    const result = this.db
      .prepare(
        `UPDATE factory_issues SET ${pairs.map(([k]) => `${k}=?`).join(",")}${pairs.length ? "," : ""} revision=revision+1,updated_at=? WHERE id=?${revision === undefined ? "" : " AND revision=?"}`,
      )
      .run(
        ...pairs.map(([, v]) => v),
        new Date().toISOString(),
        id,
        ...(revision === undefined ? [] : [revision]),
      );
    if (!result.changes)
      throw new Error("The issue changed. Refresh before trying again.");
    return this.issue(id);
  }
  setRelease(id: string, status: Release["status"]) {
    this.release(id);
    this.db
      .prepare("UPDATE factory_releases SET status=? WHERE id=?")
      .run(status, id);
    this.event(id, null, `release.${status}`, `Release ${status}.`);
  }
  event(release: string, issue: string | null, kind: string, detail: string) {
    this.db
      .prepare(
        "INSERT INTO factory_events(release_id,issue_id,kind,detail,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        release,
        issue,
        kind,
        detail.slice(0, 16000),
        new Date().toISOString(),
      );
  }
  events(release: string, after = 0): Event[] {
    return this.db
      .prepare(
        "SELECT * FROM (SELECT * FROM factory_events WHERE release_id=? AND id>? ORDER BY id DESC LIMIT 200) ORDER BY id",
      )
      .all(release, after) as Event[];
  }
  jobs(release: string): Job[] {
    return this.db
      .prepare(
        "SELECT * FROM factory_jobs WHERE release_id=? ORDER BY started_at DESC LIMIT 200",
      )
      .all(release) as Job[];
  }
  jobCount(release: string): number {
    return (
      this.db
        .prepare("SELECT count(*) AS n FROM factory_jobs WHERE release_id=?")
        .get(release) as { n: number }
    ).n;
  }
  evaluations(issue: string): Job[] {
    return this.db
      .prepare(
        "SELECT * FROM factory_jobs WHERE issue_id=? AND status='completed' AND role IN ('validator','reviewer')",
      )
      .all(issue) as Job[];
  }
  lastEvent(release: string, kind: string): Event | undefined {
    return this.db
      .prepare(
        "SELECT * FROM factory_events WHERE release_id=? AND kind=? ORDER BY id DESC LIMIT 1",
      )
      .get(release, kind) as Event | undefined;
  }
  running(): Job[] {
    return this.db
      .prepare("SELECT * FROM factory_jobs WHERE status='running'")
      .all() as Job[];
  }
  artifacts(release: string): Omit<Artifact, "content">[] {
    return this.db
      .prepare(
        "SELECT a.id,a.job_id,a.issue_id,a.kind,a.name,a.created_at FROM factory_artifacts a JOIN factory_jobs j ON j.id=a.job_id WHERE j.release_id=? ORDER BY a.rowid DESC LIMIT 100",
      )
      .all(release) as any;
  }
  artifact(id: string): Artifact {
    const a = this.db
      .prepare("SELECT * FROM factory_artifacts WHERE id=?")
      .get(id) as Artifact | undefined;
    if (!a) throw new Error("Artifact not found.");
    return a;
  }
  publicArtifact(id: string): Artifact {
    const artifact = this.artifact(id);
    const job = this.db
      .prepare("SELECT role FROM factory_jobs WHERE id=?")
      .get(artifact.job_id) as { role: string };
    if (job.role === "validator")
      throw new Error(
        "Independent validation artifacts are available through the interactive App only.",
      );
    return artifact;
  }
  addArtifact(job: Job, kind: string, name: string, content: string) {
    this.db
      .prepare("INSERT INTO factory_artifacts VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        job.id,
        job.issue_id,
        kind,
        name,
        content.slice(0, 160000),
        new Date().toISOString(),
      );
  }
  once<T>(id: string, fingerprint: string, fn: () => T): T {
    return this.atomic(() => {
      const old = this.db
        .prepare("SELECT * FROM factory_requests WHERE id=?")
        .get(id) as any;
      if (old) {
        if (old.fingerprint !== fingerprint)
          throw new Error(
            "Request ID was already used for a different action.",
          );
        return JSON.parse(old.result);
      }
      const result = fn();
      this.db
        .prepare("INSERT INTO factory_requests VALUES(?,?,?)")
        .run(id, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  create(project: string, plan: Plan): Release {
    if (
      this.releases().some(
        (r) =>
          r.project === project &&
          !["completed", "cancelled"].includes(r.status),
      )
    )
      throw new Error("Finish or cancel this project's active release first.");
    const r: Release = {
      id: randomUUID(),
      project,
      ...plan.release,
      status: "draft",
      created_at: new Date().toISOString(),
    };
    this.db
      .prepare(
        "INSERT INTO factory_releases VALUES(@id,@project,@name,@type,@goal,@status,@created_at)",
      )
      .run(r);
    plan.issues.forEach((i) => this.addIssue(r.id, i));
    this.event(r.id, null, "release.created", r.goal);
    return r;
  }
  addIssue(release: string, i: Plan["issues"][number], priority = 0): Issue {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO factory_issues(id,release_id,key,title,body,complexity,acceptance,depends_on,status,priority,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        release,
        i.key,
        i.title,
        i.body,
        i.complexity,
        JSON.stringify(i.acceptance),
        JSON.stringify(i.depends_on),
        i.depends_on.length ? "backlog" : "ready",
        priority,
        new Date().toISOString(),
      );
    this.event(release, id, "issue.created", i.title);
    return this.issue(id);
  }
  promote(release: string) {
    const issues = this.issues(release),
      done = new Set(
        issues.filter((i) => i.status === "merged").map((i) => i.key),
      );
    for (const i of issues)
      if (i.status === "backlog" && i.depends_on.every((d) => done.has(d)))
        this.patch(i.id, { status: "ready" });
    if (
      issues.length &&
      issues.every((i) => ["merged", "dropped"].includes(i.status))
    )
      this.setRelease(release, "completed");
  }
  claim(release: string, role: Role, issue?: Issue, duration = 120000): Job {
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      issue_id: issue?.id ?? null,
      release_id: release,
      role,
      status: "running",
      token: randomUUID(),
      lease_until: Date.now() + duration,
      started_at: now,
      finished_at: null,
      output: "",
      head: issue?.head ?? null,
    };
    this.db
      .prepare(
        "INSERT INTO factory_jobs VALUES(@id,@issue_id,@release_id,@role,@status,@token,@lease_until,@started_at,@finished_at,@output,@head)",
      )
      .run(job);
    if (issue && role === "builder")
      this.patch(issue.id, { status: "claimed", tries: issue.tries + 1 });
    this.event(release, issue?.id ?? null, "job.started", `${role} started.`);
    return job;
  }
  heartbeat(job: Job): boolean {
    return (
      this.db
        .prepare(
          "UPDATE factory_jobs SET lease_until=? WHERE id=? AND token=? AND status='running'",
        )
        .run(Date.now() + 120000, job.id, job.token).changes === 1
    );
  }
  finish(job: Job, status: string, output: string, head?: string): boolean {
    return (
      this.db
        .prepare(
          "UPDATE factory_jobs SET status=?,output=?,finished_at=?,head=COALESCE(?,head) WHERE id=? AND token=? AND status='running'",
        )
        .run(
          status,
          output.slice(-24000),
          new Date().toISOString(),
          head ?? null,
          job.id,
          job.token,
        ).changes === 1
    );
  }
  fail(issue: Issue, note: string, sendback = false) {
    const count = issue.sendbacks + (sendback ? 1 : 0);
    const escalated = sendback ? count > 2 : issue.tries >= 3;
    this.patch(issue.id, {
      status: escalated ? "needs_human" : "ready",
      feedback: note,
      sendbacks: count,
      priority: 10,
      head: null,
    });
    this.event(
      issue.release_id,
      issue.id,
      escalated ? "issue.escalated" : "issue.requeued",
      note,
    );
  }
}
function decode(value: any): Issue {
  return {
    ...value,
    acceptance: JSON.parse(value.acceptance),
    depends_on: JSON.parse(value.depends_on),
  };
}
