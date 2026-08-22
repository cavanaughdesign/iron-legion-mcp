import { beforeEach, describe, expect, it } from "vitest";
import { openStateDb, type StateDb } from "../servers/orchestrator/state/db.js";
import { createRun, getRun, listRuns, updateRun } from "../servers/orchestrator/state/runs.js";
import { createStep, listStepsForRun, updateStep } from "../servers/orchestrator/state/steps.js";
import { createMemory, recallMemories } from "../servers/orchestrator/state/memories.js";

describe("state-store: run CRUD", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  it("creates and fetches a run", () => {
    const run = createRun(db, { project_path: "/tmp/project" });
    expect(run.status).toBe("running");

    const fetched = getRun(db, run.id);
    expect(fetched).toEqual(run);
  });

  it("updates run status and finished_at", () => {
    const run = createRun(db, { project_path: "/tmp/project" });
    const updated = updateRun(db, run.id, {
      status: "completed",
      finished_at: "2026-08-21T00:00:00.000Z",
    });

    expect(updated?.status).toBe("completed");
    expect(updated?.finished_at).toBe("2026-08-21T00:00:00.000Z");
  });

  it("lists runs newest-first by started_at", () => {
    const first = createRun(db, { project_path: "/tmp/a", started_at: "2026-08-20T00:00:00.000Z" });
    const second = createRun(db, { project_path: "/tmp/b", started_at: "2026-08-21T00:00:00.000Z" });

    const runs = listRuns(db);
    expect(runs.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it("returns undefined when updating a run that doesn't exist", () => {
    expect(updateRun(db, "does-not-exist", { status: "failed" })).toBeUndefined();
  });
});

describe("state-store: run_steps CRUD", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  it("creates steps scoped to a run and lists them in order", () => {
    const run = createRun(db, { project_path: "/tmp/project" });
    createStep(db, { run_id: run.id, step_name: "analyze", started_at: "2026-08-21T00:00:00.000Z" });
    createStep(db, { run_id: run.id, step_name: "plan", started_at: "2026-08-21T00:01:00.000Z" });

    const steps = listStepsForRun(db, run.id);
    expect(steps.map((s) => s.step_name)).toEqual(["analyze", "plan"]);
  });

  it("updates step status and finished_at", () => {
    const run = createRun(db, { project_path: "/tmp/project" });
    const step = createStep(db, { run_id: run.id, step_name: "edit" });

    const updated = updateStep(db, step.id, { status: "done", finished_at: "2026-08-21T00:05:00.000Z" });
    expect(updated?.status).toBe("done");
    expect(updated?.finished_at).toBe("2026-08-21T00:05:00.000Z");
  });
});

describe("state-store: semantic recall", () => {
  let db: StateDb;

  beforeEach(() => {
    db = openStateDb(":memory:");
  });

  it(
    "recalls the most semantically similar memory first",
    async () => {
      const run = createRun(db, { project_path: "/tmp/project" });

      await createMemory(db, {
        run_id: run.id,
        kind: "decision",
        text: "We chose SQLite with sqlite-vec instead of Postgres for local-only hosting.",
      });
      await createMemory(db, {
        run_id: run.id,
        kind: "note",
        text: "The build pipeline runs vitest for unit tests on every push.",
      });

      const results = await recallMemories(db, "why did we pick sqlite over postgres?", 1);

      expect(results).toHaveLength(1);
      expect(results[0].text).toContain("SQLite");
    },
    30000
  );
});
