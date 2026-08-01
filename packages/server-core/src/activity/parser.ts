import type {
  CommandPhase,
  ProgressState,
  TerminalActivitySignal,
} from "./types.js";

export interface TerminalSignalParserOptions {
  /** Maximum UTF-8 payload size retained for one OSC sequence. */
  readonly maxPayloadBytes?: number;
}

export interface TerminalSignalParser {
  /** Consume one PTY chunk and return signals completed by that chunk. */
  push(chunk: string | Uint8Array): readonly TerminalActivitySignal[];
  /** Discard an incomplete sequence at a PTY/session boundary. */
  reset(): void;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;
const textEncoder = new TextEncoder();
const COMMAND_PHASES: Readonly<Record<string, CommandPhase>> = {
  A: "prompt",
  B: "input",
  C: "executing",
  D: "finished",
};

/**
 * Incremental parser for the small set of OSC and BEL signals used by
 * Terminay.  It observes bytes and never returns a transformed output stream;
 * callers remain responsible for forwarding the original PTY bytes.
 */
export class IncrementalTerminalSignalParser implements TerminalSignalParser {
  private readonly maxPayloadBytes: number;
  private inOsc = false;
  private textEsc = false;
  private oscEsc = false;
  private discarded = false;
  private payload = "";
  private payloadBytes = 0;

  constructor(options: TerminalSignalParserOptions = {}) {
    const max = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    if (!Number.isSafeInteger(max) || max <= 0) {
      throw new RangeError("maxPayloadBytes must be a positive safe integer");
    }
    this.maxPayloadBytes = max;
  }

  push(chunk: string | Uint8Array): readonly TerminalActivitySignal[] {
    const data = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    const signals: TerminalActivitySignal[] = [];
    for (const character of data) {
      if (!this.inOsc) {
        this.consumeText(character, signals);
      } else {
        this.consumeOsc(character, signals);
      }
    }
    return signals;
  }

  reset(): void {
    this.inOsc = false;
    this.textEsc = false;
    this.oscEsc = false;
    this.discarded = false;
    this.payload = "";
    this.payloadBytes = 0;
  }

  private consumeText(character: string, signals: TerminalActivitySignal[]): void {
    if (this.textEsc) {
      this.textEsc = false;
      if (character === "]") {
        this.startOsc();
        return;
      }
      // The ESC belonged to some unrelated terminal control sequence.  The
      // character following it can still be a BEL, so process it normally.
    }
    if (character === "\u001b") {
      this.textEsc = true;
    } else if (character === "\u009d") {
      this.startOsc();
    } else if (character === "\u0007") {
      signals.push({ kind: "bell" });
    }
  }

  private consumeOsc(character: string, signals: TerminalActivitySignal[]): void {
    if (this.oscEsc) {
      this.oscEsc = false;
      if (character === "\\") {
        this.finishOsc(signals);
        return;
      }
      // A non-ST ESC is payload data.  BEL remains a valid OSC terminator.
      this.appendPayload("\u001b");
    }

    if (character === "\u001b") {
      this.oscEsc = true;
    } else if (character === "\u0007") {
      this.finishOsc(signals);
    } else {
      this.appendPayload(character);
    }
  }

  private startOsc(): void {
    this.inOsc = true;
    this.oscEsc = false;
    this.discarded = false;
    this.payload = "";
    this.payloadBytes = 0;
  }

  private appendPayload(character: string): void {
    if (this.discarded) return;
    const bytes = textEncoder.encode(character).byteLength;
    this.payloadBytes += bytes;
    if (this.payloadBytes > this.maxPayloadBytes) {
      this.discarded = true;
      this.payload = "";
      return;
    }
    this.payload += character;
  }

  private finishOsc(signals: TerminalActivitySignal[]): void {
    if (!this.discarded) {
      const signal = decodeOsc(this.payload);
      if (signal) signals.push(signal);
    }
    this.inOsc = false;
    this.oscEsc = false;
    this.discarded = false;
    this.payload = "";
    this.payloadBytes = 0;
  }
}

export function createTerminalSignalParser(
  options: TerminalSignalParserOptions = {},
): TerminalSignalParser {
  return new IncrementalTerminalSignalParser(options);
}

/** Parse a complete chunk. Incomplete OSC sequences intentionally produce no
 * output; use {@link IncrementalTerminalSignalParser} when PTY chunks split
 * control sequences. */
export function parseTerminalSignals(
  chunk: string | Uint8Array,
  options: TerminalSignalParserOptions = {},
): readonly TerminalActivitySignal[] {
  return createTerminalSignalParser(options).push(chunk);
}

function decodeOsc(payload: string): TerminalActivitySignal | null {
  const separator = payload.indexOf(";");
  const identifier = separator < 0 ? payload : payload.slice(0, separator);
  const body = separator < 0 ? "" : payload.slice(separator + 1);
  if (identifier === "9") return decodeOsc9(body);
  if (identifier === "133" || identifier === "633") return decodeCommand(body);
  if (identifier === "777") return decodeOsc777(body);
  return null;
}

function decodeOsc9(body: string): TerminalActivitySignal | null {
  // OSC 9;4;state is progress. Every other OSC 9 payload is a notification.
  const parts = body.split(";");
  if (parts[0] !== "4") return { kind: "notification", body };
  if (parts[1] === undefined || !/^\d+$/.test(parts[1])) return null;
  const stateValue = Number(parts[1]);
  if (!Number.isInteger(stateValue) || stateValue < 0 || stateValue > 4) {
    // Malformed OSC progress payloads are ignored; they must not become
    // notifications (which would incorrectly request user attention).
    return null;
  }
  const state = stateValue as ProgressState;
  if (parts.length < 3 || parts[2] === "") return { kind: "progress", state };
  if (parts.length > 3) return null;
  const progress = Number(parts[2]);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return null;
  }
  return { kind: "progress", state, progress };
}

function decodeCommand(body: string): TerminalActivitySignal | null {
  const parts = body.split(";");
  const phase = COMMAND_PHASES[parts[0] ?? ""];
  if (!phase) return null;
  if (phase !== "finished") return { kind: "command", phase };
  if (parts[1] === undefined || parts[1] === "") return { kind: "command", phase };
  if (!/^-?\d+$/.test(parts[1])) return { kind: "command", phase };
  const exitCode = Number(parts[1]);
  return Number.isSafeInteger(exitCode)
    ? { kind: "command", phase, exitCode }
    : { kind: "command", phase };
}

function decodeOsc777(body: string): TerminalActivitySignal | null {
  const parts = body.split(";");
  if (parts[0] !== "notify") return null;
  return {
    kind: "notification",
    ...(parts[1] === undefined || parts[1] === "" ? {} : { title: parts[1] }),
    ...(parts[2] === undefined || parts[2] === "" ? {} : { body: parts.slice(2).join(";") }),
  };
}

export { DEFAULT_MAX_PAYLOAD_BYTES };
