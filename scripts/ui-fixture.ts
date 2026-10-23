// Local QA server; never included in the distribution or used for live-provider evidence.
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { build } from "esbuild";
import { FactoryStore } from "../servers/factory/store.js";
import { FactoryService } from "../servers/factory/service.js";
import { configSchema } from "../servers/factory/contracts.js";
import { startDashboard } from "../servers/factory/http.js";
import { git } from "../servers/factory/process.js";
const home = resolve(".local-demo"),
  root = join(home, "repo");
await mkdir(root, { recursive: true });
if (!existsSync(join(root, ".git"))) {
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "core.autocrlf", "false"]);
  await writeFile(
    join(root, "baseline.cjs"),
    "require('node:test').test('baseline',()=>require('node:assert/strict').equal(2+2,4));",
  );
  await git(root, ["add", "."]);
  await git(root, [
    "-c",
    "user.name=QA",
    "-c",
    "user.email=qa@localhost",
    "commit",
    "-m",
    "baseline",
  ]);
}
const cmd = {
  executable: process.execPath,
  args: [resolve("tests/fixtures/worker.mjs")],
  timeoutSeconds: 60,
};
const config = configSchema.parse({
  projects: [
    {
      id: "qa",
      name: "QA fixture · simulated workers",
      root,
      checks: [
        { executable: process.execPath, args: ["--test", "baseline.cjs"] },
      ],
      executors: { builder: cmd, validator: cmd, reviewer: cmd },
    },
    {
      id: "forms",
      name: "Workflow verification",
      root,
      checks: [
        { executable: process.execPath, args: ["--test", "baseline.cjs"] },
      ],
      executors: { builder: cmd, validator: cmd, reviewer: cmd },
    },
  ],
});
const store = new FactoryStore(join(home, "ui.db")),
  service = new FactoryService(store, config, home);
for (const release of store
  .releases()
  .filter(
    (r) =>
      r.project === "forms" && !["completed", "cancelled"].includes(r.status),
  ))
  await service.control({ action: "cancel", releaseId: release.id });
service.start();
if (!store.releases().length) {
  const release = store.atomic(() =>
    store.create("qa", {
      release: {
        name: "v1.0 · Shipping confidence",
        type: "brownfield",
        goal: "Deliver a dependable customer workspace with observable, independent checks.",
      },
      issues: [
        {
          key: "workspace-shell",
          title: "Create the customer workspace",
          body: "Provide a clear starting point for customers.",
          complexity: "complex",
          acceptance: ["Customers can open their workspace"],
          depends_on: [],
        },
        {
          key: "search",
          title: "Search across workspace projects",
          body: "",
          complexity: "complex",
          acceptance: ["Search returns matching projects"],
          depends_on: [],
        },
        {
          key: "empty-states",
          title: "Make empty states helpful",
          body: "",
          complexity: "simple",
          acceptance: ["Empty lists explain the next action"],
          depends_on: [],
        },
        {
          key: "exports",
          title: "Export a project summary",
          body: "",
          complexity: "complex",
          acceptance: ["The exported summary includes project details"],
          depends_on: [],
        },
        {
          key: "shortcuts",
          title: "Add keyboard navigation",
          body: "",
          complexity: "simple",
          acceptance: ["All primary actions are reachable by keyboard"],
          depends_on: [],
        },
        {
          key: "retention",
          title: "Clarify archive retention",
          body: "",
          complexity: "simple",
          acceptance: ["Archive retention is clearly described"],
          depends_on: [],
        },
      ],
    }),
  );
  store.setRelease(release.id, "paused");
  const issues = store.issues(release.id);
  const statuses = [
    "merged",
    "claimed",
    "in_validation",
    "in_review",
    "ready",
    "needs_human",
  ] as const;
  issues.forEach((i, n) =>
    store.patch(i.id, {
      status: statuses[n],
      tries: n ? 1 : 0,
      feedback:
        n === 5
          ? "Should archived projects be kept for 30 days or indefinitely?"
          : "",
      head: "b7138a014e8d8f2c61193c5512cc829e0991447a",
    }),
  );
  const job = store.claim(release.id, "reviewer", store.issue(issues[0].id));
  store.finish(job, "completed", "Fixture review passed.");
  store.addArtifact(
    job,
    "report",
    "Independent review report",
    "QA fixture evidence. This report is synthetic and does not represent live model execution.\n\nAcceptance criteria exercised. No unrelated file changes observed.",
  );
  store.event(
    release.id,
    issues[5].id,
    "issue.escalated",
    "Archive retention requires a product decision.",
  );
}
const dashboard = await startDashboard(service, 4179);
await writeFile(join(home, "ui-url.txt"), dashboard.url());
const hostBundle = await build({
  entryPoints: ["tests/fixtures/host.ts"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const host = createServer(async (req, res) => {
  if (req.url === "/session-link") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: dashboard.url() }));
    return;
  }
  if (req.url === "/host.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(hostBundle.outputFiles[0].text);
    return;
  }
  if (req.url === "/app") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(await readFile("dist/app/factory.html", "utf8"));
    return;
  }
  if (req.url === "/tool" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const p = JSON.parse(body),
        data =
          p.name === "factory__control"
            ? { result: await service.control(p.arguments.command) }
            : p.arguments?.artifactId
              ? store.artifact(p.arguments.artifactId)
              : {
                  ...service.snapshot(p.arguments?.releaseId),
                  ...(p.arguments?.popout
                    ? { standaloneUrl: dashboard.url() }
                    : {}),
                };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        }),
      );
    } catch (e) {
      res.end(
        JSON.stringify({
          isError: true,
          content: [{ type: "text", text: String(e) }],
        }),
      );
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    '<!doctype html><html><body style="margin:0;background:#101215"><iframe title="Iron Legion MCP App" id="app" style="width:100%;height:100vh;border:0" sandbox="allow-scripts allow-same-origin allow-forms allow-modals" allow="fullscreen"></iframe><script src="/host.js"></script></body></html>',
  );
});
await new Promise<void>((r) => host.listen(4180, "127.0.0.1", r));
console.log(
  "UI QA fixture ready: ports 4179 and 4180. Session link saved in .local-demo/ui-url.txt.",
);
const close = async () => {
  host.close();
  await service.stop();
  await dashboard.close();
  store.close();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
