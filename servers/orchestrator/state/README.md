# State-store module

Local persistence layer for the Iron Legion orchestrator's runs, steps, and
semantic memory recall. Built on **SQLite + the `sqlite-vec` extension**, via
`better-sqlite3` bindings -- chosen over Postgres+pgvector because this
project is locked to local stdio-only hosting: pgvector would require
standing up a server process, which contradicts that decision. No server,
no remote infra, one file on disk.

## First-run behavior

`openStateDb()` is idempotent. On every call it:

1. Creates `state/` if it doesn't exist yet.
2. Opens (or creates) `iron-legion.db`.
3. Loads the `sqlite-vec` extension into the connection.
4. Runs `CREATE TABLE IF NOT EXISTS` / `CREATE VIRTUAL TABLE IF NOT EXISTS`
   for `runs`, `run_steps`, `memories`, and `memories_vec`.

There is no separate manual migration step -- call `openStateDb()` once at
orchestrator boot (or at the top of any script/test that needs the DB) and
it self-initializes.

## DB file

`iron-legion.db` (plus its `-wal` / `-shm` sidecar files, since connections
opened against a real file use WAL journal mode) lives in this directory and
is **gitignored** -- it's runtime data, not source. `.gitkeep` keeps the
directory itself tracked so `state/` exists on a fresh clone before first run.

## Schema

Exactly as locked in the Phase 2 addendum:

- `runs` -- one row per orchestrator run (id, project_path, started_at,
  finished_at, status, summary).
- `run_steps` -- one row per step within a run (id, run_id, step_name,
  status, started_at, finished_at, output_ref).
- `memories` -- free-text notes/decisions/summaries attached to a run (id,
  run_id, kind, text, created_at).
- `memories_vec` -- a `sqlite-vec` `vec0` virtual table holding one embedding
  vector per `memories` row, rowid-aligned with it.

## Embedding model

Semantic recall uses **`Xenova/all-MiniLM-L6-v2`** via `@xenova/transformers`
(transformers.js, ONNX runtime) -- fully in-process, no external API calls
once the model weights are cached locally after first load. This follows
Anthony's confirmed local-embedding decision (zero per-call cost, works
offline after first download).

**Dimension: 384.** `EMBED_DIM = 384` is pinned in `embeddings.ts` and used
to size `memories_vec` (`embedding float[384]`). Rationale:

- `all-MiniLM-L6-v2` is a well-established, widely used sentence-embedding
  model with a mature transformers.js/ONNX conversion, which minimizes
  integration risk for a first-party, no-external-dependency build.
- Its 384-dimensional output keeps `memories_vec` small and fast for a
  single-project local tool, while still giving solid semantic-similarity
  quality for the short decision/run-summary/note strings this store holds.
- `embedText()` throws if the loaded model's actual output size doesn't
  match `EMBED_DIM`, so a future model swap can't silently corrupt the
  vector index -- `EMBED_DIM` and the `memories_vec` schema must be updated
  together if the model ever changes.

## Rowid alignment

`memories_vec` rows are rowid-aligned with `memories`. `createMemory()`
inserts into `memories` first, captures `lastInsertRowid`, then inserts the
matching vector row with that same rowid -- both inside one
`db.transaction(...)` so the two tables can never drift apart. `deleteMemory()`
mirrors this: it removes the `memories_vec` row by rowid before removing the
`memories` row.

## Semantic recall

```
embed(query) -> SELECT memories.*, memories_vec.distance
                FROM memories_vec
                JOIN memories ON memories.rowid = memories_vec.rowid
                WHERE memories_vec.embedding MATCH ?
                ORDER BY memories_vec.distance
                LIMIT ?
```

## Usage

```ts
import { openStateDb, createRun, createStep, createMemory, recallMemories } from "./state/index.js";

const db = openStateDb();

const run = createRun(db, { project_path: "/path/to/project" });
const step = createStep(db, { run_id: run.id, step_name: "analyze" });

await createMemory(db, {
  run_id: run.id,
  kind: "decision",
  text: "Chose SQLite + sqlite-vec over Postgres for local-only hosting.",
});

const hits = await recallMemories(db, "why did we pick sqlite?", 3);
```

## Tests

See `tests/state-store.test.ts` -- covers run CRUD, step CRUD, and the
embed -> MATCH -> join semantic-recall path against an in-memory DB. Note:
the first test run downloads and caches the embedding model's weights, so
it needs network access once; subsequent runs use the local cache.

## Out of scope here

`.mcp.json` wiring, the Tester pack, and Docs/DevOps/Auditor/`/servers/skills/`
work are later steps per the addendum's sequencing -- this module is an
internal library only and does not register any MCP tools itself.
