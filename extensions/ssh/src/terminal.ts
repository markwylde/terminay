import { openShell, type AuthenticationBroker, type SshChannel, type SshClient } from "./transport.js";
import { assertAbsolute, quotePosix } from "./validation.js";
import { SshProviderError } from "./errors.js";
import { randomBytes } from "node:crypto";
import { observeCodexJournal } from "./agentJournal.js";

const SAFE_REMOTE_ENV = new Set(["TERM", "COLORTERM", "LANG", "LC_ALL"]);

interface TerminalLease {
  client: SshClient;
  trackTerminal(terminal: RemoteTerminalSession): void;
  release(): void;
}
interface ConnectionPoolLike {
  acquire(profileId: string, revision: number, options: { signal?: AbortSignal; broker?: AuthenticationBroker }): Promise<TerminalLease>;
}
export interface CreateTerminalInput {
  sessionId: string;
  profileId: string;
  revision: number;
  root: string;
  term?: string;
  rows?: number;
  cols?: number;
  environment?: Record<string, unknown>;
  authBroker?: AuthenticationBroker;
}
interface TerminalExit { code: number | null; signal: string | null; interrupted: boolean; reason?: "transport-lost" }
interface TerminalRead { data: string; encoding: "base64"; exit: TerminalExit | undefined }

export class RemoteTerminalManager {
  readonly #pool: ConnectionPoolLike;
  readonly #sessions = new Map<string, RemoteTerminalSession>();
  readonly #maxBufferedBytes: number;
  constructor(pool: ConnectionPoolLike, { maxBufferedBytes = 1024 * 1024 }: { maxBufferedBytes?: number } = {}) { this.#pool = pool; this.#maxBufferedBytes = maxBufferedBytes; }
  async create(input: CreateTerminalInput, signal?: AbortSignal) {
    validateSession(input);
    const root = assertAbsolute(input.root);
    const lease = await this.#pool.acquire(input.profileId, input.revision, { signal, broker: input.authBroker });
    try {
      const env: Record<string, string> = {};
      for (const [name, value] of Object.entries(input.environment ?? {})) {
        if (SAFE_REMOTE_ENV.has(name) && typeof value === "string" && value.length <= 4096) env[name] = value;
      }
      const sessionProof=randomBytes(32).toString("base64url");
      env.TERMINAY_SESSION_PROOF=sessionProof;
      const channel = await openShell(lease.client, { term: input.term ?? "xterm-256color", rows: bounded(input.rows, 1, 1000, 24), cols: bounded(input.cols, 1, 1000, 80), env });
      const command = `cd -- ${quotePosix(root)} && exec \"\${SHELL:-/bin/sh}\" -l\n`;
      channel.write(command);
      const session = new RemoteTerminalSession(input.sessionId, sessionProof, channel, lease, this.#maxBufferedBytes);
      this.#sessions.set(input.sessionId, session); lease.trackTerminal(session);
      return { sessionId: input.sessionId, profileId: input.profileId, revision: input.revision, root, shellProfile: "remote-system-default", capabilities: { cwd: false, foregroundProcess: false, agentJournal: true, mcp: false } };
    } catch (error) { lease.release(); throw error; }
  }
  get(id: string): RemoteTerminalSession { const session = this.#sessions.get(id); if (!session) throw new SshProviderError("missing", "Remote terminal session was not found"); return session; }
  input({ sessionId, data }: { sessionId: string; data: string }) { if (typeof data !== "string" || Buffer.byteLength(data) > 64 * 1024) throw new SshProviderError("invalid-input", "Terminal input is invalid"); this.get(sessionId).write(data); return { accepted: true }; }
  resize({ sessionId, cols, rows }: { sessionId: string; cols: number; rows: number }) { this.get(sessionId).resize(bounded(cols, 1, 1000), bounded(rows, 1, 1000)); return { accepted: true }; }
  kill({ sessionId, signal = "TERM" }: { sessionId: string; signal?: string }) { this.get(sessionId).kill(signal); return { accepted: true }; }
  read({ sessionId, maxBytes = 65536 }: { sessionId: string; maxBytes?: number }): TerminalRead { return this.get(sessionId).read(bounded(maxBytes, 1, 262144)); }
  observeJournal({sessionId,cursor,maxRecords,maxBytes}:{sessionId:string;cursor:number;maxRecords:number;maxBytes:number},signal?:AbortSignal){return this.get(sessionId).observeJournal(cursor,maxRecords,maxBytes,signal);}
  dispose({ sessionId }: { sessionId: string }) { const session = this.get(sessionId); session.kill("TERM"); this.#sessions.delete(sessionId); return { accepted: true }; }
  close(): void { for (const session of this.#sessions.values()) session.kill("TERM"); this.#sessions.clear(); }
}

class RemoteTerminalSession {
  readonly #id: string;
  readonly #channel: SshChannel;
  readonly #lease: TerminalLease;
  readonly #max: number;
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  #exited = false;
  #exit: TerminalExit | undefined;
  readonly #exitListeners: Array<(exit: TerminalExit) => void> = [];
  #paused = false;
  readonly #proof:string;
  constructor(id: string, proof:string, channel: SshChannel, lease: TerminalLease, max: number) {
    this.#id = id; this.#proof=proof; this.#channel = channel; this.#lease = lease; this.#max = max;
    const collect = (chunk: Uint8Array | string): void => { const bytes = Buffer.from(chunk); this.#chunks.push(bytes); this.#bytes += bytes.length; if (this.#bytes >= this.#max && !this.#paused && this.#channel.pause) { this.#paused = true; this.#channel.pause(); } };
    channel.on("data", collect); channel.stderr?.on("data", collect);
    channel.once("close", (code, signal) => this.#finish({ code: Number.isInteger(code) ? code! : null, signal: signal ?? null, interrupted: false }));
  }
  write(data: string): boolean { if (this.#exited) throw new SshProviderError("transport-lost", "Remote terminal has exited"); return this.#channel.write(data); }
  resize(cols: number, rows: number): void { if (!this.#exited) this.#channel.setWindow(rows, cols, 0, 0); }
  kill(signal: string): void { if (!this.#exited) { try { this.#channel.signal(signal); } finally { this.#channel.end(); } } }
  read(max: number): TerminalRead { let remaining = max; const selected: Buffer[] = []; while (remaining && this.#chunks.length) { const chunk = this.#chunks[0]!; if (chunk.length <= remaining) { selected.push(this.#chunks.shift()!); this.#bytes -= chunk.length; remaining -= chunk.length; } else { selected.push(chunk.subarray(0, remaining)); this.#chunks[0] = chunk.subarray(remaining); this.#bytes -= remaining; remaining = 0; } } if (this.#paused && this.#bytes < this.#max / 2 && this.#channel.resume) { this.#paused = false; this.#channel.resume(); } return { data: Buffer.concat(selected).toString("base64"), encoding: "base64", exit: this.#exit }; }
  interruptOnce(): void { this.#finish({ code: null, signal: null, interrupted: true, reason: "transport-lost" }); }
  onExit(listener: (exit: TerminalExit) => void): void { this.#exitListeners.push(listener); }
  observeJournal(cursor:number,maxRecords:number,maxBytes:number,signal?:AbortSignal){if(this.#exited)throw new SshProviderError("transport-lost","Remote terminal has exited");return observeCodexJournal(this.#lease.client,{sessionId:this.#id,proof:this.#proof,cursor,maxRecords,maxBytes},signal);}
  #finish(exit: TerminalExit): void { if (this.#exited) return; this.#exited = true; this.#exit = exit; this.#lease.release(); for (const listener of this.#exitListeners) listener(exit); }
}

function bounded(value: number | undefined, min: number, max: number, fallback?: number): number { const actual = value ?? fallback; if (!Number.isInteger(actual) || actual === undefined || actual < min || actual > max) throw new SshProviderError("invalid-input", "Terminal dimensions are invalid"); return actual; }
function validateSession(input: CreateTerminalInput): void { if (!input || typeof input !== "object" || typeof input.sessionId !== "string" || typeof input.profileId !== "string" || !Number.isInteger(input.revision)) throw new SshProviderError("invalid-input", "Terminal request is invalid"); }
