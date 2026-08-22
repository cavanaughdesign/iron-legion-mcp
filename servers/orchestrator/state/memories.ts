import { randomUUID } from "node:crypto";
import type { StateDb } from "./db.js";
import { embedText } from "./embeddings.js";
import type { Memory, MemoryKind, MemoryRecallResult } from "./types.js";

export interface CreateMemoryInput {
  run_id?: string | null;
  kind: MemoryKind;
  text: string;
  created_at?: string;
}

/**
 * Inserts a memory row plus its embedding vector. `memories_vec` rows are
 * rowid-aligned with `memories` per the addendum's contract: insert into
 * `memories` first, capture its rowid, then insert the matching vector row
 * with that same rowid -- wrapped in one transaction so the tables can't drift.
 */
export async function createMemory(db: StateDb, input: CreateMemoryInput): Promise<Memory> {
  const memory: Memory = {
    id: randomUUID(),
    run_id: input.run_id ?? null,
    kind: input.kind,
    text: input.text,
    created_at: input.created_at ?? new Date().toISOString(),
  };

  const embedding = await embedText(memory.text);

  const insertMemory = db.prepare(
    `INSERT INTO memories (id, run_id, kind, text, created_at)
     VALUES (@id, @run_id, @kind, @text, @created_at)`
  );
  const insertVec = db.prepare(`INSERT INTO memories_vec (rowid, embedding) VALUES (?, ?)`);

  const runInsert = db.transaction((m: Memory, vec: Float32Array) => {
    const info = insertMemory.run(m);
    insertVec.run(info.lastInsertRowid, vec);
  });
  runInsert(memory, embedding);

  return memory;
}

export function getMemory(db: StateDb, id: string): Memory | undefined {
  return db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Memory | undefined;
}

export function listMemoriesForRun(db: StateDb, runId: string): Memory[] {
  return db
    .prepare(`SELECT * FROM memories WHERE run_id = ? ORDER BY created_at ASC`)
    .all(runId) as Memory[];
}

export function deleteMemory(db: StateDb, id: string): boolean {
  const row = db.prepare(`SELECT rowid FROM memories WHERE id = ?`).get(id) as { rowid: number } | undefined;
  if (!row) return false;

  const del = db.transaction((rowid: number, memoryId: string) => {
    db.prepare(`DELETE FROM memories_vec WHERE rowid = ?`).run(rowid);
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(memoryId);
  });
  del(row.rowid, id);

  return true;
}

/**
 * Semantic recall: embeds `query` with the same local model used at write
 * time, finds the k nearest `memories_vec` rows by distance, then joins back
 * to `memories` for full records -- the pattern locked in the addendum.
 */
export async function recallMemories(db: StateDb, query: string, k = 5): Promise<MemoryRecallResult[]> {
  const queryEmbedding = await embedText(query);

  return db
    .prepare(
      `SELECT memories.*, memories_vec.distance AS distance
       FROM memories_vec
       JOIN memories ON memories.rowid = memories_vec.rowid
       WHERE memories_vec.embedding MATCH ?
       ORDER BY memories_vec.distance
       LIMIT ?`
    )
    .all(queryEmbedding, k) as MemoryRecallResult[];
}
