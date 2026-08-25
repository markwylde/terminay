import { Buffer } from "node:buffer";

export const EXTENSION_HOST_PROTOCOL_VERSION = 1;

interface ExtensionHostFrameBase {
  readonly protocolVersion: 1;
  readonly id: string;
  readonly payload?: unknown;
}

interface ExtensionChildFrameBase {
  readonly protocolVersion: 1;
  readonly id: string;
  readonly payload?: unknown;
}

/**
 * Messages initiated by Server Core. Agent messages are additive to the
 * existing extension-runtime protocol: the legacy child continues to reject
 * them until its agent runtime is enabled.
 */
export type HostFrame = ExtensionHostFrameBase & {
  readonly kind:
    | "activate"
    | "invoke"
    | "cancel"
    | "deactivate"
    | "broker.result"
    | "agent.terminal.admit"
    | "agent.terminal.cancel"
    | "agent.drain"
    | "agent.observation.result"
    | "agent.lifecycle.ack"
    | "agent.lifecycle.backpressure";
};

/** Messages initiated by an extension child. */
export type ChildFrame = ExtensionChildFrameBase & {
  readonly kind:
    | "ready"
    | "result"
    | "failure"
    | "broker.request"
    | "broker.cancel"
    | "deactivated"
    | "agent.provider.disposed"
    | "agent.lifecycle.publish"
    | "agent.observation.request"
    | "agent.terminal.admitted"
    | "agent.terminal.cancelled"
    | "agent.drain.completed";
};

export function frameByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Drop AbortSignal and other non-JSON values before child IPC. Electron's
 * `process.send` uses structured clone; a live signal makes the send throw,
 * which the child surfaces as a generic admission failure. */
export function jsonIpcValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof AbortSignal !== "undefined" && value instanceof AbortSignal) return undefined;
  if (Array.isArray(value)) return value.map((item) => jsonIpcValue(item) ?? null);
  if (typeof value !== "object") return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "signal" && (item === undefined || typeof item === "object")) continue;
    const next = jsonIpcValue(item);
    if (next === undefined) continue;
    result[key] = next;
  }
  return result;
}

export function isChildFrame(value: unknown): value is ChildFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  return frame.protocolVersion === EXTENSION_HOST_PROTOCOL_VERSION
    && typeof frame.id === "string"
    && frame.id.length > 0
    && frame.id.length <= 200
    && (frame.kind === "ready"
      || frame.kind === "result"
      || frame.kind === "failure"
      || frame.kind === "broker.request"
      || frame.kind === "broker.cancel"
      || frame.kind === "deactivated"
      || frame.kind === "agent.provider.disposed"
      || frame.kind === "agent.lifecycle.publish"
      || frame.kind === "agent.observation.request"
      || frame.kind === "agent.terminal.admitted"
      || frame.kind === "agent.terminal.cancelled"
      || frame.kind === "agent.drain.completed");
}
