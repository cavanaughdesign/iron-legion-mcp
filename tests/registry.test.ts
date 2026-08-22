import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAgentPacks, namespacedToolName } from "../servers/orchestrator/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_AGENTS_DIR = join(__dirname, "..", "servers", "agents");

describe("discoverAgentPacks", () => {
  it("discovers the Builder pack from /servers/agents/", async () => {
    const packs = await discoverAgentPacks(REAL_AGENTS_DIR);
    const builder = packs.find((p) => p.id === "builder");

    expect(builder).toBeDefined();
    expect(builder?.tools.length).toBeGreaterThanOrEqual(2);
  });

  it("returns an empty list for a directory with no packs", async () => {
    const packs = await discoverAgentPacks(join(__dirname, "..", "servers", "skills"));
    expect(packs).toEqual([]);
  });
});

describe("namespacedToolName", () => {
  it("namespaces tool names as `${packId}__${toolName}`", () => {
    expect(namespacedToolName("builder", "scaffold_file")).toBe("builder__scaffold_file");
  });
});
