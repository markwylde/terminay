import { Buffer } from "node:buffer";

export const EXTENSION_HOST_PROTOCOL_VERSION = 1;

export interface HostFrame {
  readonly protocolVersion: 1;
  readonly kind: "activate" | "invoke" | "cancel" | "deactivate" | "broker.result";
  readonly id: string;
  readonly payload?: unknown;
}

export interface ChildFrame {
  readonly protocolVersion: 1;
  readonly kind: "ready" | "result" | "failure" | "broker.request" | "deactivated";
  readonly id: string;
  readonly payload?: unknown;
}

export function frameByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isChildFrame(value: unknown): value is ChildFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const frame = value as Record<string, unknown>;
  return frame.protocolVersion === EXTENSION_HOST_PROTOCOL_VERSION
    && typeof frame.id === "string"
    && frame.id.length > 0
    && frame.id.length <= 200
    && (frame.kind === "ready" || frame.kind === "result" || frame.kind === "failure" || frame.kind === "broker.request" || frame.kind === "deactivated");
}

