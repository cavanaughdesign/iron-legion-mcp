# Iron Legion MCP Server (MVP)

Iron Legion is a single MCP server that exposes an **orchestrator skeleton** plus mountable **agent packs**. It can be registered with an MCP host via a workspace `.mcp.json` (Copilot CLI / standalone Agent Host convention) or via `.vscode/mcp.json` (VS Code's own convention) -- see [MCP configuration](#mcp-configuration) below for what each file is, and when each is read.

This repo currently implements the **MVP milestone** plus **Phase 2, Step 1** (state-store module), **Phase 2, Step 2** (`.mcp.json` config wiring), and **Phase 2, Step 3** (Tester agent pack), per the locked spec and addendum (Dart tasks: Spec: Iron Legion MCP Server, Spec addendum: Iron Legion Phase 2). See "Scope" below for what is and is not built yet.

## Scope (MVP)

**Built:**

- Bare MCP server over stdio transport, discoverable by VS Code Agent Mode via `.vscode/mcp.json` (`servers` root key) and by the standalone Copilot Agent Host / Copilot CLI via workspace `.mcp.json` (`mcpServers` root key).
- Orchestrator **skeleton**: a registry/dispatcher that discovers and mounts agent packs at boot. No LangGraph, no DAG execution, no cross-agent routing.
- One working agent pack: **Builder**, exposing `builder__scaffold_file` and `builder__run_tests` against the bundled `sample-repo/`.
- A second working agent pack: **Tester** (Phase 2 Step 3), exposing `tester__run_tests` and `tester__get_run_status`. Tester validates what Builder produces by running the bundled `sample-repo/`'s test suite, and is the first pack to prove the Phase 2 Step 1 state-store integration pattern end-to-end: it creates a run record and a `test` step, updates both as the tool executes, and can read them back via `get_run_status`.
- Repo layout matching the concept doc: `/servers/orchestrator/`, `/servers/agents/`, `/servers/skills/`.
- Enforced, documented tool budget (see below).
- **State-store module** (`/servers/orchestrator/state/`, Phase 2 Step 1): SQLite + `sqlite-vec` persistence for runs, run steps, and semantic memory recall via a local, in-process embedding model. See its own [README](servers/orchestrator/state/README.md) for details. Internal library only -- it does not register any MCP tools itself; the Tester pack is its first consumer.
- **Workspace `.mcp.json`** (Phase 2 Step 2): primary config surface for the standalone Copilot Agent Host / Copilot CLI, using the `mcpServers` root key. Mirrors the existing `.vscode/mcp.json` entry's `command`/`args` exactly -- no changes to the server binary. See [MCP configuration](#mcp-configuration).

**Explicitly deferred (do not build without a new task):**

- Docs, DevOps, Auditor agent packs (Phase 2 Step 4+) -- sequenced after Tester so they can reuse its proven state-store integration pattern.
- LangGraph-style multi-agent orchestration / DAG execution.
- House Party Protocol (multi-project spawn workflow).
- Clean Slate Protocol (teardown/reset).
- Skill packs (`/servers/skills/`) as first-party, parallel implementations -- unblocked for planning now that skill-manager-mcp is confirmed unavailable, but still sequenced after Docs/DevOps per the addendum.
- Any remote/Cloudflare hosting. This server is local stdio only.

## Repo layout

```
iron-legion-mcp/
  .mcp.json             # Copilot CLI / standalone Agent Host config (mcpServers root key)
  servers/
    orchestrator/
      index.ts        # entrypoint: boots McpServer, mounts packs, connects stdio transport
      registry.ts      # discovers /servers/agents/*/index.ts and validates manifests
      types.ts          # AgentPackManifest / AgentPackTool contract
      state/             # SQLite + sqlite-vec state-store (runs, steps, memories) -- see its README
    agents/
      builder/
        index.ts        # Builder pack manifest (default export)
        tools/
          scaffoldFile.ts
          runTests.ts
      tester/
        index.ts        # Tester pack manifest (default export)
        tools/
          runTests.ts      # tester__run_tests -- validates sample-repo/, writes run+step state
          getRunStatus.ts  # tester__get_run_status -- reads run+step state back
    skills/
      README.md          # stub placeholder -- not a mountable unit yet (see Open Questions)
  sample-repo/           # sample target repo Builder's and Tester's tools operate against
  tests/
    registry.test.ts
    builder.test.ts
    tester.test.ts
    state-store.test.ts
  .vscode/
    mcp.json             # VS Code Agent Mode config (servers root key)
```

## Running locally

```bash
npm install
npm start          # runs servers/orchestrator/index.ts over stdio via tsx
```

VS Code Agent Mode will discover the server automatically once `.vscode/mcp.json` is present in the workspace, and the standalone Copilot Agent Host / Copilot CLI will discover it automatically once `.mcp.json` is present -- no manual registration beyond those files.

## MCP configuration

Iron Legion ships two workspace config files plus documents a third, user-level fallback path. They are **not interchangeable copies** -- each uses a different root key because each is read by a different host:

| File | Root key | Read by | Role |
| --- | --- | --- | --- |
| `.mcp.json` (repo root) | `mcpServers` | Standalone Copilot Agent Host / Copilot CLI | **Primary.** The native config surface for running Iron Legion outside VS Code itself. |
| `.vscode/mcp.json` | `servers` | VS Code (Agent Mode) | **Secondary / compatibility fallback.** VS Code forwards this config to the Agent Host automatically for servers like this one that don't need `${input:...}` variables, so keeping it costs little and preserves the existing VS Code workflow. Not removed or restructured by Phase 2 Step 2. |
| `~/.copilot/mcp-config.json` | `mcpServers` | Standalone Copilot Agent Host / Copilot CLI | **User-level fallback.** Convention for registering Iron Legion when you're working outside this repo's workspace (e.g. no `.mcp.json` in the current directory). Documented here only -- this repo does not generate or manage that file, since it's user-machine-specific. |

Both `.mcp.json` and `.vscode/mcp.json` currently register the same local stdio entry (`npx tsx servers/orchestrator/index.ts`) -- Phase 2 Step 2 only added the `.mcp.json` config surface, it did not change the server binary or its startup command.

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
5. If the pack needs to record run/step state, import the state-store's public exports (`runs.ts`/`steps.ts`/`index.ts` under `servers/orchestrator/state/`) rather than touching its SQLite schema directly -- see the Tester pack's `tools/runTests.ts` for the reference pattern (open a db, create a run + step, update them as work progresses, always close the db in a `finally`).

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

**Current tool count: 6 (within the <10 MVP budget)**

| Source | Tools |
| --- | --- |
| Orchestrator meta-tools | `orchestrator__list_packs`, `orchestrator__health` (2) |
| Builder pack | `builder__scaffold_file`, `builder__run_tests` (2) |
| Tester pack | `tester__run_tests`, `tester__get_run_status` (2) |

Any future pack must state its added tool count and get it justified against this budget in its own task before being merged.

## Testing

```bash
npm test
```

Covers: agent-pack manifest discovery, tool namespacing (`<pack-id>__<name>`), the Builder pack's `scaffold_file` happy path (`tests/builder.test.ts`), the Tester pack's manifest discovery/namespacing plus its `run_tests`/`get_run_status` happy paths and state-store run/step writes (`tests/tester.test.ts`), and the state-store's run/step CRUD plus semantic-recall query path (`tests/state-store.test.ts`).

## Open questions (non-blocking fast-follows)

1. ~~Whether Iron Legion's agent packs should call out to the already-live `skill-manager-mcp` for skill-related capability~~ -- resolved: skill-manager-mcp will not be available; Iron Legion builds first-party, parallel Tester/Docs/DevOps/Auditor packs and `/servers/skills/` instead.
2. ~~Where cross-run state/memory for future orchestration phases should live~~ -- resolved: a local SQLite + sqlite-vec store under `/servers/orchestrator/state/` (see Phase 2 Step 1), now proven from an agent pack by Tester (Phase 2 Step 3).
3. ~~Whether "VS Code Agent Mode" here means VS Code proper or the standalone Copilot Agent Host/CLI, which reads MCP config from a different file~~ -- resolved (Phase 2 Step 2): both are supported. `.mcp.json` (`mcpServers` key) is the primary surface for the standalone Agent Host/CLI; `.vscode/mcp.json` (`servers` key) remains for VS Code proper. See [MCP configuration](#mcp-configuration).
