import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Sample repo Builder's tools operate against, per spec acceptance criteria #3. */
export const SAMPLE_REPO_ROOT = join(__dirname, "..", "..", "..", "..", "sample-repo");

function resolveWithinSampleRepo(relativePath: string, root: string = SAMPLE_REPO_ROOT): string {
  const target = normalize(join(root, relativePath));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Path "${relativePath}" escapes the sample repo root; refusing to write.`);
  }
  return target;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function scaffoldFile(
  input: { path: string; contents: string; overwrite?: boolean },
  _extra?: unknown
): Promise<CallToolResult> {
  const { path, contents, overwrite = false } = input;

  try {
    const target = resolveWithinSampleRepo(path);

    if (!overwrite && (await fileExists(target))) {
      return {
        isError: true,
        content: [{ type: "text", text: `File already exists at "${path}". Pass overwrite: true to replace it.` }],
      };
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");

    return {
      content: [{ type: "text", text: `Wrote ${contents.length} bytes to ${path}` }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `scaffold_file failed: ${(err as Error).message}` }],
    };
  }
}
