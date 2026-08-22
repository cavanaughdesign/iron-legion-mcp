#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { discoverAgentPacks, namespacedToolName } from "./registry.js";
import type { AgentPackManifest } from "./types.js";

const server = new McpServer({
  name: "iron-legion-mcp",
  version: "0.1.0",
});

let mountedPacks: AgentPackManifest[] = [];

async function mountPacks(): Promise<void> {
  mountedPacks = await discoverAgentPacks();

  for (const pack of mountedPacks) {
    for (const tool of pack.tools) {
      const name = namespacedToolName(pack.id, tool.name);
      server.registerTool(
        name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        async (input, extra) => tool.handler(input, extra)
      );
    }
    console.error(`[orchestrator] Mounted pack "${pack.id}" (${pack.tools.length} tool(s))`);
  }
}

// Orchestrator meta-tools (kept minimal to stay within the MVP tool budget -- see README).
server.registerTool(
  "orchestrator__list_packs",
  {
    description: "List currently mounted agent packs and their tool counts.",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          mountedPacks.map((p) => ({ id: p.id, displayName: p.displayName, toolCount: p.tools.length })),
          null,
          2
        ),
      },
    ],
  })
);

server.registerTool(
  "orchestrator__health",
  {
    description: "Report orchestrator health and total registered tool count.",
    inputSchema: {},
  },
  async () => {
    const packTools = mountedPacks.reduce((sum, p) => sum + p.tools.length, 0);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ status: "ok", mountedPacks: mountedPacks.length, packTools, metaTools: 2 }, null, 2),
        },
      ],
    };
  }
);

async function main(): Promise<void> {
  await mountPacks();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[orchestrator] Iron Legion MCP server running on stdio");
}

main().catch((err) => {
  console.error("[orchestrator] Fatal error during startup:", err);
  process.exit(1);
});

// Re-exported for tests / potential embedding; not part of the public tool contract.
export { server };
void z;
