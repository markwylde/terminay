import { randomUUID } from "node:crypto";
import { execRemote, type SshChannel, type SshClient } from "./transport.js";
import { SshProviderError } from "./errors.js";
import { quotePosix } from "./validation.js";

const PROTOCOL = "terminay-target-helper/process-v1";
const MAX_RESPONSE_BYTES = 8_192;
/** POSIX /proc walk bound to TERMINAY_SESSION_PROOF. OpenSSH drops unadvertised
 * SendEnv values, so the PTY bootstrap exports the proof before exec. */
const SCRIPT = [
  "IFS= read -r proof || exit 1",
  'case $proof in *[!A-Za-z0-9_-]*|"") exit 1 ;; esac',
  "needle=TERMINAY_SESSION_PROOF=$proof",
  "leader_cwd=",
  "first_cwd=",
  "n=0",
  "for environ in /proc/[0-9]*/environ; do",
  "  n=$((n+1))",
  '  if [ "$n" -gt 4096 ]; then break; fi',
  "  pid=${environ#/proc/}",
  "  pid=${pid%/environ}",
  "  case $pid in ''|*[!0-9]*) continue ;; esac",
  '  if ! tr "\\0" "\\n" < "$environ" 2>/dev/null | grep -Fxq "$needle"; then continue; fi',
  '  cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null) || continue',
  "  case $cwd in /*) ;; *) continue ;; esac",
  '  if [ -z "$first_cwd" ]; then first_cwd=$cwd; fi',
  '  stat=$(cat "/proc/$pid/stat" 2>/dev/null) || continue',
  "  rest=${stat##*) }",
  "  set -- $rest",
  "  session=$4",
  '  if [ "$pid" = "$session" ]; then leader_cwd=$cwd; fi',
  "done",
  "cwd=${leader_cwd:-$first_cwd}",
  'if [ -z "$cwd" ]; then printf "%s\\n" unavailable; exit 0; fi',
  'printf "%s\\n%s\\n" available "$cwd"',
].join("\n");

export function createProcessObservationId(): string {
  return `proc:${randomUUID()}`;
}

export function processObservationStarted(observationId: string): Record<string, unknown> {
  return { observationId, protocol: PROTOCOL, version: 1, state: "starting" };
}

export async function sampleProofBoundCwd(
  client: SshClient,
  proof: string,
  signal?: AbortSignal,
): Promise<{ state: "available" | "unavailable"; cwd: string | null; foregroundProcess: null; reason?: string }> {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(proof)) throw new SshProviderError("invalid-input", "Remote process proof is invalid");
  const channel = await execRemote(client, `/bin/sh -c ${quotePosix(SCRIPT)}`);
  const stdout = await collect(channel, proof, signal);
  return parseProcessV1(stdout);
}

export function parseProcessV1(stdout: string): { state: "available" | "unavailable"; cwd: string | null; foregroundProcess: null; reason?: string } {
  const lines = stdout.replaceAll("\r", "").split("\n").filter((line, index, all) => !(line === "" && index === all.length - 1));
  if (lines[0] === "unavailable") return { state: "unavailable", cwd: null, foregroundProcess: null, reason: "session-proof-unavailable" };
  const cwd = lines[1];
  if (lines[0] === "available" && typeof cwd === "string" && cwd.startsWith("/") && cwd.length <= 4096 && !cwd.includes("\0")) {
    return { state: "available", cwd, foregroundProcess: null };
  }
  return { state: "unavailable", cwd: null, foregroundProcess: null, reason: "incompatible-process-observation" };
}

export function processObservationPoll(
  observationId: string,
  sample: { state: "available" | "unavailable"; cwd: string | null; foregroundProcess: null; reason?: string },
): Record<string, unknown> {
  if (sample.state === "available" && sample.cwd !== null) {
    return { observationId, state: "available", cwd: sample.cwd, foregroundProcess: sample.foregroundProcess, observedAt: Date.now() };
  }
  return {
    observationId,
    state: "unavailable",
    cwd: null,
    foregroundProcess: null,
    ...(sample.reason === undefined ? {} : { reason: sample.reason }),
  };
}

function collect(channel: SshChannel, proof: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (callback: (value: any) => void, value: any): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = (): void => {
      try { channel.end(); } finally { finish(reject, new SshProviderError("cancelled", "Remote process observation was cancelled")); }
    };
    signal?.addEventListener("abort", abort, { once: true });
    channel.on("data", (chunk) => {
      if (settled) return;
      const part = Buffer.from(chunk);
      bytes += part.length;
      if (bytes > MAX_RESPONSE_BYTES) {
        try { channel.end(); } finally { finish(reject, new SshProviderError("too-large", "Remote process observation exceeded its bound")); }
        return;
      }
      chunks.push(part);
    });
    channel.stderr?.on("data", () => undefined);
    channel.once("close", (code) => {
      if (code === 0 || code === undefined) finish(resolve, Buffer.concat(chunks).toString("utf8"));
      else finish(resolve, "unavailable\n");
    });
    channel.write(`${proof}\n`);
    channel.end();
  });
}
