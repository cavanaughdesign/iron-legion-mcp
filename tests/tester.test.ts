import { beforeEach, describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAgentPacks, namespacedToolName } from "../servers/orchestrator/registry.js";
import { openStateDb, type StateDb } from "../servers/orchestrator/state/db.js";
import { listStepsForRun } from "../servers/orchestrator/state/steps.js";
import { runTestsWithDb } from "../servers/agents/tester/tools/runTests.js";
import { getRunStatusWithDb } from "../servers/agents/tester/tools/getRunStatus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_AGENTS_DIR = join(__dirname, "..", "servers", "agents");

describe("tester pack: manifest discovery & namespacing", () => {
  it("discovers the Tester pack from /servers/agents/", async () => {
    const packs = await discoverAgentPacks(REAL_AGENTS_DIR);
    const tester = packs.find((p) => p.id === "tester");

    expect(tester).toBeDefined();
    expect(tester?.displayName).toBe("Tester");
    expect(tester?.tools.map((t) => t.name).sort()).toEqual(["get_run_status", "run_tests"]);
  });

  it("namespaces tester tools as `tester__<name>`", () => {
    expect(namespacedToolName("tester", "run_tests")).toBe("tester__run_tests");
    expect(namespacedToolName("tester", "get_run_status")).toBe("tester__get_run_status");
  });

  it("does not collide with the Builder pack's tool names", async () => {
    const packs = await discoverAgentPacks(REAL_AGENTS_DIR);
    const allNamespaced = packs.flatMap((p) => p.tools.map((t) => namespacedToolName(p.id, t.name)));

    expect(new Set(allNamespaced).size).toBe(allNamespaced.length);
  });
});

describe("tester__run_tests handler (state-store integration)", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  it("records a run and a 'test' step while validating the sample repo", async () => {
    const result = await runTestsWithDb(db, {});
    const parsed = JSON.parse(result.content[0].text as string);

    expect(result.isError).toBeFalsy();
    expect(typeof parsed.runId).toBe("string");
    expect(typeof parsed.stepId).toBe("string");
    expect(parsed.passed).toBe(true);

    const steps = listStepsForRun(db, parsed.runId);
    expect(steps).toHaveLength(1);
    expect(steps[0].step_name).toBe("test");
    expect(steps[0].status).toBe("done");
    expect(steps[0].started_at).not.toBeNull();
    expect(steps[0].finished_at).not.toBeNull();
  });

  it("records project_path from input when provided", async () => {
    const result = await runTestsWithDb(db, { projectPath: "/tmp/custom-project" });
    const parsed = JSON.parse(result.content[0].text as string);

    const status = await getRunStatusWithDb(db, { runId: parsed.runId });
    const statusParsed = JSON.parse(status.content[0].text as string);
    expect(statusParsed.run.project_path).toBe("/tmp/custom-project");
  });
});

describe("tester__get_run_status handler", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  it("reads back the run + steps recorded by run_tests", async () => {
    const runResult = await runTestsWithDb(db, {});
    const { runId, stepId } = JSON.parse(runResult.content[0].text as string);

    const statusResult = await getRunStatusWithDb(db, { runId });
    const status = JSON.parse(statusResult.content[0].text as string);

    expect(status.run.id).toBe(runId);
    expect(status.run.status).toBe("completed");
    expect(status.steps).toHaveLength(1);
    expect(status.steps[0].id).toBe(stepId);
  });

  it("returns an error result for an unknown run id", async () => {
    const result = await getRunStatusWithDb(db, { runId: "does-not-exist" });
    expect(result.isError).toBe(true);
  });
});
