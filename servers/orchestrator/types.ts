import type { ZodTypeAny } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A single tool exposed by an agent pack. Registered on the shared MCP server
 * as `${pack.id}__${tool.name}` by the orchestrator's registry.
 */
export interface AgentPackTool {
  /** Unqualified tool name, e.g. "scaffold_file". Namespaced at registration time. */
  name: string;
  description: string;
  /** Raw Zod shape (object of Zod types), as consumed by server.registerTool's inputSchema. */
  inputSchema: Record<string, ZodTypeAny>;
  handler(
    input: Record<string, unknown>,
    extra: unknown,
  ): Promise<CallToolResult>;
}

/**
 * The manifest every agent pack must default-export from
 * /servers/agents/<pack-id>/index.ts for the orchestrator to discover and mount it.
 */
export interface AgentPackManifest {
  /** Used as the tool namespace prefix, e.g. "builder". */
  id: string;
  displayName: string;
  description: string;
  tools: AgentPackTool[];
  /** ids of /servers/skills/ packs this agent mounts. Reserved for post-MVP use. */
  skills?: string[];
}
