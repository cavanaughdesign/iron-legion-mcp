import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentPackManifest } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to /servers/agents/, resolved relative to this file. */
export const AGENTS_DIR = join(__dirname, "..", "agents");

function isValidManifest(value: unknown): value is AgentPackManifest {
  if (!value || typeof value !== "object") return false;
  const m = value as Partial<AgentPackManifest>;
  return (
    typeof m.id === "string" &&
    m.id.length > 0 &&
    typeof m.displayName === "string" &&
    typeof m.description === "string" &&
    Array.isArray(m.tools)
  );
}

/**
 * Scans each agent directory for index.ts or index.js exporting an AgentPackManifest.
 * The orchestrator never hardcodes pack imports -- every pack is discovered here.
 */
export async function discoverAgentPacks(
  agentsDir: string = AGENTS_DIR,
): Promise<AgentPackManifest[]> {
  const manifests: AgentPackManifest[] = [];
  if (!existsSync(agentsDir)) return manifests;

  const entries = readdirSync(agentsDir, { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );

  for (const entry of entries) {
    const candidates = ["index.ts", "index.js"].map((f) =>
      join(agentsDir, entry.name, f),
    );
    const target = candidates.find((c) => existsSync(c));
    if (!target) continue;

    const mod = (await import(pathToFileURL(target).href)) as {
      default?: unknown;
    };
    if (!isValidManifest(mod.default)) {
      console.error(
        `[orchestrator] Skipping pack "${entry.name}": missing or invalid default-exported AgentPackManifest`,
      );
      continue;
    }
    manifests.push(mod.default);
  }

  return manifests;
}

/** Namespaces a tool name as `${packId}__${toolName}`, per the interface contract. */
export function namespacedToolName(packId: string, toolName: string): string {
  return `${packId}__${toolName}`;
}
