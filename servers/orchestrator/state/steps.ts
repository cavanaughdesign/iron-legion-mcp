import { randomUUID } from "node:crypto";
import type { StateDb } from "./db.js";
import type { RunStep, StepName, StepStatus } from "./types.js";

export interface CreateStepInput {
  run_id: string;
  step_name: StepName;
  status?: StepStatus;
  started_at?: string | null;
  finished_at?: string | null;
  output_ref?: string | null;
}

export function createStep(db: StateDb, input: CreateStepInput): RunStep {
  const step: RunStep = {
    id: randomUUID(),
    run_id: input.run_id,
    step_name: input.step_name,
    status: input.status ?? "pending",
    started_at: input.started_at ?? null,
    finished_at: input.finished_at ?? null,
    output_ref: input.output_ref ?? null,
  };

  db.prepare(
    `INSERT INTO run_steps (id, run_id, step_name, status, started_at, finished_at, output_ref)
     VALUES (@id, @run_id, @step_name, @status, @started_at, @finished_at, @output_ref)`
  ).run(step);

  return step;
}

export function getStep(db: StateDb, id: string): RunStep | undefined {
  return db.prepare(`SELECT * FROM run_steps WHERE id = ?`).get(id) as RunStep | undefined;
}

export function listStepsForRun(db: StateDb, runId: string): RunStep[] {
  return db
    .prepare(`SELECT * FROM run_steps WHERE run_id = ? ORDER BY COALESCE(started_at, '') ASC, rowid ASC`)
    .all(runId) as RunStep[];
}

export interface UpdateStepInput {
  status?: StepStatus;
  started_at?: string | null;
  finished_at?: string | null;
  output_ref?: string | null;
}

export function updateStep(db: StateDb, id: string, patch: UpdateStepInput): RunStep | undefined {
  const existing = getStep(db, id);
  if (!existing) return undefined;

  const next: RunStep = { ...existing, ...patch };

  db.prepare(
    `UPDATE run_steps SET status = @status, started_at = @started_at, finished_at = @finished_at, output_ref = @output_ref
     WHERE id = @id`
  ).run(next);

  return next;
}

export function deleteStep(db: StateDb, id: string): boolean {
  const result = db.prepare(`DELETE FROM run_steps WHERE id = ?`).run(id);
  return result.changes > 0;
}
