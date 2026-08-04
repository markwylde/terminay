import { spawn } from "node:child_process";
import { TextDecoder } from "node:util";
import type { GitCommandOptions, GitCommandResult, GitCommandRunner } from "./types.js";

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

/** Executes Git without a shell. The inherited process environment is the
 * server's Git environment; it is never returned as part of a result. */
export class NodeGitCommandRunner implements GitCommandRunner {
  run(args: readonly string[], cwd: string, options: GitCommandOptions = {}): Promise<GitCommandResult> {
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new RangeError("maxOutputBytes must be positive");

    return new Promise<GitCommandResult>((resolve, reject) => {
      const child = spawn("git", [...args], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        signal: options.signal,
      });
      const stdout = new ByteCollector(maxOutputBytes);
      const stderr = new ByteCollector(maxOutputBytes);
      let settled = false;
      let truncated = false;

      const finish = (result: GitCommandResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const stopForLimit = () => {
        if (truncated || settled) return;
        truncated = true;
        child.kill("SIGTERM");
      };

      child.stdout.on("data", (chunk: Buffer | string) => {
        if (!stdout.push(chunk, maxOutputBytes - stdout.byteLength() - stderr.byteLength())) stopForLimit();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        if (!stderr.push(chunk, maxOutputBytes - stdout.byteLength() - stderr.byteLength())) stopForLimit();
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (error.name === "AbortError" || error.code === "ABORT_ERR") {
          fail(error);
          return;
        }
        if (error.code === "ENOENT") {
          const unavailable = new Error("git executable is unavailable") as NodeJS.ErrnoException;
          unavailable.code = "GIT_UNAVAILABLE";
          fail(unavailable);
          return;
        }
        fail(error);
      });
      child.once("close", (exitCode, signal) => {
        finish({
          stdout: stdout.text(),
          stderr: stderr.text(),
          exitCode: truncated ? null : exitCode,
          ...(signal === null ? {} : { signal }),
          truncated,
        });
      });
    });
  }
}

class ByteCollector {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(private readonly maxBytes: number) {}

  push(value: Buffer | string, availableBytes = this.maxBytes - this.size): boolean {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const remaining = Math.max(0, Math.min(this.maxBytes - this.size, availableBytes));
    if (remaining <= 0) return false;
    const kept = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
    this.chunks.push(kept);
    this.size += kept.byteLength;
    return kept.byteLength === chunk.byteLength;
  }

  byteLength(): number { return this.size; }

  text(): string {
    return this.decoder.decode(Buffer.concat(this.chunks));
  }
}

export { NodeGitCommandRunner as DefaultGitCommandRunner };
