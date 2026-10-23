import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { configSchema } from "../servers/factory/contracts.js";
import { FactoryStore } from "../servers/factory/store.js";
import { FactoryService } from "../servers/factory/service.js";
import { git } from "../servers/factory/process.js";
import assert from "node:assert/strict";
const home = await mkdtemp(join(tmpdir(), "iron-workflow-"));
const root = join(home, "repo");
await mkdir(root);
await git(root, ["init", "-b", "main"]);
await git(root, ["config", "core.autocrlf", "false"]);
await writeFile(join(root, "base.txt"), "Baseline\n");
await writeFile(
  join(root, "test.cjs"),
  "const {test}=require('node:test');const assert=require('node:assert/strict');test('baseline stays intact',()=>assert.equal(require('node:fs').readFileSync('base.txt','utf8'),'Baseline\\n'));\n",
);
await git(root, ["add", "."]);
await git(root, [
  "-c",
  "user.name=Smoke",
  "-c",
  "user.email=smoke@localhost",
  "commit",
  "-m",
  "baseline",
]);
const live = process.argv.includes("--live");
const cmd = {
  executable: process.execPath,
  args: [
    resolve(live ? "scripts/codex-worker.mjs" : "tests/fixtures/worker.mjs"),
  ],
  timeoutSeconds: live ? 180 : 30,
};
const config = configSchema.parse({
  concurrency: 2,
  projects: [
    {
      id: "smoke",
      name: "Smoke",
      root,
      executors: { builder: cmd, validator: cmd, reviewer: cmd },
      checks: [
        {
          executable: process.execPath,
          args: ["--test", "test.cjs"],
          timeoutSeconds: 20,
        },
      ],
    },
  ],
});
const store = new FactoryStore(join(home, "factory.db")),
  service = new FactoryService(store, config, home);
try {
  const r: any = await service.control({
    action: "create_release",
    project: "smoke",
    requestId: randomUUID(),
    plan: {
      release: {
        name: "Walking skeleton",
        type: "brownfield",
        goal: "Ship a focused, independently verified change.",
      },
      issues: [
        {
          key: "feature",
          title: "Add the feature",
          complexity: "simple",
          acceptance: [
            "Create feature.txt containing the exact text Add the feature followed by a newline. Leave baseline files unchanged and keep baseline tests passing.",
          ],
        },
      ],
    },
  });
  await service.control({ action: "start", releaseId: r.id });
  const deadline = Date.now() + (live ? 540000 : 60000);
  while (Date.now() < deadline) {
    await service.tick();
    const issue = store.issues(r.id)[0];
    if (issue.status === "needs_human") throw new Error(issue.feedback);
    if (issue.status === "approved") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const issue = store.issues(r.id)[0];
  assert.equal(issue.status, "approved");
  assert.ok(issue.head);
  assert.ok(issue.worktree);
  assert.match(
    await readFile(join(issue.worktree!, "feature.txt"), "utf8"),
    /Add the feature/,
  );
  assert.equal(await git(root, ["status", "--porcelain"]), "");
  assert.equal(
    store.jobs(r.id).filter((j) => j.status === "completed").length,
    3,
  );
  assert.ok(store.artifacts(r.id).length >= 4);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        evidence:
          "Real Git worktrees, subprocess workers, independent validator/reviewer commits, project checks, SQLite history",
        provider: live
          ? "Installed Codex CLI, existing ChatGPT sign-in"
          : "deterministic fixture (no live model)",
        candidate: issue.head,
        jobs: 3,
        artifacts: store.artifacts(r.id).length,
        merge:
          "Correctly remains gated on a configured GitHub repository and verified CI",
      },
      null,
      2,
    ),
  );
} finally {
  await service.stop();
  store.close();
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
