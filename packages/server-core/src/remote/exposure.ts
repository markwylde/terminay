import type { ProtocolId } from "@terminay/protocol";
import {
  RemoteConnectionManager,
  type RemoteAuthProof,
  type RemoteExposure,
  type RemotePeerSnapshot,
} from "./transport.js";
import {
  RemotePairingStore,
  type RemotePairingAdmission,
  type RemotePairingAttempt,
  type RemotePairingRoom,
  type RemotePairingRoomMetadata,
} from "./pairing.js";
import {
	type RemoteHeadlessSessionHost,
	type HeadlessWebRtcRuntime,
  type RemoteHeadlessSession,
  type RemoteHeadlessSessionSnapshot,
} from "./headless.js";
import { RemoteAuditLog, RemoteRateLimiter } from "./lifecycle.js";

export interface RemoteExposureControllerOptions {
	readonly manager: RemoteConnectionManager;
	readonly pairing: RemotePairingStore;
  readonly headless?: RemoteHeadlessSessionHost;
  readonly now?: () => number;
  readonly defaultLifetimeMs?: number;
  readonly audit?: RemoteAuditLog;
  readonly pairingRateLimiter?: RemoteRateLimiter;
}

export interface RemoteExposureService {
	readonly status: RemoteExposureStatus;
	readonly shutdown: () => void | Promise<void>;
}

export interface RemoteCleanupReport {
	readonly pairingRooms: number;
	readonly usedTickets: number;
	readonly rateLimitWindows: number;
}

export interface RemotePairingHandoff {
  readonly roomId: ProtocolId;
  readonly serverId: ProtocolId;
  readonly sessionOrigin: string;
  readonly expiresAt: number;
  /** One-time value intended for an in-memory URL fragment only. */
  readonly secret: string;
  readonly pairingUrl: string;
}

export interface RemoteExposureStatus {
  readonly exposure: RemoteExposure;
  readonly pairing: RemotePairingRoomMetadata | undefined;
  readonly peers: readonly RemotePeerSnapshot[];
  readonly sessions: readonly RemoteHeadlessSessionSnapshot[];
}

/**
 * Server-owned exposure lifecycle for standalone and embedded hosts.
 *
 * Pairing material and transport exposure are rotated together, while stop
 * exposure only blocks new admissions. Existing peers and headless sessions
 * remain alive until they disconnect, are revoked, or the host shuts down.
 */
export class RemoteExposureController {
  private readonly manager: RemoteConnectionManager;
  private readonly pairing: RemotePairingStore;
	private readonly headless: RemoteHeadlessSessionHost | undefined;
  private readonly now: () => number;
  private readonly defaultLifetimeMs: number;
	private readonly audit: RemoteAuditLog;
	private readonly pairingRateLimiter: RemoteRateLimiter;

  constructor(options: RemoteExposureControllerOptions) {
    this.manager = options.manager;
    this.pairing = options.pairing;
    this.headless = options.headless;
    this.now = options.now ?? (() => Date.now());
    this.defaultLifetimeMs = positive(options.defaultLifetimeMs ?? 5 * 60 * 1000, "defaultLifetimeMs");
	this.audit = options.audit ?? new RemoteAuditLog({ serverId: this.manager.serverId, now: this.now });
	this.pairingRateLimiter = options.pairingRateLimiter ?? new RemoteRateLimiter({ now: this.now });
    if (this.manager.serverId !== this.pairing.serverId || this.manager.sessionOrigin !== this.pairing.sessionOrigin) {
      throw new TypeError("remote exposure identity does not match pairing identity");
    }
  }

	get auditLog(): RemoteAuditLog {
		return this.audit;
	}

  get status(): RemoteExposureStatus {
    const exposure = this.manager.exposure;
    const activePairings = this.pairing.list().filter((room) => room.state === "active");
    const pairing = activePairings.sort((left, right) => right.expiresAt - left.expiresAt)[0];
    return Object.freeze({
      exposure,
      pairing,
      peers: this.manager.snapshot().peers,
		sessions: this.headless?.listSessions() ?? [],
    });
  }

  /** Start advertising one short-lived pairing room. */
  start(expiresAt = this.now() + this.defaultLifetimeMs): RemotePairingHandoff {
    if (this.manager.exposure.state === "exposed") throw new Error("remote exposure is already active");
    const exposure = this.manager.expose(expiresAt);
    try {
      const handoff = this.createPairing(exposure.expiresAt);
		this.audit.record({ action: "exposure-started", roomId: handoff.roomId });
		return handoff;
    } catch (error) {
      this.manager.stopExposure();
      throw error;
    }
  }

  /** Rotate the room without changing server identity or existing peers. */
  rotate(expiresAt = this.now() + this.defaultLifetimeMs): RemotePairingHandoff {
    if (this.manager.exposure.state !== "exposed") throw new Error("remote exposure is not active");
    const exposure = this.manager.rotateExposure(expiresAt);
    try {
      const handoff = this.createPairing(exposure.expiresAt, true);
		this.audit.record({ action: "exposure-rotated", roomId: handoff.roomId });
		return handoff;
    } catch (error) {
      this.manager.stopExposure();
      throw error;
    }
  }

  /** Issue another active pairing room without changing the exposure room. */
  createPairing(expiresAt = this.manager.exposure.expiresAt, rotate = false): RemotePairingHandoff {
    if (this.manager.exposure.state !== "exposed" || expiresAt === undefined) throw new Error("remote exposure is not active");
    if (expiresAt > (this.manager.exposure.expiresAt ?? expiresAt)) throw new RangeError("pairing expiry exceeds exposure expiry");
    const room = rotate ? this.pairing.rotate(expiresAt) : this.pairing.create(expiresAt);
	this.audit.record({ action: "pairing-created", roomId: room.roomId });
    return toHandoff(room);
  }

  consumePairing(attempt: RemotePairingAttempt): RemotePairingAdmission {
    // A pairing attempt is clipboard/client supplied data. Its rate-limit
    // bucket must therefore be derived only from server-owned room identity;
    // accepting a caller-provided bucket lets repeated guesses evade the
    // bounded admission window by changing that field on every request.
    const key = `pairing:${attempt.roomId}`;
    try {
		this.pairingRateLimiter.consume(key);
		const admission = this.pairing.consume(attempt);
		this.pairingRateLimiter.reset(key);
		this.audit.record({ action: "pairing-consumed", roomId: admission.roomId });
		return admission;
	} catch (error) {
		this.audit.record({ action: "pairing-rejected", roomId: attempt.roomId, reason: error instanceof Error && error.message.includes("rate limit") ? "rate-limited" : "invalid" });
		throw error;
	}
  }

  /** Consume the one-time room and then establish all isolated headless
   * channels. Application-level authentication remains in the gateway. */
  async connectHeadless(
    runtime: HeadlessWebRtcRuntime,
    attempt: RemotePairingAttempt,
    proof: RemoteAuthProof,
    signal?: AbortSignal,
  ): Promise<RemoteHeadlessSession> {
    if (this.manager.exposure.state !== "exposed") throw new Error("remote exposure is not active");
    if (this.headless === undefined) throw new Error("headless WebRTC runtime is unavailable");
    this.consumePairing(attempt);
	this.audit.record({ action: "peer-connect-started", deviceId: proof.deviceId });
	try {
		const session = await this.headless.connect(runtime, proof, signal);
		this.audit.record({ action: "peer-connected", peerId: session.peerId, deviceId: session.deviceId });
		return session;
	} catch (error) {
		this.audit.record({ action: "peer-connect-failed", deviceId: proof.deviceId, reason: "transport" });
		throw error;
	}
  }

	async revokeDevice(deviceId: ProtocolId): Promise<number> {
		const count = this.headless === undefined
			? this.manager.revokeDevice(deviceId)
			: await this.headless.revokeDevice(deviceId);
		this.audit.record({ action: "device-revoked", deviceId });
		return count;
	}

  /** Stop accepting new remote pairing/reconnect attempts. Existing peers
   * remain connected so Local/server-owned work is not interrupted. */
  stopExposure(): RemoteExposureStatus {
    const wasExposed = this.manager.exposure.state === "exposed";
		// A half-negotiated peer has consumed admission but is not an established
		// remote session. Fence it while preserving existing sessions, which remain
		// usable until disconnect, revocation, or shutdown.
		this.headless?.abortPendingConnections();
    this.manager.stopExposure();
    this.pairing.disable();
    if (wasExposed) this.audit.record({ action: "exposure-stopped" });
    return this.status;
  }

	cleanup(): RemoteCleanupReport {
		const report = {
			pairingRooms: this.pairing.cleanup(),
			usedTickets: this.manager.cleanup(),
			rateLimitWindows: this.pairingRateLimiter.cleanup(),
		};
		this.audit.record({ action: "cleanup" });
		return Object.freeze(report);
	}

  /** Full host shutdown, including live headless channels. */
	async shutdown(): Promise<void> {
		await this.headless?.closeAll();
		this.stopExposure();
	}
}

function toHandoff(room: RemotePairingRoom): RemotePairingHandoff {
  const url = new URL(room.sessionOrigin);
  url.hash = room.secret;
  return Object.freeze({
    roomId: room.roomId,
    serverId: room.serverId,
    sessionOrigin: room.sessionOrigin,
    expiresAt: room.expiresAt,
    secret: room.secret,
    pairingUrl: url.toString(),
  });
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
