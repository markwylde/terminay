import { protocolError, ProtocolException } from "./errors.js";
import { DEFAULT_PROTOCOL_LIMITS, negotiateLimits, type ProtocolLimits } from "./limits.js";
import { PROTOCOL_MAX_VERSION, PROTOCOL_MIN_VERSION, validateEnvelope, type ClientHello } from "./types.js";

export interface NegotiatedProtocol { version: number; limits: ProtocolLimits; capabilities: readonly string[]; }

export function negotiateVersion(peerMin: number, peerMax: number, localMin = PROTOCOL_MIN_VERSION, localMax = PROTOCOL_MAX_VERSION): number {
  if (!Number.isSafeInteger(peerMin) || !Number.isSafeInteger(peerMax) || !Number.isSafeInteger(localMin) || !Number.isSafeInteger(localMax) || peerMin < 0 || localMin < 0 || peerMin > peerMax || localMin > localMax) throw new ProtocolException(protocolError("validation", "invalid protocol range"));
  const version = Math.min(peerMax, localMax); if (version < Math.max(peerMin, localMin)) throw new ProtocolException({ code: "incompatible", message: "incompatible protocol version", supportedMin: localMin, supportedMax: localMax });
  return version;
}

export function negotiateClientHello(hello: ClientHello, localCapabilities: readonly string[], localLimits: ProtocolLimits = DEFAULT_PROTOCOL_LIMITS): NegotiatedProtocol {
  validateEnvelope(hello); const version = negotiateVersion(hello.protocolMin, hello.protocolMax); const limits = negotiateLimits(localLimits, hello.limits);
  const capabilities = localCapabilities.filter((capability) => hello.capabilities.includes(capability)); return { version, limits, capabilities };
}

export function makeIncompatibleError(peerMin?: number, peerMax?: number): ProtocolException {
  return new ProtocolException({ code: "incompatible", message: "incompatible protocol version", supportedMin: PROTOCOL_MIN_VERSION, supportedMax: PROTOCOL_MAX_VERSION, details: { requestedMin: peerMin ?? null, requestedMax: peerMax ?? null } });
}
