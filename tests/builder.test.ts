import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldFile } from "../servers/agents/builder/tools/scaffoldFile.js";

// scaffoldFile resolves paths against a fixed SAMPLE_REPO_ROOT import, so we exercise
// its exported resolver indirectly by pointing at a temp dir via the same module contract
// is not directly overridable here; instead we validate the handler's happy-path behavior
// against the real bundled sample-repo/ fixture, then clean up any file it created.

const TEST_FILE_REL = "__vitest_scratch__/happy-path.txt";

describe("builder scaffold_file handler", () => {
  afterEach(async () => {
    await rm(join(process.cwd(), "sample-repo", "__vitest_scratch__"), {
      recursive: true,
      force: true,
    });
  });

  it("writes a new file and reports success", async () => {
    const result = await scaffoldFile({
      path: TEST_FILE_REL,
      contents: "hello iron legion",
    });

    expect(result.isError).toBeFalsy();
    const written = await readFile(
      join(process.cwd(), "sample-repo", TEST_FILE_REL),
      "utf8",
    );
    expect(written).toBe("hello iron legion");
  });

  it("refuses to overwrite an existing file unless overwrite: true", async () => {
    await scaffoldFile({ path: TEST_FILE_REL, contents: "first" });
    const second = await scaffoldFile({
      path: TEST_FILE_REL,
      contents: "second",
    });

    expect(second.isError).toBe(true);

    const overwritten = await scaffoldFile({
      path: TEST_FILE_REL,
      contents: "second",
      overwrite: true,
    });
    expect(overwritten.isError).toBeFalsy();
  });

  it("refuses to write outside the sample repo root", async () => {
    const result = await scaffoldFile({
      path: "../escape.txt",
      contents: "nope",
    });
    expect(result.isError).toBe(true);
  });
  it("refuses a directory junction outside the sample repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "iron-builder-junction-"));
    const scratch = join(process.cwd(), "sample-repo", "__vitest_scratch__");
    try {
      await mkdir(scratch, { recursive: true });
      await symlink(
        outside,
        join(scratch, "outside"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const result = await scaffoldFile({
        path: "__vitest_scratch__/outside/escape.txt",
        contents: "refuse",
      });
      expect(result.isError).toBe(true);
      await expect(readFile(join(outside, "escape.txt"))).rejects.toThrow();
    } finally {
      await rm(scratch, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
