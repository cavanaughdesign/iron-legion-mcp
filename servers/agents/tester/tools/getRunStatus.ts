import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getRun,
  listStepsForRun,
  openStateDb,
} from "../../../orchestrator/state/index.js";
import type { StateDb } from "../../../orchestrator/state/index.js";

export interface GetRunStatusInput {
  runId: string;
}

/** Core handler logic, parameterized on an already-open db -- see runTests.ts for why. */
export async function getRunStatusWithDb(
  db: StateDb,
  input: GetRunStatusInput,
): Promise<CallToolResult> {
  const run = getRun(db, input.runId);
  if (!run) {
    return {
      isError: true,
      content: [
        { type: "text", text: `No run found with id "${input.runId}".` },
      ],
    };
  }

  const steps = listStepsForRun(db, run.id);

  return {
    content: [{ type: "text", text: JSON.stringify({ run, steps }, null, 2) }],
  };
}

/** MCP tool handler: opens the default state-store db, delegates, and always closes it. */
export async function getRunStatus(
  input: GetRunStatusInput,
  _extra?: unknown,
): Promise<CallToolResult> {
  const db = openStateDb();
  try {
    return await getRunStatusWithDb(db, input);
  } finally {
    db.close();
  }
}
