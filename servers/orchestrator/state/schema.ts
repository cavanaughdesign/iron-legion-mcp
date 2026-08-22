import { EMBED_DIM } from "./embeddings.js";

/**
 * Locked schema for `runs`, `run_steps`, and `memories` -- see the Phase 2
 * addendum for the source of truth. All statements are idempotent
 * (CREATE ... IF NOT EXISTS) so `openStateDb` can safely run them on every boot.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  output_ref TEXT
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

/** `memories_vec` virtual table DDL, sized to the given embedding dimension. */
export function vecTableSql(dim: number = EMBED_DIM): string {
  return `CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(\n  embedding float[${dim}]\n);`;
}
