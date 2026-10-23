import {
  mkdir,
  writeFile,
  readFile,
  stat,
  readdir,
  lstat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Project,
  Job,
  Issue,
  WorkerResult,
  Command,
} from "./contracts.js";
import { workerResultSchema } from "./contracts.js";
import { run, git } from "./process.js";

const skillRoot = fileURLToPath(
  new URL("../skills/ai-software-factory/", import.meta.url),
);
export interface Execution {
  result: WorkerResult;
  output: string;
  worktree: string;
  head: string;
  diff: string;
}
export interface Executor {
  execute(
    project: Project,
    job: Job,
    issue: Issue | undefined,
    home: string,
    signal: AbortSignal,
    context?: unknown,
  ): Promise<Execution>;
}
const rolePrompts = {
  builder:
    "Implement exactly this issue. Do not read private evaluation scenarios. Do not change CI configuration or weaken tests. Do not push or merge. Use ask when a product decision is required.",
  validator:
    "Independently validate the candidate as a user. Run its acceptance criteria and private evaluation scenarios. Do not change tracked code. Return symptoms and reproduction without private scenario IDs, titles, or exact inputs. Never use builder reasoning.",
  reviewer:
    "Independently review correctness, scope, security, and meaningful tests against acceptance criteria. Do not change tracked code. Batch all actionable feedback into one fail result. Do not read private evaluation scenarios or builder reasoning. Do not merge.",
  manager:
    "Assess cross-issue patterns, stale work, recurring failures, and bottlenecks. Return a report and recommendations for new issues. Do not modify code or relax the three factory rules.",
};

export class CommandExecutor implements Executor {
  async execute(
    project: Project,
    job: Job,
    issue: Issue | undefined,
    home: string,
    signal: AbortSignal,
    context?: unknown,
  ): Promise<Execution> {
    const command = project.executors[job.role];
    if (!command) throw new Error(`Configure a ${job.role} executor first.`);
    const jobDir = join(home, "jobs", job.id);
    await mkdir(jobDir, { recursive: true, mode: 0o700 });
    let worktree = project.root;
    if (issue) {
      const branch = `factory/${issue.release_id.slice(0, 8)}/${issue.key}`;
      worktree =
        job.role === "builder"
          ? join(home, "worktrees", issue.id)
          : join(home, "worktrees", job.id);
      await mkdir(join(home, "worktrees"), { recursive: true });
      if (job.role === "builder") {
        try {
          await stat(worktree);
          await git(worktree, ["rev-parse", "--is-inside-work-tree"], signal);
        } catch {
          await git(
            project.root,
            [
              "worktree",
              "add",
              "-b",
              branch,
              worktree,
              project.github
                ? `refs/remotes/origin/${project.baseBranch}`
                : project.baseBranch,
            ],
            signal,
          );
        }
      } else {
        if (!issue.head) throw new Error("Candidate commit is missing.");
        await git(
          project.root,
          ["worktree", "add", "--detach", worktree, issue.head],
          signal,
        );
      }
    }
    const promptFile = join(jobDir, "prompt.txt"),
      outputFile = join(jobDir, "result.json");
    let guidance = "";
    try {
      guidance = await readFile(
        join(skillRoot, "references", "roles.md"),
        "utf8",
      );
      guidance = guidance.replaceAll("\r\n", "\n");
    } catch {
      throw new Error(
        "Factory role skill assets are missing. Rebuild the package.",
      );
    }
    // Only the current charter is passed. Never give a builder the full role matrix or private files.
    const names: Record<string, string> = {
      builder: "Builder (Ship Simple / Ship)",
      validator: "App Validator",
      reviewer: "Code Reviewer / Merger",
      manager: "Manager",
    };
    const charter =
      guidance.split(`## ${names[job.role]}\n`)[1]?.split("\n## ")[0] ??
      rolePrompts[job.role];
    const payload = {
      role: job.role,
      instructions: rolePrompts[job.role],
      charter,
      runtimeContract:
        "The orchestrator owns all workflow transitions, commits, PR publication, and merging. Any factory.py commands in the reference charter describe state transitions only: do not execute them. Work on files for your role and return the structured result.",
      ...(issue?.head && job.role !== "builder"
        ? {
            candidateDiff: (
              await git(
                worktree,
                [
                  "diff",
                  `${project.github ? `refs/remotes/origin/${project.baseBranch}` : project.baseBranch}...HEAD`,
                ],
                signal,
              )
            ).slice(0, 100000),
          }
        : {}),
      context,
      issue: issue
        ? {
            key: issue.key,
            title: issue.title,
            body: issue.body,
            acceptance: issue.acceptance,
            route: issue.complexity === "simple" ? "ship-simple" : "ship",
            ...(job.role === "builder" ? { feedback: issue.feedback } : {}),
          }
        : undefined,
      candidate: issue?.head,
      previewUrl: project.previewUrl,
      ...(job.role === "validator" && project.holdouts
        ? {
            privateScenarios:
              project.isolation === "container"
                ? "/holdouts"
                : project.holdouts,
          }
        : {}),
      outputContract: {
        verdict: "pass | fail | ask",
        summary: "Plain language result. Never disclose private scenario text.",
        artifacts: [
          {
            name: "report.txt",
            kind: "report | test | screenshot | trace",
            content: "UTF-8 evidence or base64 image",
          },
        ],
      },
      outputFile:
        project.isolation === "container" ? "/job/result.json" : outputFile,
    };
    const input = JSON.stringify(payload, null, 2);
    await writeFile(promptFile, input, { encoding: "utf8", mode: 0o600 });
    const substitutions: Record<string, string> = {
      "{promptFile}": promptFile,
      "{outputFile}": outputFile,
      "{worktree}": worktree,
      "{role}": job.role,
      "{jobDir}": jobDir,
    };
    let executable = command.executable,
      args = command.args.map((a) =>
        Object.entries(substitutions).reduce(
          (s, [k, v]) => s.replaceAll(k, v),
          a,
        ),
      );
    if (project.isolation === "container") {
      const name = `iron-legion-${job.id}`;
      args = [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "256",
        "--memory",
        "4g",
        "--cpus",
        "2",
        "--mount",
        `type=bind,source=${worktree},target=/workspace${job.role === "manager" ? ",readonly" : ""}`,
        "--mount",
        `type=bind,source=${jobDir},target=/job`,
        "--workdir",
        "/workspace",
        ...(job.role === "validator" && project.holdouts
          ? [
              "--mount",
              `type=bind,source=${project.holdouts},target=/holdouts,readonly`,
            ]
          : []),
        project.containerImage!,
        command.executable,
        ...command.args.map((a) =>
          a
            .replaceAll("{promptFile}", "/job/prompt.txt")
            .replaceAll("{outputFile}", "/job/result.json")
            .replaceAll("{worktree}", "/workspace")
            .replaceAll("{role}", job.role)
            .replaceAll("{jobDir}", "/job"),
        ),
      ];
      executable = "docker";
    }
    let proc;
    try {
      proc = await run(
        { executable, args, timeoutSeconds: command.timeoutSeconds },
        worktree,
        { input, signal },
      );
    } finally {
      if (project.isolation === "container")
        await run(
          {
            executable: "docker",
            args: ["rm", "-f", `iron-legion-${job.id}`],
            timeoutSeconds: 20,
          },
          project.root,
        ).catch(() => {});
    }
    if (proc.code)
      throw new Error(
        `${job.role} exited ${proc.code}: ${proc.output.slice(-1200)}`,
      );
    let raw: string;
    try {
      const s = await lstat(outputFile);
      if (!s.isFile() || s.isSymbolicLink() || s.size > 2_000_000)
        throw new Error();
      raw = await readFile(outputFile, "utf8");
    } catch {
      raw = proc.stdout.trim();
    }
    const result = workerResultSchema.parse(JSON.parse(raw));
    if (job.role === "builder" && result.verdict === "pass") {
      for (const check of project.checks) {
        const r = await this.check(project, check, worktree, jobDir, signal);
        result.artifacts.push({
          kind: "test",
          name: check.executable,
          content: r.output.slice(-100000),
        });
        if (r.code)
          throw new Error(`Project check failed: ${r.output.slice(-1500)}`);
      }
      await git(worktree, ["add", "--all"], signal);
      const changed = await git(
        worktree,
        ["diff", "--cached", "--name-only"],
        signal,
      );
      if (
        changed
          .split("\n")
          .some((p) =>
            /^\.github\/workflows\/|^\.factory\/|^\.iron-legion\//.test(p),
          )
      )
        throw new Error(
          "Builder changed protected factory or CI files. Human review required.",
        );
      if (changed)
        await git(
          worktree,
          [
            "-c",
            "user.name=Iron Legion",
            "-c",
            "user.email=iron-legion@localhost",
            "commit",
            "-m",
            `factory: ${issue!.title}`,
          ],
          signal,
        );
    } else if (issue && job.role !== "builder") {
      const dirty = await git(
        worktree,
        ["status", "--porcelain", "--untracked-files=no"],
        signal,
      );
      if (dirty)
        throw new Error(
          "An independent evaluator modified tracked candidate files.",
        );
    }
    const head = await git(worktree, ["rev-parse", "HEAD"], signal);
    const diff = issue
      ? await git(
          worktree,
          ["diff", `${project.baseBranch}...HEAD`, "--stat"],
          signal,
        )
      : "";
    return { result, output: proc.output.slice(-24000), worktree, head, diff };
  }
  private check(
    project: Project,
    command: Command,
    cwd: string,
    jobDir: string,
    signal: AbortSignal,
  ) {
    if (project.isolation === "trusted-process")
      return run(command, cwd, { signal });
    return run(
      {
        executable: "docker",
        args: [
          "run",
          "--rm",
          "--network",
          "none",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "256",
          "--memory",
          "4g",
          "--cpus",
          "2",
          "--mount",
          `type=bind,source=${cwd},target=/workspace`,
          "--workdir",
          "/workspace",
          project.containerImage!,
          command.executable,
          ...command.args,
        ],
        timeoutSeconds: command.timeoutSeconds,
      },
      cwd,
      { signal },
    );
  }
}
