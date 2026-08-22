import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { discoverAgentPacks, namespacedToolName } from "../servers/orchestrator/registry.js";
import { openStateDb, type StateDb } from "../servers/orchestrator/state/db.js";
import { listStepsForRun } from "../servers/orchestrator/state/steps.js";
import { getRun } from "../servers/orchestrator/state/runs.js";
import { generateSummaryWithDb, SUMMARY_OUTPUT_PATH } from "../servers/agents/docs/tools/generateSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_AGENTS_DIR = join(__dirname, "..", "servers", "agents");

describe("docs pack: manifest discovery & namespacing", () => {
  it("discovers the Docs pack from /servers/agents/", async () => {
    const packs = await discoverAgentPacks(REAL_AGENTS_DIR);
    const docs = packs.find((p) => p.id === "docs");

    expect(docs).toBeDefined();
    expect(docs?.displayName).toBe("Docs");
    expect(docs?.tools.map((t) => t.name).sort()).toEqual(["generate_summary"]);
  });

  it("namespaces docs tools as `docs__<name>`", () => {
    expect(namespacedToolName("docs", "generate_summary")).toBe("docs__generate_summary");
  });

  it("does not collide with the Builder's or Tester's tool names", async () => {
    const packs = await discoverAgentPacks(REAL_AGENTS_DIR);
    const allNamespaced = packs.flatMap((p) => p.tools.map((t) => namespacedToolName(p.id, t.name)));

    expect(new Set(allNamespaced).size).toBe(allNamespaced.length);
  });
});

describe("docs__generate_summary handler (state-store integration)", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  afterEach(async () => {
    await rm(SUMMARY_OUTPUT_PATH, { force: true });
  });

  it("records a run and an 'edit' step while generating the summary doc", async () => {
    const result = await generateSummaryWithDb(db, {});
    const parsed = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBeFalsy();
    expect(typeof parsed.runId).toBe("string");
    expect(typeof parsed.stepId).toBe("string");
    expect(parsed.fileCount).toBeGreaterThan(0);

    const steps = listStepsForRun(db, parsed.runId);
    expect(steps).toHaveLength(1);
    expect(steps[0].step_name).toBe("edit");
    expect(steps[0].status).toBe("done");
    expect(steps[0].started_at).not.toBeNull();
    expect(steps[0].finished_at).not.toBeNull();

    const run = getRun(db, parsed.runId);
    expect(run?.status).toBe("completed");
  });

  it("writes a summary doc listing the sample repo's files", async () => {
    await generateSummaryWithDb(db, {});
    const written = await readFile(SUMMARY_OUTPUT_PATH, "utf8");

    expect(written).toContain("generated summary");
    expect(written).toContain("README.md");
  });

  it("records project_path from input when provided", async () => {
    const result = await generateSummaryWithDb(db, { projectPath: "/tmp/custom-project" });
    const parsed = JSON.parse(result.content[0].text as string);

    const run = getRun(db, parsed.runId);
    expect(run?.project_path).toBe("/tmp/custom-project");
  });
});
