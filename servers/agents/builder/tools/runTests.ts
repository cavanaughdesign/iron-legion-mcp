import { run } from "../../../factory/process.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SAMPLE_REPO_ROOT } from "./scaffoldFile.js";

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

/**
 * Runs the sample repo's tests via Node's built-in test runner (node --test),
 * scoped to the bundled sample-repo/ so this tool has a real, safe target to operate on.
 */
export async function runTests(
  input: { pattern?: string },
  _extra?: unknown,
): Promise<CallToolResult> {
  try {
    const { code, output } = await runNodeTestRunner(
      SAMPLE_REPO_ROOT,
      input?.pattern,
    );
    return {
      isError: code !== 0,
      content: [
        {
          type: "text",
          text:
            output ||
            (code === 0
              ? "Tests passed (no output)."
              : "Tests failed (no output)."),
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        { type: "text", text: `run_tests failed: ${(err as Error).message}` },
      ],
    };
  }
}
