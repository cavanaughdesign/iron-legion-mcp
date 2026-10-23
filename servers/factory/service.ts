import { join } from "node:path";
import { readdir, readFile, realpath } from "node:fs/promises";
import { FactoryStore } from "./store.js";
import {
  actionSchema,
  validatePlan,
  type Config,
  type Project,
  type Issue,
  type Job,
  type Action,
} from "./contracts.js";
import { CommandExecutor, type Executor } from "./executor.js";
import {
  GitHub,
  CandidateChangedError,
  MergeBlockedError,
  repositoryFromRemote,
} from "./github.js";
import { git } from "./process.js";
import { inside } from "./config.js";

export class FactoryService {
  private active = new Map<string, AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private stopping = false;
  constructor(
    readonly store: FactoryStore,
    readonly config: Config,
    readonly home: string,
    private executor: Executor = new CommandExecutor(),
    private github: GitHub = new GitHub(),
  ) {}
  project(id: string): Project {
    const p = this.config.projects.find((p) => p.id === id);
    if (!p)
      throw new Error(
        "Project is not configured. Add it to the local configuration first.",
      );
    return p;
  }
  snapshot(releaseId?: string) {
    const releases = this.store.releases(),
      selected = releaseId ?? releases[0]?.id;
    if (selected) this.store.release(selected);
    return {
      version: "1.0.0",
      releases,
      selected: selected ?? null,
      projects: this.config.projects.map((p) => ({
        id: p.id,
        name: p.name,
        root: p.root,
        baseBranch: p.baseBranch,
        github: p.github,
        autoMerge: p.autoMerge,
        isolation: p.isolation,
        holdouts: !!p.holdouts,
        checks: p.checks.length,
        roles: Object.keys(p.executors),
        previewUrl: p.previewUrl,
      })),
      issues: selected ? this.store.issues(selected) : [],
      jobs: selected
        ? this.store
            .jobs(selected)
            .map((j) => ({ ...j, token: undefined, output: clean(j.output) }))
        : [],
      events: selected ? this.store.events(selected) : [],
      artifacts: selected ? this.store.artifacts(selected) : [],
      health: {
        worker: !!this.timer,
        concurrency: this.config.concurrency,
        active: this.store.running().length,
        configured: this.config.projects.length > 0,
        maxJobsPerRelease: this.config.maxJobsPerRelease,
      },
    };
  }
  async control(input: unknown) {
    const a = actionSchema.parse(input);
    if (a.action === "read_artifact") return this.store.artifact(a.artifactId);
    if (this.stopping) throw new Error("Factory is shutting down.");
    if (a.action === "create_release") {
      const p = this.project(a.project),
        plan = validatePlan(a.plan);
      await this.assertProject(p);
      await this.assertNoPrivateTitles(p, JSON.stringify(plan.issues));
      return this.store.once(a.requestId, JSON.stringify(a), () =>
        this.store.create(p.id, plan),
      );
    }
    if (a.action === "feedback") {
      const r = this.store.release(a.releaseId);
      if (["cancelled", "draft"].includes(r.status))
        throw new Error("Feedback requires a started release.");
      await this.assertNoPrivateTitles(
        this.project(r.project),
        JSON.stringify(a.issue),
      );
      return this.feedback(a);
    }
    if (a.action === "resolve")
      return this.store.atomic(() => {
        const issue = this.store.issue(a.issueId);
        if (issue.status !== "needs_human")
          throw new Error("Only escalated issues can be resolved.");
        if (this.store.release(issue.release_id).status === "cancelled")
          throw new Error("Release is cancelled.");
        if (
          a.decision === "retry" &&
          issue.depends_on.some(
            (d) =>
              this.store.issues(issue.release_id).find((i) => i.key === d)
                ?.status !== "merged",
          )
        )
          throw new Error("Dependencies must be merged before retrying.");
        this.store.patch(
          issue.id,
          {
            status: a.decision === "drop" ? "dropped" : "ready",
            tries: 0,
            sendbacks: 0,
            priority: 20,
            feedback: a.note,
            head: null,
          },
          a.revision,
        );
        this.store.reconcileOperations(issue.id);
        this.store.event(issue.release_id, issue.id, "human.resolved", a.note);
        this.store.promote(issue.release_id);
        return this.store.issue(issue.id);
      });
    if (a.action === "merge") {
      const issue = this.store.issue(a.issueId);
      if (issue.revision !== a.revision)
        throw new Error("The issue changed. Refresh before merging.");
      return this.merge(issue);
    }
    const release = this.store.release(a.releaseId),
      project = this.project(release.project);
    switch (a.action) {
      case "start":
      case "resume": {
        if (
          !(a.action === "start"
            ? release.status === "draft"
            : release.status === "paused")
        )
          throw new Error("Release cannot start from its current state.");
        await this.assertProject(project);
        if (
          !["builder", "validator", "reviewer"].every(
            (r) => !!project.executors[r as keyof typeof project.executors],
          )
        )
          throw new Error(
            "Configure Builder, Validator, and Reviewer executors before starting.",
          );
        if (!project.checks.length)
          throw new Error("Configure at least one meaningful project check.");
        if (this.store.jobCount(release.id) >= this.config.maxJobsPerRelease)
          throw new Error(
            "Execution budget exhausted. Review the release and increase maxJobsPerRelease in local configuration if appropriate.",
          );
        if (project.holdouts) {
          const files = await readdir(project.holdouts);
          if (!files.some((f) => f.endsWith(".md")))
            throw new Error("Write private scenarios before starting.");
        }
        this.store.atomic(() => {
          const current = this.store.release(release.id);
          if (current.status !== release.status)
            throw new Error("Release changed during preflight. Refresh first.");
          this.store.setRelease(release.id, "running");
        });
        break;
      }
      case "pause":
        if (release.status !== "running")
          throw new Error("Only running releases can pause.");
        this.store.setRelease(release.id, "paused");
        break;
      case "cancel":
        if (["cancelled", "completed"].includes(release.status))
          throw new Error("Release is already terminal.");
        this.store.atomic(() => {
          this.store.setRelease(release.id, "cancelled");
          for (const j of this.store
            .running()
            .filter((j) => j.release_id === release.id)) {
            this.active.get(j.id)?.abort();
            this.store.finish(j, "cancelled", "Cancelled by user.");
          }
          for (const i of this.store.issues(release.id))
            if (!["merged", "dropped"].includes(i.status))
              this.store.patch(i.id, { status: "cancelled" });
        });
        break;
      case "sync_github":
        if (release.status === "cancelled")
          throw new Error("Release is cancelled.");
        if (this.store.running().some((j) => j.release_id === release.id))
          throw new Error(
            "Wait for active workers to finish before syncing issues manually.",
          );
        for (const i of this.store.issues(release.id))
          if (!i.github_issue) {
            const number = await this.external(i, "issue", () =>
              this.github.issue(project, i),
            );
            this.store.patch(i.id, { github_issue: number });
            this.store.event(
              release.id,
              i.id,
              "github.synced",
              `Linked GitHub issue #${number}.`,
            );
          }
        break;
      case "manager":
        if (["completed", "cancelled"].includes(release.status))
          throw new Error("Release is terminal.");
        await this.manager(release.id);
        break;
    }
    return this.snapshot(release.id);
  }
  private feedback(a: Extract<Action, { action: "feedback" }>) {
    const r = this.store.release(a.releaseId);
    const release = { name: r.name, type: r.type, goal: r.goal };
    return this.store.once(a.requestId, JSON.stringify(a), () => {
      validatePlan({
        release,
        issues: [
          ...this.store.issues(r.id).map((i) => ({
            key: i.key,
            title: i.title,
            body: i.body,
            complexity: i.complexity,
            acceptance: i.acceptance,
            depends_on: i.depends_on,
          })),
          a.issue,
        ],
      });
      const issue = this.store.addIssue(
        r.id,
        a.issue,
        a.severity === "regression" ? 30 : 5,
      );
      if (r.status === "completed") this.store.setRelease(r.id, "paused");
      this.store.promote(r.id);
      return issue;
    });
  }
  private async assertProject(p: Project) {
    const root = await git(p.root, ["rev-parse", "--show-toplevel"]);
    if (
      (await realpath(root)).toLowerCase() !==
      (await realpath(p.root)).toLowerCase()
    )
      throw new Error(
        "Configured project root must be the Git repository root.",
      );
    await git(p.root, ["rev-parse", "--verify", `${p.baseBranch}^{commit}`]);
    if (p.github) {
      for (const args of [
        ["remote", "get-url", "origin"],
        ["remote", "get-url", "--push", "origin"],
      ]) {
        if (
          repositoryFromRemote(await git(p.root, args)) !==
          p.github.toLowerCase()
        )
          throw new Error(
            "Configured GitHub repository must match both origin fetch and push URLs.",
          );
      }
      await git(p.root, [
        "rev-parse",
        "--verify",
        `refs/remotes/origin/${p.baseBranch}^{commit}`,
      ]);
    }
    if (
      p.holdouts &&
      inside(await realpath(p.root), await realpath(p.holdouts))
    )
      throw new Error("Holdouts resolve inside the project.");
  }
  private async assertNoPrivateTitles(project: Project, publicText: string) {
    if (!project.holdouts) return;
    for (const file of (await readdir(project.holdouts))
      .filter((f) => f.endsWith(".md"))
      .slice(0, 100)) {
      const path = join(project.holdouts, file);
      if (!inside(await realpath(project.holdouts), await realpath(path)))
        throw new Error(
          "Private scenario link escapes the configured directory.",
        );
      const { stat } = await import("node:fs/promises");
      if ((await stat(path)).size > 100000)
        throw new Error("Private scenario exceeds the 100KB limit.");
      const content = await readFile(path, "utf8"),
        title = /^#\s*HS-\d+:\s*(.+)$/im.exec(content)?.[1]?.trim();
      if (
        title &&
        title.length >= 12 &&
        publicText.toLowerCase().includes(title.toLowerCase())
      )
        throw new Error("Public issue text contains a private scenario title.");
    }
  }
  start() {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.tick().catch((e) =>
        console.error("[factory] Scheduler:", clean(String(e))),
      );
    }, 1000);
    void this.tick().catch((e) =>
      console.error("[factory] Scheduler:", clean(String(e))),
    );
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const controller of this.active.values()) controller.abort();
    while (this.active.size || this.ticking)
      await new Promise((r) => setTimeout(r, 50));
  }
  async tick() {
    if (this.ticking || this.stopping) return;
    this.ticking = true;
    try {
      this.recover();
      for (const release of this.store
        .releases()
        .filter((r) => r.status === "running")) {
        if (this.stopping) return;
        const project = this.config.projects.find(
          (p) => p.id === release.project,
        );
        if (!project) {
          this.store.setRelease(release.id, "paused");
          this.store.event(
            release.id,
            null,
            "project.unavailable",
            "Project was removed from configuration. Dispatch paused.",
          );
          continue;
        }
        for (;;) {
          const job = this.store.atomic(() => {
            if (
              this.store.running().length >= this.config.concurrency ||
              this.store.release(release.id).status !== "running"
            )
              return;
            if (
              this.store.jobCount(release.id) >= this.config.maxJobsPerRelease
            ) {
              this.store.setRelease(release.id, "paused");
              this.store.event(
                release.id,
                null,
                "budget.exhausted",
                "Execution budget reached. Inspect the release before increasing the configured limit.",
              );
              return;
            }
            const running = new Set(
              this.store.running().map((j) => j.issue_id),
            );
            const issues = this.store.issues(release.id);
            const next =
              issues.find(
                (i) =>
                  !running.has(i.id) &&
                  ["in_validation", "in_review"].includes(i.status),
              ) ??
              issues.find(
                (i) =>
                  !running.has(i.id) &&
                  i.status === "ready" &&
                  i.depends_on.every(
                    (d) => issues.find((x) => x.key === d)?.status === "merged",
                  ),
              );
            if (!next) return;
            if (next.status === "ready" && next.tries >= 3) {
              this.store.patch(next.id, {
                status: "needs_human",
                feedback: "Three build attempts exhausted.",
              });
              return;
            }
            return this.store.claim(
              release.id,
              next.status === "ready"
                ? "builder"
                : next.status === "in_validation"
                  ? "validator"
                  : "reviewer",
              next,
            );
          });
          if (!job) break;
          this.launch(project, job);
        }
        const lastManager = this.store.lastEvent(release.id, "manager.report");
        if (this.stopping) return;
        if (
          !lastManager ||
          Date.now() - Date.parse(lastManager.created_at) >
            this.config.managerIntervalMinutes * 60000
        )
          await this.manager(release.id);
        if (project.autoMerge)
          for (const i of this.store
            .issues(release.id)
            .filter((i) => i.status === "approved")) {
            const last = this.store
              .events(release.id)
              .filter((e) => e.issue_id === i.id && e.kind === "merge.blocked")
              .at(-1);
            if (!last || Date.now() - Date.parse(last.created_at) > 60000)
              await this.merge(i).catch((e) =>
                this.store.event(
                  release.id,
                  i.id,
                  "merge.blocked",
                  clean(String(e)),
                ),
              );
          }
      }
    } finally {
      this.ticking = false;
    }
  }
  recover() {
    this.store.atomic(() => {
      for (const j of this.store.running())
        if (j.lease_until < Date.now()) {
          // An expired process may still be alive. Park for reconciliation instead of dispatching another writer.
          if (
            this.store.finish(
              j,
              "uncertain",
              "Worker lease expired. Inspect the worktree before retrying.",
            )
          ) {
            this.active.get(j.id)?.abort();
            if (j.issue_id)
              this.store.patch(j.issue_id, {
                status: "needs_human",
                feedback:
                  "Worker lease expired; inspect candidate worktree and external operations before retrying.",
              });
            this.store.event(
              j.release_id,
              j.issue_id,
              "job.uncertain",
              "Lease expired. Human reconciliation required.",
            );
          }
        }
    });
  }
  private launch(project: Project, job: Job) {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const heartbeat = setInterval(() => {
      if (!this.store.heartbeat(job)) controller.abort();
    }, 10000);
    void this.perform(project, job, controller.signal).finally(() => {
      clearInterval(heartbeat);
      this.active.delete(job.id);
    });
  }
  private async perform(project: Project, job: Job, signal: AbortSignal) {
    try {
      const issue = job.issue_id ? this.store.issue(job.issue_id) : undefined;
      const context =
        job.role === "manager"
          ? {
              release: this.store.release(job.release_id),
              issues: this.store.issues(job.release_id).map((i) => ({
                key: i.key,
                status: i.status,
                tries: i.tries,
                sendbacks: i.sendbacks,
                feedback: i.feedback,
                depends_on: i.depends_on,
              })),
            }
          : undefined;
      const execution = await this.executor.execute(
        project,
        job,
        issue,
        this.home,
        signal,
        context,
      );
      const { result } = execution;
      const summary = await this.publicNote(project, result.summary);
      if (
        issue &&
        job.role === "builder" &&
        result.verdict === "pass" &&
        project.github &&
        !signal.aborted
      ) {
        const currentJob = () =>
          !signal.aborted &&
          this.store
            .running()
            .some((j) => j.id === job.id && j.token === job.token);
        if (!currentJob()) return;
        this.store.patch(issue.id, {
          head: execution.head,
          worktree: execution.worktree,
          branch: `factory/${issue.release_id.slice(0, 8)}/${issue.key}`,
        });
        try {
          let current = this.store.issue(issue.id);
          if (!current.github_issue)
            this.store.patch(current.id, {
              github_issue: await this.external(current, "issue", () =>
                this.github.issue(project, current),
              ),
            });
          if (!currentJob()) return;
          const candidate = this.store.issue(issue.id);
          const pr = await this.external(candidate, "pr", () =>
            this.github.pullRequest(project, candidate),
          );
          this.store.patch(issue.id, { pr });
        } catch (e) {
          if (
            this.store.finish(
              job,
              "uncertain",
              "GitHub publication needs reconciliation.",
            )
          ) {
            this.store.event(
              job.release_id,
              job.issue_id,
              "github.blocked",
              clean(String(e)),
            );
            this.store.patch(issue.id, {
              status: "needs_human",
              feedback:
                "GitHub publication needs reconciliation. Inspect the branch and remote PR before retrying.",
            });
          }
          return;
        }
      }
      const current = job.issue_id ? this.store.issue(job.issue_id) : undefined;
      if (
        signal.aborted ||
        !this.store
          .running()
          .some((j) => j.id === job.id && j.token === job.token)
      )
        return;
      if (
        current &&
        job.role !== "builder" &&
        (current.head !== job.head || execution.head !== job.head)
      )
        throw new Error(
          "Candidate changed during evaluation; results discarded.",
        );
      this.store.atomic(() => {
        if (
          !this.store.finish(
            job,
            result.verdict === "pass" ? "completed" : result.verdict,
            summary,
            execution.head,
          )
        )
          return;
        this.store.addArtifact(job, "report", `${job.role} report`, summary);
        if (execution.diff)
          this.store.addArtifact(
            job,
            "report",
            "Change summary",
            execution.diff,
          );
        // Evaluator raw output is deliberately excluded from the public audit surface.
        for (const a of result.artifacts)
          if (
            job.role === "builder" ||
            job.role === "reviewer" ||
            job.role === "validator"
          )
            this.store.addArtifact(
              job,
              a.kind,
              a.name,
              a.kind === "screenshot" ? a.content : clean(a.content),
            );
        if (!current) {
          this.store.event(job.release_id, null, "manager.analysis", summary);
          return;
        }
        if (result.verdict === "ask") {
          this.store.patch(current.id, {
            status: "needs_human",
            feedback: summary,
            tries:
              job.role === "builder"
                ? Math.max(0, current.tries - 1)
                : current.tries,
          });
        } else if (result.verdict === "fail")
          this.store.fail(current, summary, job.role === "reviewer");
        else if (job.role === "builder")
          this.store.patch(current.id, {
            status: "in_validation",
            head: execution.head,
            worktree: execution.worktree,
            branch: `factory/${current.release_id.slice(0, 8)}/${current.key}`,
          });
        else
          this.store.patch(current.id, {
            status: job.role === "validator" ? "in_review" : "approved",
          });
        this.store.event(
          job.release_id,
          job.issue_id,
          `job.${result.verdict}`,
          summary,
        );
      });
    } catch (e) {
      const note = clean(String(e));
      this.store.atomic(() => {
        if (
          !this.store.finish(job, signal.aborted ? "cancelled" : "failed", note)
        )
          return;
        if (
          job.issue_id &&
          this.store.release(job.release_id).status !== "cancelled"
        )
          this.store.fail(this.store.issue(job.issue_id), note);
        this.store.event(job.release_id, job.issue_id, "job.failed", note);
      });
    }
  }
  async manager(releaseId: string) {
    const issues = this.store.issues(releaseId),
      report = {
        generatedAt: new Date().toISOString(),
        counts: Object.fromEntries(
          [...new Set(issues.map((i) => i.status))].map((s) => [
            s,
            issues.filter((i) => i.status === s).length,
          ]),
        ),
        needsHuman: issues
          .filter((i) => i.status === "needs_human")
          .map((i) => ({ key: i.key, reason: i.feedback })),
        repeatedFailures: issues
          .filter((i) => i.tries > 1 || i.sendbacks > 0)
          .map((i) => ({ key: i.key, tries: i.tries, sendbacks: i.sendbacks })),
        blocked: issues
          .filter((i) => i.status === "backlog")
          .map((i) => ({ key: i.key, depends_on: i.depends_on })),
      };
    this.store.event(releaseId, null, "manager.report", JSON.stringify(report));
    const project = this.project(this.store.release(releaseId).project);
    if (
      project.executors.manager &&
      !this.store
        .running()
        .some((j) => j.release_id === releaseId && j.role === "manager") &&
      this.store.running().length < this.config.concurrency
    ) {
      const job = this.store.atomic(() => {
        if (
          this.store.running().length >= this.config.concurrency ||
          this.store
            .running()
            .some((j) => j.release_id === releaseId && j.role === "manager") ||
          this.store.jobCount(releaseId) >= this.config.maxJobsPerRelease
        )
          return;
        return this.store.claim(releaseId, "manager");
      });
      if (job) this.launch(project, job);
    }
    return report;
  }
  async merge(issue: Issue) {
    const release = this.store.release(issue.release_id),
      project = this.project(release.project);
    if (
      !["running", "paused"].includes(release.status) ||
      issue.status !== "approved"
    )
      throw new Error("Only approved candidates in active releases can merge.");
    const evaluations = this.store
      .evaluations(issue.id)
      .filter((j) => j.head === issue.head);
    if (
      !["validator", "reviewer"].every((role) =>
        evaluations.some((j) => j.role === role),
      )
    )
      throw new Error(
        "Independent validation and review of this exact commit are required.",
      );
    const result = await this.external(issue, "merge", () =>
      this.github.merge(project, issue),
    );
    // Fetch after merge so downstream worktrees start from the newly integrated base.
    await git(project.root, ["fetch", "origin", project.baseBranch]);
    this.store.atomic(() => {
      const now = this.store.issue(issue.id);
      if (now.status !== "approved" || now.head !== issue.head)
        throw new Error(
          "Merge completed but local candidate changed; reconcile release state.",
        );
      this.store.patch(issue.id, { status: "merged" });
      this.store.event(release.id, issue.id, "issue.merged", result.url);
      this.store.promote(release.id);
    });
    return result;
  }
  private async external<T>(
    issue: Issue,
    kind: "issue" | "pr" | "merge",
    task: () => Promise<T>,
  ): Promise<T> {
    const key =
        kind === "issue"
          ? `issue:${issue.id}`
          : `${kind}:${issue.id}:${issue.head}`,
      operation = this.store.beginOperation(key);
    if (operation.replay) return operation.result as T;
    try {
      const result = await task();
      this.store.endOperation(key, result);
      return result;
    } catch (e) {
      if (e instanceof MergeBlockedError) this.store.clearOperation(key);
      else {
        this.store.uncertainOperation(key);
        const current = this.store.issue(issue.id);
        if (!["merged", "cancelled", "dropped"].includes(current.status))
          this.store.patch(issue.id, {
            status: "needs_human",
            feedback:
              e instanceof CandidateChangedError
                ? "Candidate commit changed. Reconcile the remote branch, then retry with fresh validation and review."
                : "External operation needs reconciliation. Inspect GitHub before resolving this issue.",
          });
        this.store.event(
          issue.release_id,
          issue.id,
          "external.uncertain",
          clean(String(e)),
        );
      }
      throw e;
    }
  }
  private async publicNote(project: Project, note: string): Promise<string> {
    let result = clean(note).replace(/\bHS-\d+\b/gi, "[private scenario]");
    if (project.holdouts)
      for (const file of (await readdir(project.holdouts))
        .filter((f) => f.endsWith(".md"))
        .slice(0, 100)) {
        const path = join(project.holdouts, file);
        if (!inside(await realpath(project.holdouts), await realpath(path)))
          continue;
        const content = (await readFile(path, "utf8")).slice(0, 100000);
        for (const line of content
          .split(/\r?\n/)
          .map((l) => l.replace(/^#+\s*/, "").trim())
          .filter((l) => l.length > 15))
          if (result.toLowerCase().includes(line.toLowerCase()))
            result =
              "Independent evaluation failed. Inspect the acceptance criteria and user-visible behavior; private scenario details were withheld.";
      }
    return result;
  }
}
export function clean(value: string): string {
  return value
    .replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{12,}|github_pat_[\w]{12,})\b/g,
      "[redacted]",
    )
    .replace(
      /(authorization|api[_-]?key|access[_-]?token)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .slice(0, 16000);
}
