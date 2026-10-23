import { mkdir, writeFile, lstat, realpath } from "node:fs/promises";
import { dirname, join, normalize, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { inside } from "../../../factory/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Sample repo Builder's tools operate against, per spec acceptance criteria #3. */
export const SAMPLE_REPO_ROOT = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "sample-repo",
);

function resolveWithinSampleRepo(
  relativePath: string,
  root: string = SAMPLE_REPO_ROOT,
): string {
  const target = normalize(join(root, relativePath));
  const rel = relative(root, target);
  if (
    rel.startsWith("..") ||
    rel === "" ||
    isAbsolute(relativePath) ||
    relativePath.includes(":")
  ) {
    throw new Error(
      `Path "${relativePath}" escapes the sample repo root; refusing to write.`,
    );
  }
  return target;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function scaffoldFile(
  input: { path: string; contents: string; overwrite?: boolean },
  _extra?: unknown,
): Promise<CallToolResult> {
  const { path, contents, overwrite = false } = input;

  try {
    const target = resolveWithinSampleRepo(path);
    const root = await realpath(SAMPLE_REPO_ROOT);
    let ancestor = target;
    while (!(await fileExists(ancestor))) ancestor = dirname(ancestor);
    if (!inside(root, await realpath(ancestor)))
      throw new Error("Path follows a link outside the sample repository.");

    if (!overwrite && (await fileExists(target))) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `File already exists at "${path}". Pass overwrite: true to replace it.`,
          },
        ],
      };
    }

    await mkdir(dirname(target), { recursive: true });
    if (!inside(root, await realpath(dirname(target))))
      throw new Error("Parent resolves outside the sample repository.");
    await writeFile(target, contents, {
      encoding: "utf8",
      flag: overwrite ? "w" : "wx",
    });

    return {
      content: [
        {
          type: "text",
          text: `Wrote ${Buffer.byteLength(contents)} bytes to ${path}`,
        },
      ],
    };
  } catch (err) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `scaffold_file failed: ${(err as Error).message}`,
        },
      ],
    };
  }
}
