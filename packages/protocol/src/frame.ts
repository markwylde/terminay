import { decodeCanonicalJson, encodeCanonicalJson } from "./json.js";
import { DEFAULT_PROTOCOL_LIMITS, FRAME_HEADER_BYTES, type ProtocolLimits } from "./limits.js";
import { validateEnvelope, type Envelope } from "./types.js";

export const MAGIC = new Uint8Array([0x54, 0x52, 0x4d, 0x59]); // TRMY
export const WIRE_FORMAT_VERSION = 1;

export enum FrameKind {
  Control = 1,
  Query = 2,
  Command = 3,
  Event = 4,
  Stream = 5,
  Binary = 6,
  Error = 7,
}

export interface DecodedFrame { readonly kind: FrameKind; readonly envelope: Envelope; readonly body: Uint8Array; }

export function frameKindForEnvelope(envelope: Envelope): FrameKind {
  switch (envelope.type) {
    case "query": case "query_result": return FrameKind.Query;
    case "command": case "command_result": return FrameKind.Command;
    case "event": return FrameKind.Event;
    case "stream_open": case "stream_chunk": case "stream_ack": case "stream_close": return FrameKind.Stream;
    case "binary_start": case "binary_chunk": case "binary_ack": case "binary_complete": case "binary_failure": return FrameKind.Binary;
    case "error": case "incompatible_version": return FrameKind.Error;
    default: return FrameKind.Control;
  }
}

export function encodeFrame(envelope: Envelope, body = new Uint8Array(), limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): Uint8Array {
  const checked = validateEnvelope(envelope);
  if (!(body instanceof Uint8Array)) throw new TypeError("body must be Uint8Array");
  const header = encodeCanonicalJson(checked);
  if (header.byteLength > limits.maxHeaderBytes) throw new RangeError("header exceeds limit");
  if (body.byteLength > limits.maxBodyBytes) throw new RangeError("body exceeds limit");
  const total = FRAME_HEADER_BYTES + header.byteLength + body.byteLength;
  if (total > limits.maxFrameBytes) throw new RangeError("frame exceeds limit");
  const result = new Uint8Array(total); result.set(MAGIC, 0); result[4] = WIRE_FORMAT_VERSION; result[5] = frameKindForEnvelope(checked);
  const view = new DataView(result.buffer); view.setUint32(6, header.byteLength, false); view.setUint32(10, body.byteLength, false);
  result.set(header, FRAME_HEADER_BYTES); result.set(body, FRAME_HEADER_BYTES + header.byteLength); return result;
}

export function decodeFrame(frame: Uint8Array, limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): DecodedFrame {
  if (!(frame instanceof Uint8Array)) throw new TypeError("frame must be Uint8Array");
  if (frame.byteLength < FRAME_HEADER_BYTES) throw new RangeError("truncated frame");
  for (let i = 0; i < MAGIC.length; i++) if (frame[i] !== MAGIC[i]) throw new TypeError("invalid frame magic");
  if (frame[4] !== WIRE_FORMAT_VERSION) throw new TypeError("unsupported wire format");
  const kind = frame[5] as FrameKind; if (!Object.values(FrameKind).includes(kind)) throw new TypeError("invalid frame kind");
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength); const headerLength = view.getUint32(6, false); const bodyLength = view.getUint32(10, false);
  if (headerLength > limits.maxHeaderBytes || bodyLength > limits.maxBodyBytes) throw new RangeError("declared frame part exceeds limit");
  const total = FRAME_HEADER_BYTES + headerLength + bodyLength;
  if (total > limits.maxFrameBytes || total !== frame.byteLength) throw new RangeError("invalid declared frame length");
  const envelope = validateEnvelope(decodeCanonicalJson(frame.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + headerLength)));
  if (frameKindForEnvelope(envelope) !== kind) throw new TypeError("frame kind does not match envelope");
  return { kind, envelope, body: frame.slice(FRAME_HEADER_BYTES + headerLength) };
}

export function concatFrames(frames: readonly Uint8Array[], limits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.byteLength, 0); if (total > limits.maxQueuedBytes) throw new RangeError("queued frames exceed limit");
  const result = new Uint8Array(total); let offset = 0; for (const frame of frames) { result.set(frame, offset); offset += frame.byteLength; } return result;
}
