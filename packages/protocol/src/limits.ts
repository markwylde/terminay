export interface ProtocolLimits {
  maxFrameBytes: number;
  maxHeaderBytes: number;
  maxBodyBytes: number;
  maxQueuedBytes: number;
  maxStreamChunkBytes: number;
  maxBinaryChunkBytes: number;
  maxCapabilities: number;
  maxEventsPerBatch: number;
}

/** Largest raw file range carried directly in a default query-result body.
 * Four concurrent responses fit the default frame and queue budgets. */
export const MAX_FILE_CONTENT_RANGE_BYTES = 2 * 1024 * 1024;

export const DEFAULT_PROTOCOL_LIMITS: Readonly<ProtocolLimits> = Object.freeze({
  maxFrameBytes: 8 * 1024 * 1024,
  maxHeaderBytes: 64 * 1024,
  maxBodyBytes: 8 * 1024 * 1024 - 64 * 1024 - 14,
  maxQueuedBytes: 16 * 1024 * 1024,
  maxStreamChunkBytes: 256 * 1024,
  maxBinaryChunkBytes: 1024 * 1024,
  maxCapabilities: 256,
  maxEventsPerBatch: 256,
});

/** Absolute ceilings accepted from an untrusted peer before downward negotiation. */
export const ABSOLUTE_PROTOCOL_LIMITS: Readonly<ProtocolLimits> = Object.freeze({
  maxFrameBytes: 64 * 1024 * 1024,
  maxHeaderBytes: 1024 * 1024,
  maxBodyBytes: 64 * 1024 * 1024 - 1024 * 1024 - 14,
  maxQueuedBytes: 128 * 1024 * 1024,
  maxStreamChunkBytes: 4 * 1024 * 1024,
  maxBinaryChunkBytes: 8 * 1024 * 1024,
  maxCapabilities: 4096,
  maxEventsPerBatch: 4096,
});

export function validateLimits(limits: unknown, base: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): ProtocolLimits {
  if (!isRecord(limits)) throw new RangeError("limits must be an object");
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof ProtocolLimits)[]) {
    if (limits[key] !== undefined) {
      const value = limits[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > base[key]) {
        throw new RangeError(`invalid limit ${key}`);
      }
      result[key] = value;
    }
  }
  for (const key of Object.keys(limits)) {
    if (!(key in base)) throw new RangeError(`unknown limit ${key}`);
  }
  if (result.maxHeaderBytes + result.maxBodyBytes + FRAME_HEADER_BYTES > result.maxFrameBytes) {
    throw new RangeError("header and body limits exceed frame limit");
  }
  if (result.maxStreamChunkBytes > result.maxBodyBytes || result.maxBinaryChunkBytes > result.maxBodyBytes) {
    throw new RangeError("chunk limit exceeds body limit");
  }
  return result;
}

export function negotiateLimits(local: ProtocolLimits, peer: unknown): ProtocolLimits {
  const boundedLocal = validateLimits(local, ABSOLUTE_PROTOCOL_LIMITS);
  const boundedPeer = validateLimits(peer, ABSOLUTE_PROTOCOL_LIMITS);
  const result = {} as ProtocolLimits;
  for (const key of Object.keys(boundedLocal) as (keyof ProtocolLimits)[]) {
    result[key] = Math.min(boundedLocal[key], boundedPeer[key]);
  }
  return validateLimits(result, ABSOLUTE_PROTOCOL_LIMITS);
}

export const FRAME_HEADER_BYTES = 14;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
