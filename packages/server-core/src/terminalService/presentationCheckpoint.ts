import { createRequire } from "node:module";
import type { TerminalDimensions, TerminalIdentity } from "./types.js";

// Both xterm packages currently publish CommonJS runtime entries while their
// declarations describe named exports.  `require` keeps Node ESM hosts from
// relying on synthetic named-export detection.
const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");
type HeadlessTerminal = import("@xterm/headless").Terminal;
type TerminalSerializeAddon = import("@xterm/addon-serialize").SerializeAddon;

/** The xterm SerializeAddon format carried by checkpoint state bytes. */
export const TERMINAL_PRESENTATION_CHECKPOINT_FORMAT_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_MAX_COLS = 1_000;
const DEFAULT_MAX_ROWS = 1_000;
const DEFAULT_MAX_SCROLLBACK = 1_000;
const DEFAULT_MAX_OUTPUT_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024;
const DEFAULT_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TAIL_BYTES = 1024 * 1024;
const DEFAULT_MAX_TAIL_EVENTS = 4_096;
const DEFAULT_CHECKPOINT_INTERVAL_BYTES = 64 * 1024;
const DEFAULT_CHECKPOINT_INTERVAL_MS = 5_000;
const DEFAULT_MAX_PINS_PER_SESSION = 8;
const DEFAULT_MAX_PINNED_BYTES_PER_SESSION = 8 * 1024 * 1024;
const DEFAULT_MAX_PIN_LIFETIME_MS = 60_000;
const MAX_PIN_TOMBSTONES = 256;

export type TerminalPresentationCheckpointErrorCode =
  | "checkpoint_unavailable"
  | "checkpoint_not_found"
  | "checkpoint_forbidden"
  | "checkpoint_expired"
  | "checkpoint_consumed"
  | "checkpoint_limit"
  | "checkpoint_invalid";

/** A bounded fresh-display failure. It never represents a PTY failure. */
export class TerminalPresentationCheckpointError extends Error {
  readonly code: TerminalPresentationCheckpointErrorCode;
  constructor(code: TerminalPresentationCheckpointErrorCode, message: string) {
    super(message);
    this.name = "TerminalPresentationCheckpointError";
    this.code = code;
  }
}

export interface TerminalPresentationCheckpointLimits {
  readonly maxSessions?: number;
  readonly maxCols?: number;
  readonly maxRows?: number;
  readonly maxScrollback?: number;
  readonly maxOutputChunkBytes?: number;
  /** PTY bytes awaiting headless xterm parsing. */
  readonly maxQueuedBytes?: number;
  readonly maxSnapshotBytes?: number;
  /** Raw output retained since the latest parser-safe snapshot. */
  readonly maxTailBytes?: number;
  /** Includes zero-byte resize transitions retained after a snapshot. */
  readonly maxTailEvents?: number;
  readonly checkpointIntervalBytes?: number;
  readonly checkpointIntervalMs?: number;
  readonly maxPinsPerSession?: number;
  readonly maxPinnedBytesPerSession?: number;
  readonly maxPinLifetimeMs?: number;
}

export interface TerminalPresentationCheckpointAuthorityOptions extends TerminalPresentationCheckpointLimits {
  readonly now?: () => number;
  readonly generateCheckpointId?: () => string;
}

export interface TerminalPresentationCheckpointPrepared extends TerminalIdentity {
  readonly checkpointId: string;
  readonly clientId: string;
  /** Parser-safe position of the serialized state. */
  readonly position: number;
  /** Current stream head where the new attachment must begin. */
  readonly headPosition: number;
  /** Geometry in which `state` must be restored before applying the tail. */
  readonly checkpointDimensions: TerminalDimensions;
  /** Geometry after the ordered tail has completed. */
  readonly dimensions: TerminalDimensions;
  readonly formatVersion: typeof TERMINAL_PRESENTATION_CHECKPOINT_FORMAT_VERSION;
  readonly stateByteLength: number;
  readonly tailByteLength: number;
  readonly byteLength: number;
  readonly expiresAt: number;
}

export interface TerminalPresentationCheckpointScope extends TerminalIdentity {
  readonly clientId: string;
  readonly attachmentId: string;
}

export interface TerminalPresentationCheckpointMetadata extends TerminalPresentationCheckpointPrepared {
  readonly attachmentId: string;
}

/** The tail has protocol-independent semantic ordering, including resize. */
export type TerminalPresentationCheckpointTailEvent =
  | Readonly<{ readonly type: "output"; readonly position: number; readonly nextPosition: number; readonly bytes: Uint8Array }>
  | Readonly<{ readonly type: "resize"; readonly position: number; readonly dimensions: TerminalDimensions }>;

export interface TerminalPresentationCheckpoint extends TerminalPresentationCheckpointMetadata {
  readonly state: Uint8Array;
  readonly tail: readonly TerminalPresentationCheckpointTailEvent[];
}

export interface TerminalPresentationCheckpointSessionSnapshot extends TerminalIdentity {
  readonly dimensions: TerminalDimensions;
  readonly outputPosition: number;
  readonly checkpointPosition: number;
  readonly queuedBytes: number;
  readonly tailBytes: number;
  readonly pins: number;
  readonly pinnedBytes: number;
  readonly unavailable: boolean;
}

interface Limits {
  readonly maxSessions: number;
  readonly maxCols: number;
  readonly maxRows: number;
  readonly maxScrollback: number;
  readonly maxOutputChunkBytes: number;
  readonly maxQueuedBytes: number;
  readonly maxSnapshotBytes: number;
  readonly maxTailBytes: number;
  readonly maxTailEvents: number;
  readonly checkpointIntervalBytes: number;
  readonly checkpointIntervalMs: number;
  readonly maxPinsPerSession: number;
  readonly maxPinnedBytesPerSession: number;
  readonly maxPinLifetimeMs: number;
}

interface MutablePin extends TerminalPresentationCheckpointPrepared {
  readonly state: Uint8Array;
  readonly tail: readonly TerminalPresentationCheckpointTailEvent[];
  attachmentId?: string;
  consumed: boolean;
}

interface TailRecord {
  readonly sequence: number;
  readonly event: TerminalPresentationCheckpointTailEvent;
  readonly byteLength: number;
}

interface MutableSession {
  readonly identity: TerminalIdentity;
  readonly terminal: HeadlessTerminal;
  readonly serializer: TerminalSerializeAddon;
  readonly pins: Map<string, MutablePin>;
  dimensions: TerminalDimensions;
  outputPosition: number;
  processedPosition: number;
  checkpointPosition: number;
  checkpointDimensions: TerminalDimensions;
  checkpointState: Uint8Array;
  tail: TailRecord[];
  tailBytes: number;
  nextTailSequence: number;
  processedTailSequence: number;
  /** Highest admitted event omitted after a tail limit was crossed. */
  unretainedThroughSequence: number;
  queuedBytes: number;
  pinnedBytes: number;
  unavailable: boolean;
  /** Whether new pins must wait for a later safe state after tail overflow. */
  tailOverflowed: boolean;
  lastCheckpointAt: number;
  safeScanner: SafeBoundaryScanner;
  queue: Promise<void>;
}

/**
 * Server-owned canonical xterm state. It has no PTY input path: deliberately
 * no `onData` or `onBinary` listener is installed, so xterm device/status,
 * colour, cursor, focus, mouse, or window-query replies cannot reach a PTY.
 */
export class TerminalPresentationCheckpointAuthority {
  readonly limits: Readonly<Limits>;

  private readonly now: () => number;
  private readonly generateCheckpointIdHook: (() => string) | undefined;
  private readonly sessions = new Map<string, MutableSession>();
  private readonly expiredCheckpointIds = new Set<string>();
  private readonly consumedCheckpointIds = new Set<string>();
  private checkpointCounter = 0;

  constructor(options: TerminalPresentationCheckpointAuthorityOptions = {}) {
    this.limits = Object.freeze(normalizeLimits(options));
    this.now = options.now ?? (() => Date.now());
    this.generateCheckpointIdHook = options.generateCheckpointId;
  }

  get size(): number { return this.sessions.size; }

  createSession(identity: TerminalIdentity, dimensions: TerminalDimensions): void {
    validateIdentity(identity);
    validateDimensions(dimensions, this.limits);
    const key = sessionKey(identity);
    const existing = this.sessions.get(key);
    if (existing !== undefined) {
      if (sameDimensions(existing.dimensions, dimensions)) return;
      throw error("checkpoint_invalid", "terminal checkpoint session already exists with different dimensions");
    }
    if (this.sessions.size >= this.limits.maxSessions) throw error("checkpoint_limit", "terminal checkpoint session limit reached");
    // SerializeAddon reads xterm's proposed buffer API. This grants no PTY
    // capability; the authority still has no input/reply bridge.
    const terminal = new Terminal({ cols: dimensions.cols, rows: dimensions.rows, scrollback: this.limits.maxScrollback, allowProposedApi: true });
    const serializer = new SerializeAddon();
    terminal.loadAddon(serializer);
    const initial = new TextEncoder().encode(serializer.serialize({ scrollback: this.limits.maxScrollback }));
    if (initial.byteLength > this.limits.maxSnapshotBytes) throw error("checkpoint_limit", "initial terminal checkpoint exceeds its serialized size limit");
    this.sessions.set(key, {
      identity: Object.freeze({ ...identity }), terminal, serializer, pins: new Map(),
      dimensions: Object.freeze({ ...dimensions }), outputPosition: 0, processedPosition: 0, checkpointPosition: 0,
      checkpointDimensions: Object.freeze({ ...dimensions }), checkpointState: initial, tail: [], tailBytes: 0,
      nextTailSequence: 0, processedTailSequence: 0, unretainedThroughSequence: 0, queuedBytes: 0, pinnedBytes: 0, unavailable: false, tailOverflowed: false,
      lastCheckpointAt: this.now(), safeScanner: new SafeBoundaryScanner(), queue: Promise.resolve(),
    });
  }

  /** Admit exact PTY bytes in raw-byte order. Callers may deliberately not await it. */
  ingestOutput(identity: TerminalIdentity, position: number, bytes: Uint8Array): Promise<void> {
    const session = this.requireSession(identity);
    validatePosition(position);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw error("checkpoint_invalid", "terminal checkpoint output bytes are invalid");
    if (bytes.byteLength > this.limits.maxOutputChunkBytes) return this.fail(session, error("checkpoint_limit", "terminal checkpoint output chunk exceeds its limit"));
    if (session.unavailable) return Promise.reject(error("checkpoint_unavailable", "terminal checkpoint state is unavailable"));
    if (position !== session.outputPosition) return this.fail(session, error("checkpoint_unavailable", "terminal checkpoint output position is not contiguous"));
    if (session.queuedBytes + bytes.byteLength > this.limits.maxQueuedBytes) return this.fail(session, error("checkpoint_limit", "terminal checkpoint parser backlog exceeds its limit"));
    const copy = new Uint8Array(bytes);
    const nextPosition = checkedAdd(position, copy.byteLength);
    session.outputPosition = nextPosition;
    session.queuedBytes += copy.byteLength;
    const sequence = this.appendTail(session, Object.freeze({ type: "output", position, nextPosition, bytes: copy }), copy.byteLength);
    return this.enqueue(session, async () => {
      try {
        session.safeScanner.ingest(copy);
        await writeTerminal(session.terminal, copy);
        session.processedPosition = nextPosition;
        session.processedTailSequence = sequence;
        if (session.safeScanner.safe && this.shouldCheckpoint(session)) this.snapshot(session, sequence);
      } finally {
        session.queuedBytes -= copy.byteLength;
      }
    });
  }

  /** Preserve resize order at the current raw output position. */
  ingestResize(identity: TerminalIdentity, dimensions: TerminalDimensions): Promise<void> {
    const session = this.requireSession(identity);
    validateDimensions(dimensions, this.limits);
    if (session.unavailable) return Promise.reject(error("checkpoint_unavailable", "terminal checkpoint state is unavailable"));
    const next = Object.freeze({ ...dimensions });
    const sequence = this.appendTail(session, Object.freeze({ type: "resize", position: session.outputPosition, dimensions: next }), 0);
    return this.enqueue(session, () => {
      session.terminal.resize(next.cols, next.rows);
      session.dimensions = next;
      session.processedTailSequence = sequence;
      if (session.safeScanner.safe && this.shouldCheckpoint(session)) this.snapshot(session, sequence);
    });
  }

  /**
   * Pin immutable state at a parser-safe C plus ordered C→H tail. `position`
   * is C; a protocol attachment must subscribe from `headPosition` H, hydrate
   * the state then tail, and only then drain live output.
   */
  async prepare(identity: TerminalIdentity, options: { readonly clientId: string }): Promise<TerminalPresentationCheckpointPrepared> {
    const session = this.requireSession(identity);
    validateId(options.clientId, "clientId");
    this.cleanupExpiredSession(session);
    if (session.unavailable) throw error("checkpoint_unavailable", "terminal checkpoint state is unavailable");
    if (session.pins.size >= this.limits.maxPinsPerSession) throw error("checkpoint_limit", "terminal checkpoint pin limit reached");
    await session.queue;
    if (session.unavailable) throw error("checkpoint_unavailable", "terminal checkpoint state is unavailable");
    // If the current parser is safe, serialize at H now. This keeps ordinary
    // fresh attaches tiny. An unsafe H instead uses the last known-safe C.
    if (session.safeScanner.safe) this.snapshot(session, session.processedTailSequence);
    if (session.tailOverflowed) throw error("checkpoint_unavailable", "terminal checkpoint tail exceeds its recovery limit");
    const state = new Uint8Array(session.checkpointState);
    const tail = cloneTail(session.tail.map((record) => record.event));
    const tailBytes = tail.reduce((sum, event) => sum + (event.type === "output" ? event.bytes.byteLength : 0), 0);
    const byteLength = checkedAdd(state.byteLength, tailBytes);
    if (session.pinnedBytes + byteLength > this.limits.maxPinnedBytesPerSession) throw error("checkpoint_limit", "terminal checkpoint pinned bytes exceed their limit");
    const pin: MutablePin = {
      checkpointId: this.nextCheckpointId(), ...session.identity, clientId: options.clientId,
      position: session.checkpointPosition, headPosition: session.outputPosition,
      checkpointDimensions: Object.freeze({ ...session.checkpointDimensions }),
      // A tail may include ordered resizes; final dimensions make the intended
      // post-hydration geometry explicit while the tail preserves transitions.
      dimensions: Object.freeze({ ...session.dimensions }),
      formatVersion: TERMINAL_PRESENTATION_CHECKPOINT_FORMAT_VERSION,
      stateByteLength: state.byteLength, tailByteLength: tailBytes, byteLength,
      expiresAt: checkedAdd(this.now(), this.limits.maxPinLifetimeMs), state, tail, consumed: false,
    };
    session.pins.set(pin.checkpointId, pin);
    session.pinnedBytes += pin.byteLength;
    return preparedMetadata(pin);
  }

  bind(checkpointId: string, scope: TerminalPresentationCheckpointScope): TerminalPresentationCheckpointMetadata {
    const pin = this.requirePin(checkpointId, scope, false, true);
    if (pin.attachmentId !== undefined && pin.attachmentId !== scope.attachmentId) throw error("checkpoint_forbidden", "terminal checkpoint belongs to another attachment");
    pin.attachmentId = scope.attachmentId;
    return metadata(pin);
  }

  async pin(scope: TerminalPresentationCheckpointScope): Promise<TerminalPresentationCheckpointMetadata> {
    const prepared = await this.prepare(scope, { clientId: scope.clientId });
    return this.bind(prepared.checkpointId, scope);
  }

  read(scope: TerminalPresentationCheckpointScope & { readonly checkpointId: string }): TerminalPresentationCheckpoint {
    const pin = this.requirePin(scope.checkpointId, scope, true);
    return Object.freeze({ ...metadata(pin), state: new Uint8Array(pin.state), tail: cloneTail(pin.tail) });
  }

  fetch(scope: TerminalPresentationCheckpointScope & { readonly checkpointId: string }): TerminalPresentationCheckpoint {
    const value = this.read(scope);
    const session = this.requireSession(scope);
    const pin = session.pins.get(scope.checkpointId);
    if (pin === undefined) throw error("checkpoint_not_found", "terminal checkpoint is unavailable");
    pin.consumed = true;
    this.rememberTombstone(this.consumedCheckpointIds, pin.checkpointId);
    this.release(scope.checkpointId, scope);
    return value;
  }

  release(checkpointId: string, scope?: Partial<TerminalPresentationCheckpointScope>): void {
    if (typeof checkpointId !== "string" || checkpointId.length === 0) return;
    for (const session of this.sessions.values()) {
      const pin = session.pins.get(checkpointId);
      if (pin === undefined) continue;
      if (scope !== undefined && !matchesScope(pin, scope, false)) throw error("checkpoint_forbidden", "terminal checkpoint is outside its attachment boundary");
      session.pins.delete(checkpointId);
      session.pinnedBytes -= pin.byteLength;
      return;
    }
  }

  releaseAttachment(scope: TerminalPresentationCheckpointScope): void {
    for (const session of this.sessions.values()) {
      if (!sameIdentity(session.identity, scope)) continue;
      for (const pin of [...session.pins.values()]) if (pin.clientId === scope.clientId && pin.attachmentId === scope.attachmentId) this.release(pin.checkpointId, scope);
    }
  }

  releaseClient(clientId: string): void {
    for (const session of this.sessions.values()) for (const pin of [...session.pins.values()]) if (pin.clientId === clientId) this.release(pin.checkpointId);
  }

  cleanupExpired(): void { for (const session of this.sessions.values()) this.cleanupExpiredSession(session); }

  closeSession(identity: TerminalIdentity): void {
    const session = this.sessions.get(sessionKey(identity));
    if (session === undefined) return;
    this.sessions.delete(sessionKey(identity));
    session.pins.clear();
    session.terminal.dispose();
    session.serializer.dispose();
  }

  close(): void { for (const session of [...this.sessions.values()]) this.closeSession(session.identity); }

  session(identity: TerminalIdentity): TerminalPresentationCheckpointSessionSnapshot | undefined {
    const session = this.sessions.get(sessionKey(identity));
    if (session === undefined) return undefined;
    this.cleanupExpiredSession(session);
    return Object.freeze({ ...session.identity, dimensions: Object.freeze({ ...session.dimensions }), outputPosition: session.outputPosition,
      checkpointPosition: session.checkpointPosition, queuedBytes: session.queuedBytes, tailBytes: session.tailBytes,
      pins: session.pins.size, pinnedBytes: session.pinnedBytes, unavailable: session.unavailable || session.tailOverflowed });
  }

  private appendTail(session: MutableSession, event: TerminalPresentationCheckpointTailEvent, bytes: number): number {
    const sequence = ++session.nextTailSequence;
    // Once a tail overflows, the emulator continues consuming output but this
    // authority retains no more tail memory. A later safe boundary snapshots
    // the complete emulator state and restores recoverability.
    if (!session.tailOverflowed && session.tail.length < this.limits.maxTailEvents && session.tailBytes + bytes <= this.limits.maxTailBytes) {
      session.tail.push({ sequence, event, byteLength: bytes });
      session.tailBytes += bytes;
    } else {
      session.tailOverflowed = true;
      session.unretainedThroughSequence = sequence;
    }
    return sequence;
  }

  private shouldCheckpoint(session: MutableSession): boolean {
    return session.tailOverflowed || session.tailBytes >= this.limits.checkpointIntervalBytes || this.now() - session.lastCheckpointAt >= this.limits.checkpointIntervalMs;
  }

  private snapshot(session: MutableSession, throughSequence: number): void {
    if (!session.safeScanner.safe) return;
    const state = new TextEncoder().encode(session.serializer.serialize({ scrollback: this.limits.maxScrollback }));
    if (state.byteLength > this.limits.maxSnapshotBytes) throw error("checkpoint_limit", "terminal checkpoint exceeds its serialized size limit");
    session.checkpointState = state;
    session.checkpointPosition = session.processedPosition;
    session.checkpointDimensions = Object.freeze({ ...session.dimensions });
    session.tail = session.tail.filter((record) => record.sequence > throughSequence);
    session.tailBytes = session.tail.reduce((sum, record) => sum + record.byteLength, 0);
    if (session.unretainedThroughSequence <= throughSequence) session.unretainedThroughSequence = 0;
    session.tailOverflowed = session.unretainedThroughSequence > throughSequence || session.tailBytes > this.limits.maxTailBytes || session.tail.length > this.limits.maxTailEvents;
    session.lastCheckpointAt = this.now();
  }

  private requireSession(identity: TerminalIdentity): MutableSession {
    validateIdentity(identity);
    const session = this.sessions.get(sessionKey(identity));
    if (session === undefined) throw error("checkpoint_not_found", "terminal checkpoint session is unavailable");
    return session;
  }

  private requirePin(checkpointId: string, scope: TerminalPresentationCheckpointScope, requireBound: boolean, ignoreAttachment = false): MutablePin {
    validateId(checkpointId, "checkpointId"); validateScope(scope);
    const session = this.requireSession(scope); this.cleanupExpiredSession(session);
    const pin = session.pins.get(checkpointId);
    if (pin === undefined) {
      if (this.expiredCheckpointIds.has(checkpointId)) throw error("checkpoint_expired", "terminal checkpoint expired");
      if (this.consumedCheckpointIds.has(checkpointId)) throw error("checkpoint_consumed", "terminal checkpoint was already consumed");
      throw error("checkpoint_not_found", "terminal checkpoint is unavailable");
    }
    if (pin.consumed) throw error("checkpoint_consumed", "terminal checkpoint was already consumed");
    if (!matchesScope(pin, scope, requireBound, ignoreAttachment)) throw error("checkpoint_forbidden", "terminal checkpoint is outside its attachment boundary");
    return pin;
  }

  private enqueue(session: MutableSession, action: () => void | Promise<void>): Promise<void> {
    const result = session.queue.then(async () => {
      if (session.unavailable) throw error("checkpoint_unavailable", "terminal checkpoint state is unavailable");
      await action();
    });
    session.queue = result.catch(() => { session.unavailable = true; });
    return result;
  }

  private fail(session: MutableSession, reason: TerminalPresentationCheckpointError): Promise<never> {
    session.unavailable = true;
    return Promise.reject(reason);
  }

  private cleanupExpiredSession(session: MutableSession): void {
    const now = this.now();
    for (const pin of [...session.pins.values()]) {
      if (pin.expiresAt <= now) {
        this.rememberTombstone(this.expiredCheckpointIds, pin.checkpointId);
        this.release(pin.checkpointId);
      }
    }
  }

  private rememberTombstone(tombstones: Set<string>, checkpointId: string): void {
    if (!tombstones.has(checkpointId) && tombstones.size >= MAX_PIN_TOMBSTONES) {
      const oldest = tombstones.values().next().value as string | undefined;
      if (oldest !== undefined) tombstones.delete(oldest);
    }
    tombstones.add(checkpointId);
  }

  private nextCheckpointId(): string {
    const id = this.generateCheckpointIdHook?.() ?? `terminal-checkpoint:${++this.checkpointCounter}`;
    validateId(id, "checkpointId");
    for (const session of this.sessions.values()) if (session.pins.has(id)) throw error("checkpoint_invalid", "terminal checkpoint id already exists");
    return id;
  }
}

/** Conservative byte lexer: true means no incomplete UTF-8 or VT string/control sequence is pending. */
class SafeBoundaryScanner {
  private state: "ground" | "escape" | "csi" | "string" | "stringEscape" = "ground";
  private utf8Remaining = 0;
  /** SerializeAddon does not restore an OSC 8 hyperlink that remains open. */
  private hyperlinkOpen = false;
  private osc = false;
  private oscCode = "";
  private oscSemicolons = 0;
  private oscHasUri = false;

  get safe(): boolean { return this.state === "ground" && this.utf8Remaining === 0 && !this.hyperlinkOpen; }

  ingest(bytes: Uint8Array): void { for (const byte of bytes) this.consume(byte); }

  private consume(byte: number): void {
    if (this.state === "string") {
      if (byte === 0x07 || byte === 0x9c) { this.finishString(); return; }
      if (byte === 0x1b) { this.state = "stringEscape"; return; }
      this.consumeStringByte(byte);
      return;
    }
    if (this.state === "stringEscape") {
      if (byte === 0x5c) this.finishString();
      else {
        this.state = "string";
        this.consumeStringByte(byte);
      }
      return;
    }
    if (this.state === "csi") {
      if (byte === 0x18 || byte === 0x1a) { this.state = "ground"; return; }
      if (byte === 0x1b) { this.state = "escape"; return; }
      if (byte >= 0x40 && byte <= 0x7e) this.state = "ground";
      return;
    }
    if (this.state === "escape") {
      if (byte === 0x5b) { this.state = "csi"; return; }
      if (byte === 0x5d) { this.startString(true); return; }
      if (byte === 0x50 || byte === 0x58 || byte === 0x5e || byte === 0x5f) { this.startString(false); return; }
      if (byte === 0x1b) return;
      if (byte >= 0x30 && byte <= 0x7e) this.state = "ground";
      return;
    }
    // Ground state. Incomplete UTF-8 is unsafe even though xterm may retain
    // decoder state internally; C0/C1 terminal controls reset UTF-8 handling.
    if (this.utf8Remaining > 0) {
      if (byte >= 0x80 && byte <= 0xbf) { this.utf8Remaining -= 1; return; }
      this.utf8Remaining = 0;
      this.consume(byte);
      return;
    }
    if (byte === 0x1b) { this.state = "escape"; return; }
    if (byte === 0x9b) { this.state = "csi"; return; }
    if (byte === 0x9d) { this.startString(true); return; }
    if (byte === 0x90 || byte === 0x98 || byte === 0x9e || byte === 0x9f) { this.startString(false); return; }
    if (byte >= 0xc2 && byte <= 0xdf) this.utf8Remaining = 1;
    else if (byte >= 0xe0 && byte <= 0xef) this.utf8Remaining = 2;
    else if (byte >= 0xf0 && byte <= 0xf4) this.utf8Remaining = 3;
  }

  private startString(osc: boolean): void {
    this.state = "string";
    this.osc = osc;
    this.oscCode = "";
    this.oscSemicolons = 0;
    this.oscHasUri = false;
  }

  private consumeStringByte(byte: number): void {
    if (!this.osc) return;
    if (this.oscSemicolons === 0) {
      if (byte === 0x3b) this.oscSemicolons = 1;
      else if (this.oscCode.length < 8 && byte >= 0x30 && byte <= 0x39) this.oscCode += String.fromCharCode(byte);
      return;
    }
    if (this.oscSemicolons === 1) {
      if (byte === 0x3b) this.oscSemicolons = 2;
      return;
    }
    if (byte !== 0x3b || this.oscHasUri) this.oscHasUri = true;
  }

  private finishString(): void {
    if (this.osc && this.oscCode === "8" && this.oscSemicolons >= 2) {
      this.hyperlinkOpen = this.oscHasUri;
    }
    this.state = "ground";
    this.osc = false;
  }
}

function writeTerminal(terminal: HeadlessTerminal, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => { try { terminal.write(bytes, resolve); } catch (cause) { reject(cause); } });
}
function preparedMetadata(pin: MutablePin): TerminalPresentationCheckpointPrepared {
  return Object.freeze({ checkpointId: pin.checkpointId, serverId: pin.serverId, projectId: pin.projectId, sessionId: pin.sessionId, clientId: pin.clientId,
    position: pin.position, headPosition: pin.headPosition, checkpointDimensions: Object.freeze({ ...pin.checkpointDimensions }), dimensions: Object.freeze({ ...pin.dimensions }), formatVersion: pin.formatVersion,
    stateByteLength: pin.stateByteLength, tailByteLength: pin.tailByteLength, byteLength: pin.byteLength, expiresAt: pin.expiresAt });
}
function metadata(pin: MutablePin): TerminalPresentationCheckpointMetadata {
  if (pin.attachmentId === undefined) throw error("checkpoint_forbidden", "terminal checkpoint is not bound to an attachment");
  return Object.freeze({ ...preparedMetadata(pin), attachmentId: pin.attachmentId });
}
function cloneTail(tail: readonly TerminalPresentationCheckpointTailEvent[]): readonly TerminalPresentationCheckpointTailEvent[] {
  return Object.freeze(tail.map((event) => event.type === "output"
    ? Object.freeze({ ...event, bytes: new Uint8Array(event.bytes) })
    : Object.freeze({ ...event, dimensions: Object.freeze({ ...event.dimensions }) })));
}
function matchesScope(pin: MutablePin, scope: Partial<TerminalPresentationCheckpointScope>, requireBound: boolean, ignoreAttachment = false): boolean {
  if ((scope.serverId !== undefined && pin.serverId !== scope.serverId) || (scope.projectId !== undefined && pin.projectId !== scope.projectId) ||
      (scope.sessionId !== undefined && pin.sessionId !== scope.sessionId) || (scope.clientId !== undefined && pin.clientId !== scope.clientId)) return false;
  return (!requireBound || pin.attachmentId !== undefined) && (ignoreAttachment || scope.attachmentId === undefined || pin.attachmentId === scope.attachmentId);
}
function sameIdentity(left: TerminalIdentity, right: TerminalIdentity): boolean { return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId; }
function sessionKey(identity: TerminalIdentity): string { return `${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`; }
function validateScope(scope: TerminalPresentationCheckpointScope): void { validateIdentity(scope); validateId(scope.clientId, "clientId"); validateId(scope.attachmentId, "attachmentId"); }
function validateIdentity(identity: TerminalIdentity): void { validateId(identity.serverId, "serverId"); validateId(identity.projectId, "projectId"); validateId(identity.sessionId, "sessionId"); }
function validateId(value: string, name: string): void { if (typeof value !== "string" || !ID_PATTERN.test(value)) throw error("checkpoint_invalid", `${name} is invalid`); }
function validatePosition(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw error("checkpoint_invalid", "terminal checkpoint position is invalid"); }
function validateDimensions(value: TerminalDimensions, limits: Limits): void { if (!Number.isSafeInteger(value?.cols) || !Number.isSafeInteger(value?.rows) || value.cols <= 0 || value.rows <= 0 || value.cols > limits.maxCols || value.rows > limits.maxRows) throw error("checkpoint_invalid", "terminal checkpoint dimensions are invalid"); }
function normalizeLimits(options: TerminalPresentationCheckpointLimits): Limits { return {
  maxSessions: positive(options.maxSessions ?? DEFAULT_MAX_SESSIONS, "maxSessions"), maxCols: positive(options.maxCols ?? DEFAULT_MAX_COLS, "maxCols"), maxRows: positive(options.maxRows ?? DEFAULT_MAX_ROWS, "maxRows"), maxScrollback: nonNegative(options.maxScrollback ?? DEFAULT_MAX_SCROLLBACK, "maxScrollback"), maxOutputChunkBytes: positive(options.maxOutputChunkBytes ?? DEFAULT_MAX_OUTPUT_CHUNK_BYTES, "maxOutputChunkBytes"), maxQueuedBytes: positive(options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES, "maxQueuedBytes"), maxSnapshotBytes: positive(options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES, "maxSnapshotBytes"), maxTailBytes: positive(options.maxTailBytes ?? DEFAULT_MAX_TAIL_BYTES, "maxTailBytes"), maxTailEvents: positive(options.maxTailEvents ?? DEFAULT_MAX_TAIL_EVENTS, "maxTailEvents"), checkpointIntervalBytes: positive(options.checkpointIntervalBytes ?? DEFAULT_CHECKPOINT_INTERVAL_BYTES, "checkpointIntervalBytes"), checkpointIntervalMs: positive(options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS, "checkpointIntervalMs"), maxPinsPerSession: positive(options.maxPinsPerSession ?? DEFAULT_MAX_PINS_PER_SESSION, "maxPinsPerSession"), maxPinnedBytesPerSession: positive(options.maxPinnedBytesPerSession ?? DEFAULT_MAX_PINNED_BYTES_PER_SESSION, "maxPinnedBytesPerSession"), maxPinLifetimeMs: positive(options.maxPinLifetimeMs ?? DEFAULT_MAX_PIN_LIFETIME_MS, "maxPinLifetimeMs"),
}; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`); return value; }
function nonNegative(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`); return value; }
function checkedAdd(left: number, right: number): number { const sum = left + right; if (!Number.isSafeInteger(sum)) throw error("checkpoint_limit", "terminal checkpoint size exceeds its limit"); return sum; }
function sameDimensions(left: TerminalDimensions, right: TerminalDimensions): boolean { return left.cols === right.cols && left.rows === right.rows; }
function error(code: TerminalPresentationCheckpointErrorCode, message: string): TerminalPresentationCheckpointError { return new TerminalPresentationCheckpointError(code, message); }
