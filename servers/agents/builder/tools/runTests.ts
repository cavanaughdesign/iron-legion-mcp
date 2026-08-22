import { spawn } from "node:child_process";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SAMPLE_REPO_ROOT } from "./scaffoldFile.js";

function runNodeTestRunner(cwd: string, pattern?: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const args = ["--test"];
    if (pattern) args.push(`--test-name-pattern=${pattern}`);

    const child = spawn(process.execPath, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (output += chunk.toString()));
    child.on("error", (err) => resolve({ code: 1, output: `Failed to spawn test runner: ${err.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Runs the sample repo's tests via Node's built-in test runner (node --test),
 * scoped to the bundled sample-repo/ so this tool has a real, safe target to operate on.
 */
export async function runTests(input: { pattern?: string }, _extra?: unknown): Promise<CallToolResult> {
  try {
    const { code, output } = await runNodeTestRunner(SAMPLE_REPO_ROOT, input?.pattern);
    return {
      isError: code !== 0,
      content: [{ type: "text", text: output || (code === 0 ? "Tests passed (no output)." : "Tests failed (no output).") }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `run_tests failed: ${(err as Error).message}` }],
    };
  }
}
