import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EMBED_DIM } from "./embeddings.js";
import { SCHEMA_SQL, vecTableSql } from "./schema.js";
import { dataHome } from "../../factory/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default on-disk location for the Iron Legion state DB (gitignored, created on first run). */
export const DEFAULT_DB_PATH = join(dataHome, "legacy-state.db");

export type StateDb = InstanceType<typeof Database>;

/**
 * Opens (creating if absent) the Iron Legion SQLite state DB, loads the
 * sqlite-vec extension, and idempotently ensures the full schema exists.
 * Safe to call on every orchestrator boot -- there is no separate migration step.
 *
 * Pass ":memory:" (or another path) to override the default, e.g. for tests.
 */
export function openStateDb(dbPath: string = DEFAULT_DB_PATH): StateDb {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (dbPath !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  sqliteVec.load(db);

  db.exec(SCHEMA_SQL);
  db.exec(vecTableSql(EMBED_DIM));

  return db;
}
