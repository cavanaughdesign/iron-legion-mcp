# Iron Legion MCP Server (MVP)

Iron Legion is a single MCP server that exposes an **orchestrator skeleton** plus mountable **agent packs**, wired into VS Code Agent Mode / Copilot via `.vscode/mcp.json`.

This repo currently implements the **MVP milestone** only, per the locked spec (Dart task: Spec: Iron Legion MCP Server -- scope, architecture, MVP). See "Scope" below for what is and is not built yet.

## Scope (MVP)

**Built:**

- Bare MCP server over stdio transport, discoverable by VS Code Agent Mode via `.vscode/mcp.json` (`servers` root key).
- Orchestrator **skeleton**: a registry/dispatcher that discovers and mounts agent packs at boot. No LangGraph, no DAG execution, no cross-agent routing.
- One working agent pack: **Builder**, exposing `builder__scaffold_file` and `builder__run_tests` against the bundled `sample-repo/`.
- Repo layout matching the concept doc: `/servers/orchestrator/`, `/servers/agents/`, `/servers/skills/`.
- Enforced, documented tool budget (see below).

**Explicitly deferred (do not build without a new task):**

- Tester, Docs, DevOps, Auditor agent packs.
- LangGraph-style multi-agent orchestration / DAG execution.
- House Party Protocol (multi-project spawn workflow).
- Clean Slate Protocol (teardown/reset).
- Skill packs (`/servers/skills/`) as a distinct mountable unit -- see Open Questions.
- Any remote/Cloudflare hosting. This server is local stdio only.

## Repo layout

```
iron-legion-mcp/
  servers/
    orchestrator/
      index.ts        # entrypoint: boots McpServer, mounts packs, connects stdio transport
      registry.ts      # discovers /servers/agents/*/index.ts and validates manifests
      types.ts          # AgentPackManifest / AgentPackTool contract
    agents/
      builder/
        index.ts        # Builder pack manifest (default export)
        tools/
          scaffoldFile.ts
          runTests.ts
    skills/
      README.md          # stub placeholder -- not a mountable unit yet (see Open Questions)
  sample-repo/           # sample target repo Builder's tools operate against
  tests/
    registry.test.ts
    builder.test.ts
  .vscode/
    mcp.json             # VS Code Agent Mode config (servers root key)
```

## Running locally

```bash
npm install
npm start          # runs servers/orchestrator/index.ts over stdio via tsx
```

VS Code Agent Mode will discover the server automatically once `.vscode/mcp.json` is present in the workspace -- no manual registration beyond that file.

## Adding a new agent pack

1. Create a directory at `/servers/agents/<pack-id>/` with an `index.ts` that default-exports an `AgentPackManifest` (see `servers/orchestrator/types.ts`):

   ```ts
   import type { AgentPackManifest } from "../../orchestrator/types.js";

   const manifest: AgentPackManifest = {
     id: "my-pack",
     displayName: "My Pack",
     description: "What this pack does.",
     tools: [
       {
         name: "do_thing",
         description: "Does a thing.",
         inputSchema: { input: z.string() },
         handler: async ({ input }) => ({ content: [{ type: "text", text: `did: ${input}` }] }),
       },
     ],
   };

   export default manifest;
   ```

2. The orchestrator scans `/servers/agents/*/index.ts` at boot and registers every tool automatically -- there is **no hardcoded import list** to update in the orchestrator.
3. Every tool is registered as `${pack.id}__${tool.name}` (e.g. `my-pack__do_thing`) to prevent name collisions across packs.
4. Before adding a pack, check it against the **tool budget** below and justify any addition in its own task -- do not add packs silently.

## Manifest contract

```ts
interface AgentPackManifest {
  id: string;              // used as the tool namespace prefix
  displayName: string;
  description: string;
  tools: AgentPackTool[];
  skills?: string[];        // ids of /servers/skills/ packs this agent mounts (post-MVP, unused for now)
}

interface AgentPackTool {
  name: string;                                // registered as `${pack.id}__${name}`
  description: string;
  inputSchema: Record<string, ZodTypeAny>;      // raw Zod shape passed to server.registerTool
  handler: (input: any, extra: any) => Promise<CallToolResult>;
}
```

Packs are toggled via the SDK-native `RegisteredTool.enable()` / `.disable()` handles returned by `server.registerTool(...)` (these trigger `list_changed` notifications automatically) -- there is no bespoke on/off mechanism.

## Tool namespacing & budget rule

Every tool name is namespaced `<pack-id>__<tool-name>` to avoid collisions. Agent hosts have practical ceilings around ~128 tools per request, with usability degrading well before that.

**Current tool count: 4 (within the <10 MVP budget)**

| Source | Tools |
| --- | --- |
| Orchestrator meta-tools | `orchestrator__list_packs`, `orchestrator__health` (2) |
| Builder pack | `builder__scaffold_file`, `builder__run_tests` (2) |

Any future pack must state its added tool count and get it justified against this budget in its own task before being merged.

## Testing

```bash
npm test
```

Covers: agent-pack manifest discovery, tool namespacing (`<pack-id>__<name>`), and the Builder pack's `scaffold_file` happy path.

## Open questions (non-blocking fast-follows)

1. Whether Iron Legion's agent packs should call out to the already-live `skill-manager-mcp` for skill-related capability instead of building a parallel `/servers/skills/` system.
2. Where cross-run state/memory for future orchestration phases should live (e.g. `agent-memory-mcp` vs. a separate local store).
3. Whether "VS Code Agent Mode" here means VS Code proper or the standalone Copilot Agent Host/CLI, which reads MCP config from a different file. This repo defaults to standard `.vscode/mcp.json` for now.
