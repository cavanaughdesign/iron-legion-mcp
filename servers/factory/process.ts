import { spawn, type ChildProcess } from "node:child_process";
import type { Command } from "./contracts.js";

export interface ProcessResult {
  code: number;
  output: string;
  stdout: string;
  stderr: string;
}
export async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/t", "/f"],
        { windowsHide: true, stdio: "ignore" },
      );
      killer.on("close", () => resolve());
      killer.on("error", () => {
        child.kill();
        resolve();
      });
    });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
export function run(
  command: Command,
  cwd: string,
  options: {
    input?: string;
    signal?: AbortSignal;
    env?: Record<string, string>;
    limit?: number;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted)
      return reject(new Error("Operation cancelled."));
    const env: NodeJS.ProcessEnv = {};
    // Deliberately exclude service tokens and arbitrary parent environment variables.
    for (const key of [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "ComSpec",
      "PATHEXT",
      "LANG",
      "SSL_CERT_FILE",
      "IRON_LEGION_CODEX_BINARY",
    ])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, options.env);
    const child = spawn(command.executable, command.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      stdout = "",
      stderr = "",
      error: Error | undefined,
      finished = false;
    const stop = (message: string) => {
      if (error) return;
      error = new Error(message);
      void killTree(child);
    };
    const cancel = () => stop("Operation cancelled.");
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () => stop(`Command exceeded ${command.timeoutSeconds}s.`),
      command.timeoutSeconds * 1000,
    );
    const collect = (chunk: string) => {
      output += chunk;
      if (output.length > (options.limit ?? 2_000_000)) {
        output = output.slice(-(options.limit ?? 2_000_000));
        stop("Command output limit exceeded.");
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = (stdout + chunk).slice(-(options.limit ?? 2_000_000));
      collect(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-(options.limit ?? 2_000_000));
      collect(chunk);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
    const finish = (code: number, spawnError?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (error || spawnError) reject(error ?? spawnError);
      else resolve({ code, output, stdout, stderr });
    };
    child.once("error", (e) => finish(1, e));
    child.once("close", (code) => finish(code ?? 1));
  });
}
export async function git(
  root: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const r = await run({ executable: "git", args, timeoutSeconds: 90 }, root, {
    signal,
  });
  if (r.code) throw new Error(`Git operation failed: ${r.output.slice(-1500)}`);
  return r.stdout.trim();
}
