import { randomUUID } from "node:crypto";
import type { StateDb } from "./db.js";
import type { Run, RunStatus } from "./types.js";

export interface CreateRunInput {
  project_path: string;
  started_at?: string;
  status?: RunStatus;
  summary?: string | null;
}

export function createRun(db: StateDb, input: CreateRunInput): Run {
  const run: Run = {
    id: randomUUID(),
    project_path: input.project_path,
    started_at: input.started_at ?? new Date().toISOString(),
    finished_at: null,
    status: input.status ?? "running",
    summary: input.summary ?? null,
  };

  db.prepare(
    `INSERT INTO runs (id, project_path, started_at, finished_at, status, summary)
     VALUES (@id, @project_path, @started_at, @finished_at, @status, @summary)`,
  ).run(run);

  return run;
}

export function getRun(db: StateDb, id: string): Run | undefined {
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
    Run | undefined;
}

export function listRuns(db: StateDb): Run[] {
  return db
    .prepare(`SELECT * FROM runs ORDER BY started_at DESC`)
    .all() as Run[];
}

export interface UpdateRunInput {
  finished_at?: string | null;
  status?: RunStatus;
  summary?: string | null;
}

export function updateRun(
  db: StateDb,
  id: string,
  patch: UpdateRunInput,
): Run | undefined {
  const existing = getRun(db, id);
  if (!existing) return undefined;

  const next: Run = { ...existing, ...patch };

  db.prepare(
    `UPDATE runs SET finished_at = @finished_at, status = @status, summary = @summary WHERE id = @id`,
  ).run(next);

  return next;
}

export function deleteRun(db: StateDb, id: string): boolean {
  const result = db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  return result.changes > 0;
}
