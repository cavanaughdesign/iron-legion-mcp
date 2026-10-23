import { run } from "../../../factory/process.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createRun,
  createStep,
  updateRun,
  updateStep,
  openStateDb,
} from "../../../orchestrator/state/index.js";
import type { StateDb } from "../../../orchestrator/state/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Sample repo Tester's tools validate, per the addendum's "Tester validates what Builder produces" intent. */
export const SAMPLE_REPO_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "sample-repo",
);

function runNodeTestRunner(
  cwd: string,
  pattern?: string,
): Promise<{ code: number; output: string }> {
  return run(
    {
      executable: process.execPath,
      args: ["--test", ...(pattern ? [`--test-name-pattern=${pattern}`] : [])],
      timeoutSeconds: 120,
    },
    cwd,
  );
}

export interface RunTestsInput {
  pattern?: string;
  projectPath?: string;
}

/**
 * Core handler logic, parameterized on an already-open state-store `db` so tests can
 * inject an in-memory database (see tests/tester.test.ts) instead of touching the
 * real on-disk iron-legion.db. The MCP-facing `runTests` below opens/closes the
 * default db and delegates here.
 *
 * This is the addendum's explicit reason Tester is sequenced before Docs/DevOps: it
 * proves the Phase 2 Step 1 state-store pattern works end-to-end from an agent pack --
 * create a run record, record per-step status as the tool executes, and persist the
 * final result -- before any other pack reuses the same runs.ts/steps.ts exports.
 */
export async function runTestsWithDb(
  db: StateDb,
  input: RunTestsInput,
): Promise<CallToolResult> {
  const run = createRun(db, {
    project_path: input?.projectPath ?? SAMPLE_REPO_ROOT,
  });
  const step = createStep(db, {
    run_id: run.id,
    step_name: "test",
    status: "running",
    started_at: new Date().toISOString(),
  });

  try {
    const { code, output } = await runNodeTestRunner(
      SAMPLE_REPO_ROOT,
      input?.pattern,
    );
    const passed = code === 0;
    const finishedAt = new Date().toISOString();
    const text =
      output ||
      (passed ? "Tests passed (no output)." : "Tests failed (no output).");

    updateStep(db, step.id, {
      status: passed ? "done" : "failed",
      finished_at: finishedAt,
      output_ref: text.slice(0, 4000),
    });
    updateRun(db, run.id, {
      status: passed ? "completed" : "failed",
      finished_at: finishedAt,
      summary: passed
        ? "Tester validated Builder's output: sample repo tests passed."
        : "Tester found failing tests in Builder's output.",
    });

    return {
      isError: !passed,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { runId: run.id, stepId: step.id, passed, output: text },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const message = (err as Error).message;

    updateStep(db, step.id, {
      status: "failed",
      finished_at: finishedAt,
      output_ref: message,
    });
    updateRun(db, run.id, {
      status: "failed",
      finished_at: finishedAt,
      summary: `Tester crashed: ${message}`,
    });

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { runId: run.id, stepId: step.id, error: message },
            null,
            2,
          ),
        },
      ],
    };
  }
}

/** MCP tool handler: opens the default state-store db, delegates, and always closes it. */
export async function runTests(
  input: RunTestsInput,
  _extra?: unknown,
): Promise<CallToolResult> {
  const db = openStateDb();
  try {
    return await runTestsWithDb(db, input ?? {});
  } finally {
    db.close();
  }
}
