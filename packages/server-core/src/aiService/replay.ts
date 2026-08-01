import type { ProtocolId } from "@terminay/protocol";
import {
  DEFAULT_MAX_CONTEXT_BYTES,
  DEFAULT_MAX_CONTEXT_CHARS,
  stripTerminalControls,
  trimChars,
  trimUtf8,
  utf8ByteLength,
} from "./bounds.js";
import type { TerminalReplaySnapshot, TerminalReplaySource, TerminalTarget } from "./types.js";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface TerminalReplayBufferOptions {
  readonly maxBytes?: number;
  readonly maxChars?: number;
}

/** A bounded per-session replay buffer. It stores no connection, window, or
 * renderer identity. The provider-facing snapshot is normalized at read time
 * so raw control sequences can never cross the AI boundary. */
export class TerminalReplayBuffer {
  private readonly maxBytes: number;
  private readonly maxChars: number;
  private value = "";
  private wasTruncated = false;

  constructor(options: TerminalReplayBufferOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTEXT_BYTES;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw new RangeError("maxBytes must be positive");
    if (!Number.isSafeInteger(this.maxChars) || this.maxChars <= 0) throw new RangeError("maxChars must be positive");
  }

  append(chunk: string | Uint8Array): void {
    const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const bounded = trimUtf8(this.value + text, this.maxBytes);
    this.value = bounded.text;
    this.wasTruncated ||= bounded.truncated;
  }

  clear(): void {
    this.value = "";
    this.wasTruncated = false;
  }

  snapshot(limits: TerminalReplayBufferOptions = {}): TerminalReplaySnapshot {
    const maxBytes = limits.maxBytes ?? this.maxBytes;
    const maxChars = limits.maxChars ?? this.maxChars;
    const safe = stripTerminalControls(this.value);
    const byBytes = trimUtf8(safe, maxBytes);
    const byChars = trimChars(byBytes.text, maxChars);
    return {
      text: byChars.text,
      bytes: utf8ByteLength(byChars.text),
      truncated: this.wasTruncated || byBytes.truncated || byChars.truncated,
    };
  }

  get bytes(): number {
    return utf8ByteLength(this.value);
  }
}

/** Session-keyed collection used by the server terminal service. A replay is
 * selected by exact session ID; no focus/title/CWD matching is available. */
export class TerminalReplayRegistry implements TerminalReplaySource {
  private readonly buffers = new Map<ProtocolId, TerminalReplayBuffer>();
  private readonly maxBytes: number;
  private readonly maxChars: number;

  constructor(options: TerminalReplayBufferOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTEXT_BYTES;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  }

  register(sessionId: ProtocolId, options: TerminalReplayBufferOptions = {}): TerminalReplayBuffer {
    assertId(sessionId, "sessionId");
    const existing = this.buffers.get(sessionId);
    if (existing !== undefined) return existing;
    const buffer = new TerminalReplayBuffer({ maxBytes: options.maxBytes ?? this.maxBytes, maxChars: options.maxChars ?? this.maxChars });
    this.buffers.set(sessionId, buffer);
    return buffer;
  }

  append(sessionId: ProtocolId, chunk: string | Uint8Array): void {
    this.register(sessionId).append(chunk);
  }

  remove(sessionId: ProtocolId): void {
    this.buffers.delete(sessionId);
  }

  read(target: TerminalTarget, limits: TerminalReplayBufferOptions): TerminalReplaySnapshot {
    const buffer = this.buffers.get(target.sessionId);
    if (buffer === undefined) return { text: "", bytes: 0, truncated: false };
    return buffer.snapshot(limits);
  }
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !idPattern.test(value)) throw new TypeError(`${name} is invalid`);
}

