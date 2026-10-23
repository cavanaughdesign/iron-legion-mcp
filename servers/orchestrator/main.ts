#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { discoverAgentPacks, namespacedToolName } from "./registry.js";
import { loadConfig, dataHome } from "../factory/config.js";
import { FactoryStore } from "../factory/store.js";
import { FactoryService } from "../factory/service.js";
import { startDashboard } from "../factory/http.js";
import { registerFactory } from "../factory/register.js";
import { appHtmlPath } from "../factory/paths.js";

export async function createIronLegion(
  options: { port?: number; worker?: boolean } = {},
) {
  try {
    await access(appHtmlPath);
  } catch {
    throw new Error(
      "Built factory App not found. Run npm run build before starting Iron Legion.",
    );
  }
  const config = loadConfig(),
    store = new FactoryStore(join(dataHome, "factory.db")),
    service = new FactoryService(store, config, dataHome);
  let dashboard;
  try {
    dashboard = await startDashboard(service, options.port);
  } catch (e) {
    store.close();
    throw e;
  }
  try {
    const server = new McpServer({ name: "iron-legion-mcp", version: "1.0.0" });
    const packs = await discoverAgentPacks();
    for (const pack of packs)
      for (const tool of pack.tools)
        server.registerTool(
          namespacedToolName(pack.id, tool.name),
          { description: tool.description, inputSchema: tool.inputSchema },
          async (input, extra) => tool.handler(input, extra),
        );
    server.registerTool(
      "orchestrator__list_packs",
      { description: "List mounted agent packs.", inputSchema: {} },
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify(
              packs.map((p) => ({
                id: p.id,
                displayName: p.displayName,
                toolCount: p.tools.length,
              })),
            ),
          },
        ],
      }),
    );
    server.registerTool(
      "orchestrator__health",
      {
        description: "Report orchestrator and factory health.",
        inputSchema: {},
      },
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "ok",
              mountedPacks: packs.length,
              packTools: packs.reduce((n, p) => n + p.tools.length, 0),
              metaTools: 2,
              factoryTools: 2,
              totalTools: packs.reduce((n, p) => n + p.tools.length, 0) + 4,
              factory: service.snapshot().health,
            }),
          },
        ],
      }),
    );
    registerFactory(server, service, dashboard);
    if (options.worker !== false) service.start();
    let closed = false;
    return {
      server,
      service,
      store,
      dashboard,
      close: async () => {
        if (closed) return;
        closed = true;
        await service.stop();
        await server.close();
        await dashboard.close();
        store.close();
      },
    };
  } catch (e) {
    await service.stop();
    await dashboard.close();
    store.close();
    throw e;
  }
}
export async function main() {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Invalid --port.");
  const runtime = await createIronLegion({ port });
  console.error(
    `[iron-legion] Dashboard (one-time link, valid 60 seconds): ${runtime.dashboard.url()}`,
  );
  const stop = () => {
    void runtime.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  if (!process.argv.includes("--dashboard")) {
    try {
      await runtime.server.connect(new StdioServerTransport());
    } catch (e) {
      await runtime.close();
      throw e;
    }
    process.stdin.once("end", stop);
  }
}
