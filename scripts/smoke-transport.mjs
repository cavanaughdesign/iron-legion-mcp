import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
const home = await mkdtemp(join(tmpdir(), "iron-transport-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/servers/orchestrator/index.js")],
  env: {
    ...process.env,
    IRON_LEGION_HOME: home,
    IRON_LEGION_CONFIG: join(home, "config.json"),
  },
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => (stderr += chunk));
const client = new Client({
  name: "iron-legion-release-smoke",
  version: "1.0.0",
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 9);
  const open = tools.tools.find((t) => t.name === "factory__open");
  assert.equal(open._meta.ui.resourceUri, "ui://iron-legion/factory.html");
  assert.deepEqual(
    tools.tools.find((t) => t.name === "factory__control")._meta.ui.visibility,
    ["app"],
  );
  const resources = await client.listResources();
  assert.ok(
    resources.resources.some((r) => r.uri === "ui://iron-legion/factory.html"),
  );
  const resource = await client.readResource({
    uri: "ui://iron-legion/factory.html",
  });
  assert.equal(resource.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.match(resource.contents[0].text, /IRON LEGION/);
  assert.ok(!resource.contents[0].text.includes('src="/src/'));
  const snapshot = await client.callTool({
    name: "factory__open",
    arguments: { popout: true },
  });
  assert.ok(!snapshot.isError);
  const data = snapshot.structuredContent;
  assert.equal(data.projects.length, 0);
  const url = new URL(data.standaloneUrl);
  const page = await fetch(url.origin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /IRON LEGION/);
  assert.equal((await fetch(url.origin + "/api/snapshot")).status, 401);
  const health = await client.callTool({
    name: "orchestrator__health",
    arguments: {},
  });
  assert.equal(JSON.parse(health.content[0].text).totalTools, 9);
  const sample = await client.callTool({
    name: "tester__run_tests",
    arguments: {},
  });
  assert.ok(!sample.isError, sample.content?.[0]?.text);
  console.log(
    JSON.stringify(
      {
        status: "passed",
        tools: 9,
        resources: resources.resources.length,
        resourceMime: resource.contents[0].mimeType,
        compiledStdio: true,
        bundledHtml: true,
        loopbackHttp: true,
        unauthorizedApiDenied: true,
        legacyTester: true,
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.error(stderr.replace(/#session=[\w-]+/g, "#session=[redacted]"));
  throw e;
} finally {
  await client.close();
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
