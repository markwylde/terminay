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
  RemoteHeadlessWebRtcFactory,
  type HeadlessWebRtcRuntime,
  type RemoteHeadlessSession,
  type RemoteHeadlessSessionSnapshot,
} from "./headless.js";

export interface RemoteExposureControllerOptions {
  readonly manager: RemoteConnectionManager;
  readonly pairing: RemotePairingStore;
  readonly headless?: RemoteHeadlessWebRtcFactory;
  readonly now?: () => number;
  readonly defaultLifetimeMs?: number;
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
  private readonly headless: RemoteHeadlessWebRtcFactory | undefined;
  private readonly now: () => number;
  private readonly defaultLifetimeMs: number;

  constructor(options: RemoteExposureControllerOptions) {
    this.manager = options.manager;
    this.pairing = options.pairing;
    this.headless = options.headless;
    this.now = options.now ?? (() => Date.now());
    this.defaultLifetimeMs = positive(options.defaultLifetimeMs ?? 5 * 60 * 1000, "defaultLifetimeMs");
    if (this.manager.serverId !== this.pairing.serverId || this.manager.sessionOrigin !== this.pairing.sessionOrigin) {
      throw new TypeError("remote exposure identity does not match pairing identity");
    }
  }

  get status(): RemoteExposureStatus {
    const exposure = this.manager.exposure;
    const activePairings = this.pairing.list().filter((room) => room.state === "active");
    const pairing = activePairings.sort((left, right) => right.expiresAt - left.expiresAt)[0];
    return Object.freeze({
      exposure,
      pairing,
      peers: this.manager.snapshot().peers,
      sessions: this.headless?.snapshot() ?? [],
    });
  }

  /** Start advertising one short-lived pairing room. */
  start(expiresAt = this.now() + this.defaultLifetimeMs): RemotePairingHandoff {
    if (this.manager.exposure.state === "exposed") throw new Error("remote exposure is already active");
    const exposure = this.manager.expose(expiresAt);
    try {
      return this.createPairing(exposure.expiresAt);
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
      return this.createPairing(exposure.expiresAt, true);
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
    return toHandoff(room);
  }

  consumePairing(attempt: RemotePairingAttempt): RemotePairingAdmission {
    return this.pairing.consume(attempt);
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
    this.pairing.consume(attempt);
    return this.headless.connect(runtime, proof, signal);
  }

  /** Stop accepting new remote pairing/reconnect attempts. Existing peers
   * remain connected so Local/server-owned work is not interrupted. */
  stopExposure(): RemoteExposureStatus {
    this.manager.stopExposure();
    this.pairing.disable();
    return this.status;
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
