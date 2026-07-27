import type { ProtocolId } from "@terminay/protocol";

export type RemoteTrafficChannel = "control" | "application" | "terminal" | "assets";
export type ExposureState = "disabled" | "exposed";
export type RemotePeerState = "connected" | "revoked" | "closed";

export interface RemoteConnectionManagerOptions {
  readonly serverId: ProtocolId;
  readonly sessionOrigin: string;
  readonly now?: () => number;
  readonly maxPeers?: number;
  readonly maxFrameBytes?: number;
  readonly maxQueuedBytes?: number;
  readonly maxAssetQueuedBytes?: number;
  readonly maxUsedTickets?: number;
}

export interface RemoteAuthProof {
  readonly ticketId: ProtocolId;
  readonly serverId: ProtocolId;
  readonly sessionOrigin: string;
  readonly deviceId: ProtocolId;
  readonly expiresAt: number;
  readonly authenticated: boolean;
}

export interface RemoteExposure {
  readonly state: ExposureState;
  readonly roomId?: ProtocolId;
  readonly expiresAt?: number;
}

export interface RemotePeerSnapshot {
  readonly peerId: ProtocolId;
  readonly deviceId: ProtocolId;
  readonly state: RemotePeerState;
  readonly connectedAt: number;
  readonly lastSeenAt: number;
  readonly queuedBytes: number;
}

export interface RemoteTransportSnapshot {
  readonly exposure: RemoteExposure;
  readonly peers: readonly RemotePeerSnapshot[];
}

const CHANNELS: readonly RemoteTrafficChannel[] = ["control", "application", "terminal", "assets"];

interface QueueState { readonly chunks: Uint8Array[]; bytes: number; }
interface PeerState { readonly peerId: ProtocolId; readonly deviceId: ProtocolId; state: RemotePeerState; readonly connectedAt: number; lastSeenAt: number; readonly queues: Record<RemoteTrafficChannel, QueueState>; }

/** Transport adapter boundary for a headless WebRTC host. It accepts only an
 * already-authenticated, server-bound proof; signaling and cryptographic proof
 * verification remain outside this queue/connection primitive. */
export class RemoteConnectionManager {
  private readonly now: () => number;
  private readonly maxPeers: number;
  private readonly maxFrameBytes: number;
  private readonly maxQueuedBytes: number;
  private readonly maxAssetQueuedBytes: number;
  private readonly maxUsedTickets: number;
  private readonly peers = new Map<ProtocolId, PeerState>();
  private readonly usedTickets = new Map<ProtocolId, number>();
  private readonly revokedDevices = new Set<ProtocolId>();
  private exposureValue: RemoteExposure = Object.freeze({ state: "disabled" });
  private sequence = 0;

  constructor(private readonly options: RemoteConnectionManagerOptions) {
    if (!validId(options.serverId) || !validOrigin(options.sessionOrigin)) throw new TypeError("remote server identity/origin is invalid");
    this.now = options.now ?? (() => Date.now());
    this.maxPeers = positive(options.maxPeers ?? 16, "maxPeers");
    this.maxFrameBytes = positive(options.maxFrameBytes ?? 1024 * 1024, "maxFrameBytes");
    this.maxQueuedBytes = positive(options.maxQueuedBytes ?? 8 * 1024 * 1024, "maxQueuedBytes");
    this.maxAssetQueuedBytes = positive(options.maxAssetQueuedBytes ?? 16 * 1024 * 1024, "maxAssetQueuedBytes");
    this.maxUsedTickets = positive(options.maxUsedTickets ?? 4096, "maxUsedTickets");
  }

  get exposure(): RemoteExposure {
    this.expireExposureIfNeeded();
    return this.exposureValue;
  }

  /** Stable server/session identity used by application authentication. */
  get serverId(): ProtocolId { return this.options.serverId; }
  get sessionOrigin(): string { return this.options.sessionOrigin; }

  expose(expiresAt: number): RemoteExposure {
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new RangeError("exposure expiry is invalid");
    const roomId = `room-${this.nextId()}`;
    this.exposureValue = Object.freeze({ state: "exposed", roomId, expiresAt });
    return this.exposureValue;
  }

  rotateExposure(expiresAt: number): RemoteExposure {
    return this.expose(expiresAt);
  }

  stopExposure(): RemoteExposure {
    this.exposureValue = Object.freeze({ state: "disabled" });
    return this.exposureValue;
  }

  admit(proof: RemoteAuthProof): RemotePeerSnapshot {
    this.expireExposureIfNeeded();
    if (this.exposureValue.state !== "exposed" || this.exposureValue.expiresAt === undefined) throw new Error("remote exposure is unavailable");
    if (!proof.authenticated) throw new Error("remote peer is not authenticated");
    if (proof.serverId !== this.options.serverId || proof.sessionOrigin !== this.options.sessionOrigin) throw new Error("remote peer identity mismatch");
    if (!validId(proof.deviceId) || !validId(proof.ticketId) || !Number.isFinite(proof.expiresAt) || proof.expiresAt <= this.now()) throw new Error("remote ticket is invalid or expired");
    if (this.revokedDevices.has(proof.deviceId)) throw new Error("remote device is revoked");
    this.pruneUsedTickets();
    if (this.usedTickets.has(proof.ticketId)) throw new Error("remote ticket has already been used");
    const connectedPeers = [...this.peers.values()].filter((peer) => peer.state === "connected").length;
    if (connectedPeers >= this.maxPeers) throw new Error("remote peer limit reached");
    if (this.usedTickets.size >= this.maxUsedTickets) throw new Error("remote ticket replay ledger is full");
    this.usedTickets.set(proof.ticketId, proof.expiresAt);
    const peerId = `peer-${this.nextId()}`;
    const at = this.now();
    const peer: PeerState = { peerId, deviceId: proof.deviceId, state: "connected", connectedAt: at, lastSeenAt: at, queues: createQueues() };
    this.peers.set(peerId, peer);
    return this.snapshotPeer(peer);
  }

  send(peerId: ProtocolId, channel: RemoteTrafficChannel, bytes: Uint8Array): void {
    const peer = this.requireConnectedPeer(peerId);
    if (!CHANNELS.includes(channel)) throw new TypeError("remote traffic channel is invalid");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxFrameBytes) throw new RangeError("remote frame exceeds limit");
    const queue = peer.queues[channel];
    const limit = channel === "assets" ? this.maxAssetQueuedBytes : this.maxQueuedBytes;
    if (queue.bytes + bytes.byteLength > limit) throw new Error(`remote ${channel} queue limit reached`);
    queue.chunks.push(new Uint8Array(bytes));
    queue.bytes += bytes.byteLength;
    peer.lastSeenAt = this.now();
  }

  drain(peerId: ProtocolId, channel: RemoteTrafficChannel, maxBytes = this.maxFrameBytes): readonly Uint8Array[] {
    const peer = this.requireConnectedPeer(peerId);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > this.maxFrameBytes) throw new RangeError("drain limit is invalid");
    const queue = peer.queues[channel];
    const output: Uint8Array[] = [];
    let total = 0;
    while (queue.chunks.length > 0) {
      const next = queue.chunks[0];
      if (next === undefined) break;
      if (total + next.byteLength > maxBytes) break;
      queue.chunks.shift();
      queue.bytes -= next.byteLength;
      total += next.byteLength;
      output.push(next);
    }
    peer.lastSeenAt = this.now();
    return output;
  }

  revokeDevice(deviceId: ProtocolId): number {
    if (!validId(deviceId)) throw new TypeError("remote device identity is invalid");
    this.revokedDevices.add(deviceId);
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.deviceId === deviceId && peer.state === "connected") {
        peer.state = "revoked";
        clearQueues(peer);
        count += 1;
      }
    }
    return count;
  }

  closePeer(peerId: ProtocolId): void {
    const peer = this.requirePeer(peerId);
    peer.state = "closed";
    clearQueues(peer);
    this.peers.delete(peerId);
  }

  snapshot(): RemoteTransportSnapshot {
    return Object.freeze({ exposure: this.exposure, peers: Object.freeze([...this.peers.values()].map((peer) => this.snapshotPeer(peer))) });
  }

  private snapshotPeer(peer: PeerState): RemotePeerSnapshot {
    return Object.freeze({ peerId: peer.peerId, deviceId: peer.deviceId, state: peer.state, connectedAt: peer.connectedAt, lastSeenAt: peer.lastSeenAt, queuedBytes: Object.values(peer.queues).reduce((total, queue) => total + queue.bytes, 0) });
  }

  private requirePeer(peerId: ProtocolId): PeerState {
    const peer = this.peers.get(peerId);
    if (peer === undefined) throw new Error("remote peer is unknown");
    return peer;
  }

  private requireConnectedPeer(peerId: ProtocolId): PeerState {
    const peer = this.requirePeer(peerId);
    if (peer.state !== "connected") throw new Error("remote peer is not connected");
    return peer;
  }

  private expireExposureIfNeeded(): void {
    const expiresAt = this.exposureValue.expiresAt;
    if (this.exposureValue.state === "exposed" && expiresAt !== undefined && expiresAt <= this.now()) {
      this.exposureValue = Object.freeze({ state: "disabled" });
    }
  }

  private pruneUsedTickets(): void {
    const now = this.now();
    for (const [ticketId, expiresAt] of this.usedTickets) if (expiresAt <= now) this.usedTickets.delete(ticketId);
  }

  private nextId(): string {
    this.sequence += 1;
    return `${this.now().toString(36)}-${this.sequence.toString(36)}`;
  }
}

function createQueues(): Record<RemoteTrafficChannel, QueueState> {
  return { control: { chunks: [], bytes: 0 }, application: { chunks: [], bytes: 0 }, terminal: { chunks: [], bytes: 0 }, assets: { chunks: [], bytes: 0 } };
}

function clearQueues(peer: PeerState): void { for (const queue of Object.values(peer.queues)) { queue.chunks.length = 0; queue.bytes = 0; } }
function validId(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value); }
function validOrigin(value: string): boolean { try { const url = new URL(value); const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")); return allowedProtocol && !url.username && !url.password && !url.search && !url.hash; } catch { return false; } }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`); return value; }
