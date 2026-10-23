import { run, git } from "./process.js";
import type { Project, Issue } from "./contracts.js";
export class CandidateChangedError extends Error {}
export class MergeBlockedError extends Error {}
export function repositoryFromRemote(remote: string): string {
  const url = new URL(
    remote.replace(/^git@github\.com:/i, "https://github.com/"),
  );
  if (
    !["https:", "ssh:"].includes(url.protocol) ||
    url.hostname.toLowerCase() !== "github.com"
  )
    throw new Error("Use a standard GitHub HTTPS or SSH origin URL.");
  const repository = url.pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/i, "");
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error("Invalid GitHub origin repository.");
  return repository.toLowerCase();
}

export class GitHub {
  async gh(project: Project, args: string[], input?: string): Promise<string> {
    if (!project.github)
      throw new Error("No GitHub repository configured for this project.");
    const result = await run(
      {
        executable: "gh",
        args: [...args, "--repo", project.github],
        timeoutSeconds: 60,
      },
      project.root,
      { input, env: { GH_PROMPT_DISABLED: "1" } },
    );
    if (result.code)
      throw new Error(`GitHub operation failed: ${result.output.slice(-1200)}`);
    return result.stdout.trim();
  }
  async issue(project: Project, issue: Issue): Promise<number> {
    const marker = `<!-- iron-legion:${issue.id} -->`;
    const matches = JSON.parse(
      await this.gh(project, [
        "issue",
        "list",
        "--state",
        "all",
        "--search",
        `in:body "iron-legion:${issue.id}"`,
        "--json",
        "number,body",
        "--limit",
        "100",
      ]),
    ) as { number: number; body: string }[];
    const existing = matches.find((i) => i.body.includes(marker));
    if (existing) return existing.number;
    const body = `${issue.body}\n\nAcceptance criteria:\n${issue.acceptance.map((a) => `- ${a}`).join("\n")}\n\n${marker}`;
    const url = await this.gh(
      project,
      ["issue", "create", "--title", issue.title, "--body-file", "-"],
      body,
    );
    const n = /\/issues\/(\d+)\s*$/.exec(url);
    if (!n)
      throw new Error(
        "Could not confirm created issue number. Reconcile before retrying.",
      );
    return Number(n[1]);
  }
  async pullRequest(project: Project, issue: Issue): Promise<number> {
    if (!issue.worktree || !issue.branch)
      throw new Error("No candidate branch.");
    await git(issue.worktree, [
      "push",
      "--set-upstream",
      "origin",
      issue.branch,
    ]);
    const existing = JSON.parse(
      await this.gh(project, [
        "pr",
        "list",
        "--head",
        issue.branch,
        "--state",
        "open",
        "--json",
        "number",
      ]),
    );
    if (existing.length) return existing[0].number;
    const body = `Implements ${issue.key}.\n\n${issue.github_issue ? `Closes #${issue.github_issue}\n\n` : ""}${issue.acceptance.map((a) => `- ${a}`).join("\n")}\n\n<!-- iron-legion:${issue.id} -->`;
    const url = await this.gh(
      project,
      [
        "pr",
        "create",
        "--head",
        issue.branch,
        "--base",
        project.baseBranch,
        "--title",
        issue.title,
        "--body-file",
        "-",
      ],
      body,
    );
    const n = /\/pull\/(\d+)\s*$/.exec(url);
    if (!n)
      throw new Error(
        "Could not confirm PR number. Reconcile before retrying.",
      );
    return Number(n[1]);
  }
  async merge(
    project: Project,
    issue: Issue,
  ): Promise<{ head: string; url: string }> {
    if (!issue.pr || !issue.head)
      throw new MergeBlockedError("A reviewed commit and PR are required.");
    const pr = JSON.parse(
      await this.gh(project, [
        "pr",
        "view",
        String(issue.pr),
        "--json",
        "headRefOid,baseRefName,state,isDraft,mergeStateStatus,statusCheckRollup,url",
      ]),
    );
    if (
      pr.headRefOid !== issue.head ||
      pr.baseRefName !== project.baseBranch ||
      pr.isDraft
    )
      throw new CandidateChangedError(
        "PR candidate changed; validation and review must run again.",
      );
    if (pr.state === "MERGED") return { head: issue.head, url: pr.url };
    if (pr.state !== "OPEN") throw new MergeBlockedError("PR is not open.");
    if (pr.mergeStateStatus !== "CLEAN")
      throw new MergeBlockedError(
        "GitHub reports the PR is not cleanly mergeable. Reconcile branch protection, base updates, or conflicts.",
      );
    const checks = pr.statusCheckRollup ?? [];
    const success = (c: any) =>
      c.__typename === "CheckRun"
        ? c.status === "COMPLETED" && c.conclusion === "SUCCESS"
        : c.state === "SUCCESS";
    if (!checks.length || !checks.every(success))
      throw new MergeBlockedError(
        "CI green required: at least one check, and every reported check must succeed.",
      );
    await this.gh(project, [
      "pr",
      "merge",
      String(issue.pr),
      "--squash",
      "--match-head-commit",
      issue.head,
    ]);
    const confirmed = JSON.parse(
      await this.gh(project, [
        "pr",
        "view",
        String(issue.pr),
        "--json",
        "state,headRefOid,url",
      ]),
    );
    if (confirmed.state !== "MERGED" || confirmed.headRefOid !== issue.head)
      throw new Error("Merge outcome is uncertain. Reconcile before retrying.");
    return { head: issue.head, url: confirmed.url };
  }
}
