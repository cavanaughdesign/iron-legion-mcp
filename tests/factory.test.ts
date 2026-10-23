import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { FactoryStore } from "../servers/factory/store.js";
import { FactoryService } from "../servers/factory/service.js";
import {
  validatePlan,
  configSchema,
  actionSchema,
  type Plan,
  type Job,
  type Project,
  type Issue,
} from "../servers/factory/contracts.js";
import { git, run } from "../servers/factory/process.js";
import { inside } from "../servers/factory/config.js";
import { startDashboard } from "../servers/factory/http.js";
import { GitHub, repositoryFromRemote } from "../servers/factory/github.js";

const roots: string[] = [],
  stores: FactoryStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const plan = (): Plan => ({
  release: {
    name: "Release",
    type: "brownfield",
    goal: "A user can use the feature.",
  },
  issues: [
    {
      key: "schema",
      title: "Schema",
      body: "",
      complexity: "complex",
      acceptance: ["Migration works"],
      depends_on: [],
    },
    {
      key: "api",
      title: "API",
      body: "",
      complexity: "simple",
      acceptance: ["API works"],
      depends_on: ["schema"],
    },
    {
      key: "copy",
      title: "Copy",
      body: "",
      complexity: "simple",
      acceptance: ["Copy works"],
      depends_on: [],
    },
  ],
});
const store = (path = ":memory:") => {
  const s = new FactoryStore(path);
  stores.push(s);
  return s;
};
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), "iron-factory-test-"));
  roots.push(root);
  return root;
};
const mockExecutor = {
  execute: async (p: Project, j: Job, i: Issue | undefined) => ({
    result: {
      verdict: "pass" as const,
      summary: `${j.role} passed`,
      artifacts: [],
    },
    output: "",
    worktree: p.root,
    head: i?.head ?? "abc123",
    diff: "",
  }),
};
function setup() {
  const s = store(),
    root = temp(),
    config = configSchema.parse({
      projects: [
        {
          id: "test",
          name: "Test",
          root,
          executors: {
            builder: { executable: "node" },
            validator: { executable: "node" },
            reviewer: { executable: "node" },
          },
          checks: [{ executable: "node", args: ["--test"] }],
        },
      ],
    });
  const svc = new FactoryService(s, config, root, mockExecutor);
  return { s, svc, root, config };
}
const release = (s: FactoryStore) => s.atomic(() => s.create("test", plan()));
describe("factory planning and atomic persistence", () => {
  it("allows generic holdout tooling requirements without private scenario references", () => {
    const p = plan();
    p.issues[0].title = "Add holdout isolation tooling";
    expect(validatePlan(p).issues[0].title).toContain("holdout");
  });
  it("validates parallel dependency waves", () =>
    expect(validatePlan(plan()).waves).toEqual([["schema", "copy"], ["api"]]));
  it("rejects cycles", () => {
    const p = plan();
    p.issues[0].depends_on = ["api"];
    expect(() => validatePlan(p)).toThrow("cycle");
  });
  it("rejects unknown dependencies", () => {
    const p = plan();
    p.issues[0].depends_on = ["missing"];
    expect(() => validatePlan(p)).toThrow("dependency");
  });
  it("rejects duplicate keys", () => {
    const p = plan();
    p.issues[1].key = "schema";
    expect(() => validatePlan(p)).toThrow("Duplicate");
  });
  it("rejects private scenario references in public issues", () => {
    const p = plan();
    p.issues[0].body = "Check HS-001";
    expect(() => validatePlan(p)).toThrow("private");
  });
  it("rejects empty acceptance criteria", () => {
    const p = plan();
    p.issues[0].acceptance = [];
    expect(() => validatePlan(p)).toThrow();
  });
  it("rejects extra command fields", () =>
    expect(() =>
      actionSchema.parse({
        action: "pause",
        releaseId: randomUUID(),
        shell: "delete",
      }),
    ).toThrow());
  it("enforces unique active releases per project", () => {
    const s = store();
    release(s);
    expect(() => release(s)).toThrow("active release");
  });
  it("rolls back partially inserted releases", () => {
    const s = store(),
      p = plan();
    p.issues[1].key = "schema";
    expect(() => s.atomic(() => s.create("test", p))).toThrow();
    expect(s.releases()).toHaveLength(0);
  });
  it("replays identical requests and refuses request-id reuse", () => {
    const s = store(),
      id = randomUUID();
    const first = s.once(id, "same", () => release(s));
    expect(
      s.once(id, "same", () => {
        throw Error();
      }),
    ).toEqual(first);
    expect(() => s.once(id, "other", () => null)).toThrow("different");
  });
  it("persists through reopen and migration reruns", () => {
    const path = join(temp(), "factory.db"),
      s = new FactoryStore(path),
      r = release(s);
    s.close();
    const reopened = store(path);
    expect(reopened.release(r.id).name).toBe("Release");
    expect(reopened.issues(r.id)).toHaveLength(3);
  });
  it("rejects stale revisions", () => {
    const s = store(),
      r = release(s),
      i = s.issues(r.id)[0];
    s.patch(i.id, { priority: 4 }, i.revision);
    expect(() => s.patch(i.id, { priority: 8 }, i.revision)).toThrow("changed");
  });
  it("prevents duplicate concurrent claims across connections", () => {
    const path = join(temp(), "factory.db"),
      s = store(path),
      other = store(path),
      r = release(s),
      i = s.issues(r.id)[0];
    s.atomic(() => s.claim(r.id, "builder", i));
    expect(() => other.atomic(() => other.claim(r.id, "builder", i))).toThrow();
    expect(s.running()).toHaveLength(1);
  });
  it("fences a completed worker from writing again", () => {
    const s = store(),
      r = release(s),
      j = s.claim(r.id, "builder", s.issues(r.id)[0]);
    expect(s.finish(j, "completed", "ok")).toBe(true);
    expect(s.finish(j, "failed", "late")).toBe(false);
    expect(s.heartbeat(j)).toBe(false);
  });
  it("does not confuse adjacent directories with containment", () => {
    expect(inside(resolve("/a"), resolve("/ab"))).toBe(false);
    expect(inside(resolve("/a"), resolve("/a/b"))).toBe(true);
  });
});
describe("factory hard rules and lifecycle", () => {
  it("escalates the third failed implementation attempt", () => {
    const s = store(),
      r = release(s);
    let i = s.issues(r.id)[0];
    for (let n = 1; n <= 3; n++) {
      const j = s.claim(r.id, "builder", s.issue(i.id));
      s.finish(j, "failed", "failure");
      s.fail(s.issue(i.id), "failure");
      expect(s.issue(i.id).status).toBe(n === 3 ? "needs_human" : "ready");
    }
    expect(s.issue(i.id).tries).toBe(3);
  });
  it("allows two review send-backs and escalates on the third", () => {
    const s = store(),
      r = release(s),
      i = s.issues(r.id)[0];
    for (let n = 1; n <= 3; n++) {
      s.patch(i.id, { status: "in_review" });
      s.fail(s.issue(i.id), "fix", true);
      expect(s.issue(i.id).status).toBe(n === 3 ? "needs_human" : "ready");
    }
    expect(s.issue(i.id).sendbacks).toBe(3);
  });
  it("parks expired claims instead of redispatching an uncertain writer", () => {
    const { s, svc } = setup(),
      r = release(s),
      i = s.issues(r.id)[0],
      j = s.claim(r.id, "builder", i, -1);
    svc.recover();
    expect(s.issue(i.id).status).toBe("needs_human");
    expect(s.jobs(r.id)[0].status).toBe("uncertain");
    expect(s.finish(j, "completed", "late")).toBe(false);
  });
  it("keeps dependent issues blocked until their dependency merges", () => {
    const s = store(),
      r = release(s),
      schema = s.issues(r.id).find((i) => i.key === "schema")!,
      api = s.issues(r.id).find((i) => i.key === "api")!;
    s.promote(r.id);
    expect(s.issue(api.id).status).toBe("backlog");
    s.patch(schema.id, { status: "dropped" });
    s.promote(r.id);
    expect(s.issue(api.id).status).toBe("backlog");
    s.patch(schema.id, { status: "merged" });
    s.promote(r.id);
    expect(s.issue(api.id).status).toBe("ready");
  });
  it("requires a human note and current revision to resolve escalation", async () => {
    const { s, svc } = setup(),
      r = release(s),
      i = s.issues(r.id)[0];
    s.patch(i.id, { status: "needs_human", tries: 3 });
    await expect(
      svc.control({
        action: "resolve",
        issueId: i.id,
        revision: i.revision,
        decision: "retry",
        note: "Try a different approach",
      }),
    ).rejects.toThrow("changed");
    const current = s.issue(i.id);
    await svc.control({
      action: "resolve",
      issueId: i.id,
      revision: current.revision,
      decision: "retry",
      note: "Use a migration",
    });
    expect(s.issue(i.id)).toMatchObject({
      status: "ready",
      tries: 0,
      sendbacks: 0,
      feedback: "Use a migration",
    });
  });
  it("cancellation fences active jobs and preserves merged work", async () => {
    const { s, svc } = setup(),
      r = release(s),
      [i, , copy] = s.issues(r.id);
    s.setRelease(r.id, "running");
    s.patch(copy.id, { status: "merged" });
    const j = s.claim(r.id, "builder", i);
    await svc.control({ action: "cancel", releaseId: r.id });
    expect(s.release(r.id).status).toBe("cancelled");
    expect(s.issue(copy.id).status).toBe("merged");
    expect(s.finish(j, "completed", "late")).toBe(false);
  });
  it("does not dispatch while paused", async () => {
    const { s, svc } = setup(),
      r = release(s);
    s.setRelease(r.id, "paused");
    await svc.tick();
    expect(s.running()).toHaveLength(0);
  });
  it("runs independent roles and respects the dependency queue", async () => {
    const { s, svc } = setup(),
      r = release(s);
    s.setRelease(r.id, "running");
    for (let n = 0; n < 12; n++) {
      await svc.tick();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(s.issues(r.id).filter((i) => i.status === "approved")).toHaveLength(
      2,
    );
    expect(s.issues(r.id).find((i) => i.key === "api")?.status).toBe("backlog");
    expect(new Set(s.jobs(r.id).map((j) => j.role))).toEqual(
      new Set(["builder", "validator", "reviewer"]),
    );
    await svc.stop();
  });
  it("rejects merging unreviewed candidates", async () => {
    const { s, svc } = setup(),
      r = release(s),
      i = s.issues(r.id)[0];
    s.setRelease(r.id, "running");
    s.patch(i.id, { status: "approved", head: "abc" });
    await expect(svc.merge(s.issue(i.id))).rejects.toThrow("Independent");
  });
  it("reopens completed releases for feedback and prioritizes regressions", async () => {
    const { s, svc } = setup(),
      r = release(s);
    s.setRelease(r.id, "completed");
    const command = {
      action: "feedback",
      releaseId: r.id,
      requestId: randomUUID(),
      severity: "regression",
      issue: { ...plan().issues[0], key: "regression" },
    };
    const a: any = await svc.control(command),
      b: any = await svc.control(command);
    expect(a.id).toBe(b.id);
    expect(s.issue(a.id).priority).toBe(30);
    expect(s.release(r.id).status).toBe("paused");
  });
  it("requires all execution roles and checks before start", async () => {
    const { s, root, config } = setup();
    await git(root, ["init", "-b", "main"]);
    writeFileSync(join(root, "a"), "a");
    await git(root, ["add", "."]);
    await git(root, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-m",
      "init",
    ]);
    config.projects[0].checks = [];
    const svc = new FactoryService(s, config, root, mockExecutor),
      r = release(s);
    await expect(
      svc.control({ action: "start", releaseId: r.id }),
    ).rejects.toThrow("meaningful");
  });
});
describe("GitHub commit and CI boundary", () => {
  it("normalizes only explicit GitHub repository remotes", () => {
    expect(repositoryFromRemote("git@github.com:Owner/Repo.git")).toBe(
      "owner/repo",
    );
    expect(repositoryFromRemote("https://github.com/owner/repo.git")).toBe(
      "owner/repo",
    );
    expect(() =>
      repositoryFromRemote("https://other.example/owner/repo"),
    ).toThrow("GitHub");
  });
  const project = configSchema.parse({
    projects: [
      { id: "test", name: "Test", root: "/tmp", github: "owner/repo" },
    ],
  }).projects[0];
  const issue = { pr: 12, head: "abc", status: "approved" } as Issue;
  const make = (overrides: any = {}) => {
    const gh = new GitHub();
    const calls: any[] = [];
    gh.gh = async (_p, args) => {
      calls.push(args);
      return JSON.stringify({
        headRefOid: "abc",
        baseRefName: "main",
        state: calls.some((a) => a[1] === "merge") ? "MERGED" : "OPEN",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        statusCheckRollup: [
          {
            __typename: "CheckRun",
            status: "COMPLETED",
            conclusion: "SUCCESS",
          },
        ],
        url: "https://github.com/owner/repo/pull/12",
        ...overrides,
      });
    };
    return { gh, calls };
  };
  it("rejects zero CI checks", async () => {
    const { gh, calls } = make({ statusCheckRollup: [] });
    await expect(gh.merge(project, issue)).rejects.toThrow("CI green");
    expect(calls.some((a) => a[1] === "merge")).toBe(false);
  });
  it("rejects failed, pending, and skipped checks", async () => {
    for (const conclusion of ["FAILURE", "SKIPPED", null]) {
      const { gh } = make({
        statusCheckRollup: [
          { __typename: "CheckRun", status: "COMPLETED", conclusion },
        ],
      });
      await expect(gh.merge(project, issue)).rejects.toThrow("CI green");
    }
  });
  it("rejects a changed candidate SHA", async () => {
    const { gh } = make({ headRefOid: "changed" });
    await expect(gh.merge(project, issue)).rejects.toThrow("changed");
  });
  it("rejects stale base and merge conflicts", async () => {
    const { gh } = make({ mergeStateStatus: "DIRTY" });
    await expect(gh.merge(project, issue)).rejects.toThrow("mergeable");
  });
  it("matches the reviewed head when merging and confirms completion", async () => {
    const { gh, calls } = make();
    await expect(gh.merge(project, issue)).resolves.toMatchObject({
      head: "abc",
    });
    expect(calls.find((a) => a[1] === "merge")).toContain(
      "--match-head-commit",
    );
  });
  it("reconciles a previously merged candidate without merging twice", async () => {
    const { gh, calls } = make({ state: "MERGED" });
    await gh.merge(project, issue);
    expect(calls).toHaveLength(1);
  });
});
describe("local HTTP authorization", () => {
  it("requires a single-use session and rejects cross-origin writes", async () => {
    const { svc } = setup(),
      dashboard = await startDashboard(svc);
    try {
      expect((await fetch(dashboard.origin + "/api/snapshot")).status).toBe(
        401,
      );
      const token = new URL(dashboard.url()).hash.slice("#session=".length);
      const session = await fetch(dashboard.origin + "/api/session", {
        method: "POST",
        headers: {
          Origin: dashboard.origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });
      expect(session.status).toBe(200);
      const cookie = session.headers.get("set-cookie")!.split(";")[0];
      expect(
        (
          await fetch(dashboard.origin + "/api/snapshot", {
            headers: { Cookie: cookie },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(dashboard.origin + "/api/session", {
            method: "POST",
            headers: { Origin: dashboard.origin },
            body: JSON.stringify({ token }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(dashboard.origin + "/api/control", {
            method: "POST",
            headers: {
              Cookie: cookie,
              Origin: "https://evil.example",
              "Content-Type": "application/json",
            },
            body: "{}",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(dashboard.origin + "/package.json", {
            headers: { Cookie: cookie },
          })
        ).status,
      ).toBe(404);
      expect(dashboard.server.address()).toMatchObject({
        address: "127.0.0.1",
      });
    } finally {
      await dashboard.close();
    }
  });
});
describe("bounded processes", () => {
  it("terminates a timed-out process", async () => {
    await expect(
      run(
        {
          executable: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
          timeoutSeconds: 1,
        },
        process.cwd(),
      ),
    ).rejects.toThrow("exceeded");
  }, 10000);
  it("terminates cancelled processes", async () => {
    const c = new AbortController();
    const promise = run(
      {
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
        timeoutSeconds: 10,
      },
      process.cwd(),
      { signal: c.signal },
    );
    setTimeout(() => c.abort(), 100);
    await expect(promise).rejects.toThrow("cancelled");
  }, 10000);
  it("does not inherit arbitrary parent secrets", async () => {
    process.env.IRON_LEGION_TEST_SECRET = "never-forward";
    try {
      const r = await run(
        {
          executable: process.execPath,
          args: [
            "-e",
            "process.stdout.write(process.env.IRON_LEGION_TEST_SECRET||'absent')",
          ],
          timeoutSeconds: 5,
        },
        process.cwd(),
      );
      expect(r.output).toBe("absent");
    } finally {
      delete process.env.IRON_LEGION_TEST_SECRET;
    }
  });
});
describe("durable operation recovery and private evidence", () => {
  it("serializes external side effects and replays confirmed results", () => {
    const s = store(),
      r = release(s),
      id = s.issues(r.id)[0].id,
      key = `issue:${id}`;
    expect(s.beginOperation(key)).toEqual({ replay: false });
    expect(() => s.beginOperation(key)).toThrow("active or uncertain");
    s.endOperation(key, 42);
    expect(s.beginOperation(key)).toEqual({ replay: true, result: 42 });
  });
  it("requires explicit reconciliation for uncertain side effects", () => {
    const s = store(),
      r = release(s),
      id = s.issues(r.id)[0].id,
      key = `pr:${id}:abc`;
    s.beginOperation(key);
    s.uncertainOperation(key);
    expect(() => s.beginOperation(key)).toThrow("uncertain");
    s.reconcileOperations(id);
    expect(s.beginOperation(key)).toEqual({ replay: false });
  });
  it("keeps validator artifacts off the model-readable artifact endpoint", () => {
    const s = store(),
      r = release(s),
      i = s.issues(r.id)[0],
      j = s.claim(r.id, "validator", i);
    s.addArtifact(
      j,
      "report",
      "Private evaluation",
      "Private scenario evidence.",
    );
    const a = s.artifacts(r.id)[0];
    expect(() => s.publicArtifact(a.id)).toThrow("interactive App");
    expect(s.artifact(a.id).content).toContain("Private scenario");
  });
  it("pauses dispatch when the configured execution budget is exhausted", async () => {
    const { s, svc, config } = setup(),
      r = release(s);
    config.maxJobsPerRelease = 3;
    s.setRelease(r.id, "running");
    for (let n = 0; n < 12; n++) {
      await svc.tick();
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(s.release(r.id).status).toBe("paused");
    expect(s.jobCount(r.id)).toBe(3);
    await svc.stop();
  });
});
