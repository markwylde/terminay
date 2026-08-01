import type { ProtocolId } from "@terminay/protocol";
import { WorkspaceStore, type WorkspaceEvent, type WorkspaceState } from "../workspace.js";
import type {
  RemoteAuthProof,
  RemoteConnectionManager,
  RemotePeerSnapshot,
} from "./transport.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{8,256}$/u;

/** The proof material is passed to the server's device/pairing authority and
 * is never retained by the application gateway. A verifier may use a
 * cryptographic device-key check, PIN proof, or an explicit approval record.
 */
export interface RemoteApplicationAuthRequest {
  readonly proof: RemoteAuthProof;
  readonly protocolVersion: number;
  readonly clientNonce: string;
  readonly deviceKeyProof: Uint8Array;
  readonly pinProof?: Uint8Array;
  readonly approvalToken?: string;
  readonly resume?: RemoteResumeRequest;
}

export interface RemoteDeviceVerificationContext {
  readonly proof: RemoteAuthProof;
  readonly protocolVersion: number;
  readonly clientNonce: string;
  readonly deviceKeyProof: Uint8Array;
}

export interface RemoteApprovalVerificationContext {
  readonly deviceId: ProtocolId;
  readonly serverId: ProtocolId;
  readonly sessionOrigin: string;
  readonly clientNonce: string;
  readonly pinProof?: Uint8Array;
  readonly approvalToken?: string;
}

export interface RemoteApplicationVerifier {
  readonly verifyDeviceKey: (
    context: RemoteDeviceVerificationContext,
  ) => boolean | Promise<boolean>;
  readonly verifyPinOrApproval: (
    context: RemoteApprovalVerificationContext,
  ) => boolean | Promise<boolean>;
}

export interface RemoteTerminalPosition {
  readonly sessionId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly position: number;
}

export interface RemoteResumeRequest {
  readonly workspaceRevision?: number;
  readonly terminalPositions?: readonly RemoteTerminalPosition[];
}

export interface RemoteTerminalResume {
  readonly sessionId: ProtocolId;
  readonly projectId: ProtocolId;
  readonly status: "running" | "exited" | "interrupted";
  readonly fromPosition: number;
  readonly nextPosition: number;
  readonly chunks: readonly Uint8Array[];
}

export interface RemoteTerminalResumeReader {
  readonly read: (context: {
    readonly sessionId: ProtocolId;
    readonly projectId: ProtocolId;
    readonly fromPosition: number;
    readonly signal: AbortSignal;
  }) => RemoteTerminalResume | Promise<RemoteTerminalResume>;
}

export interface RemoteWorkspaceResume {
  readonly mode: "events" | "snapshot";
  readonly requestedRevision: number;
  readonly revision: number;
  readonly cursor: string;
  /** Present only when the retained event window cannot satisfy the request. */
  readonly state?: WorkspaceState;
  readonly events: ReadonlyArray<WorkspaceEvent>;
}

export interface RemoteResumeState {
  readonly workspace: RemoteWorkspaceResume;
  readonly terminals: readonly RemoteTerminalResume[];
}

export interface RemoteApplicationConnection {
  readonly peerId: ProtocolId;
  readonly deviceId: ProtocolId;
  readonly protocolVersion: number;
  readonly authenticatedAt: number;
  readonly resume: RemoteResumeState;
}

export interface RemoteApplicationGatewayOptions {
  readonly manager: RemoteConnectionManager;
  readonly workspace: WorkspaceStore;
  readonly protocolVersion?: number;
  readonly verifier: RemoteApplicationVerifier;
  readonly terminalResume?: RemoteTerminalResumeReader;
  readonly maxDeviceKeyProofBytes?: number;
  readonly maxPinProofBytes?: number;
  readonly maxResumeSessions?: number;
  readonly maxResumeBytes?: number;
  readonly maxWorkspaceResumeBytes?: number;
  readonly now?: () => number;
}

type ConnectionRecord = {
  readonly deviceId: ProtocolId;
  readonly protocolVersion: number;
  readonly authenticatedAt: number;
  readonly abortController: AbortController;
};

/**
 * Server-side application handshake layered over the transport queue.
 *
 * `RemoteConnectionManager` is deliberately unaware of pairing credentials;
 * this gateway is the narrow authority that obtains device-key and
 * PIN/approval verification before converting a proof into an admitted peer.
 * It also turns the canonical workspace revision and terminal output
 * positions into one bounded reconnect response without retaining credential
 * material or making the client a second state authority.
 */
export class RemoteApplicationGateway {
  private readonly manager: RemoteConnectionManager;
  private readonly workspace: WorkspaceStore;
  private readonly protocolVersion: number;
  private readonly verifier: RemoteApplicationVerifier;
  private readonly terminalResume: RemoteTerminalResumeReader | undefined;
  private readonly maxDeviceKeyProofBytes: number;
  private readonly maxPinProofBytes: number;
  private readonly maxResumeSessions: number;
  private readonly maxResumeBytes: number;
  private readonly maxWorkspaceResumeBytes: number;
  private readonly now: () => number;
  private readonly connections = new Map<ProtocolId, ConnectionRecord>();

  constructor(options: RemoteApplicationGatewayOptions) {
    this.manager = options.manager;
    this.workspace = options.workspace;
    this.protocolVersion = positive(options.protocolVersion ?? 1, "protocolVersion");
    this.verifier = options.verifier;
    this.terminalResume = options.terminalResume;
    this.maxDeviceKeyProofBytes = positive(options.maxDeviceKeyProofBytes ?? 8 * 1024, "maxDeviceKeyProofBytes");
    this.maxPinProofBytes = positive(options.maxPinProofBytes ?? 2 * 1024, "maxPinProofBytes");
    this.maxResumeSessions = positive(options.maxResumeSessions ?? 128, "maxResumeSessions");
    this.maxResumeBytes = positive(options.maxResumeBytes ?? 2 * 1024 * 1024, "maxResumeBytes");
    this.maxWorkspaceResumeBytes = positive(options.maxWorkspaceResumeBytes ?? 4 * 1024 * 1024, "maxWorkspaceResumeBytes");
    this.now = options.now ?? (() => Date.now());
  }

  /** Authenticate and admit exactly one peer ticket, then produce its first
   * application snapshot/delta. Proof material is not copied into connection
   * state, and verifier failures intentionally have one generic error. */
  async authenticate(request: RemoteApplicationAuthRequest): Promise<RemoteApplicationConnection> {
    const resume = normalizeResumeRequest(request.resume, this.maxResumeSessions);
    validateAuthRequest(request, this.protocolVersion, this.maxDeviceKeyProofBytes, this.maxPinProofBytes);
    validateProofShape(request.proof, this.now());
    if (request.proof.serverId !== this.manager.serverId || request.proof.sessionOrigin !== this.manager.sessionOrigin) {
      throw new Error("remote authentication failed");
    }
    try {
      this.manager.assertTicketAvailable(request.proof.ticketId);
    } catch {
      throw new Error("remote authentication failed");
    }

    let verified = false;
    try {
      const deviceVerified = await this.verifier.verifyDeviceKey({
        proof: request.proof,
        protocolVersion: request.protocolVersion,
        clientNonce: request.clientNonce,
        deviceKeyProof: request.deviceKeyProof,
      });
      const approvalVerified = await this.verifier.verifyPinOrApproval({
        deviceId: request.proof.deviceId,
        serverId: request.proof.serverId,
        sessionOrigin: request.proof.sessionOrigin,
        clientNonce: request.clientNonce,
        ...(request.pinProof === undefined ? {} : { pinProof: request.pinProof }),
        ...(request.approvalToken === undefined ? {} : { approvalToken: request.approvalToken }),
      });
      verified = deviceVerified === true && approvalVerified === true;
    } catch {
      verified = false;
    }
    if (!verified) throw new Error("remote authentication failed");

    let peer: RemotePeerSnapshot;
    try {
      // The proof's authenticated bit is not trusted; it is set only after
      // both injected server-side verifiers have succeeded.
      peer = this.manager.admit({ ...request.proof, authenticated: true });
    } catch {
      throw new Error("remote authentication failed");
    }
    const abortController = new AbortController();
    const record: ConnectionRecord = {
      deviceId: peer.deviceId,
      protocolVersion: request.protocolVersion,
      authenticatedAt: this.now(),
      abortController,
    };
    this.connections.set(peer.peerId, record);
    try {
      const state = await this.buildResume(resume, abortController.signal);
      return Object.freeze({
        peerId: peer.peerId,
        deviceId: peer.deviceId,
        protocolVersion: request.protocolVersion,
        authenticatedAt: record.authenticatedAt,
        resume: state,
      });
    } catch (error) {
      abortController.abort(error instanceof Error ? error : new Error("resume failed"));
      this.connections.delete(peer.peerId);
      this.manager.closePeer(peer.peerId);
      throw error;
    }
  }

  /** Build a fresh, bounded resume response for an already authenticated
   * peer. Stopping exposure does not invalidate this operation; revocation or
   * peer closure does. */
  async resume(peerId: ProtocolId, request: RemoteResumeRequest = {}): Promise<RemoteResumeState> {
    const record = this.requireConnection(peerId);
    const normalized = normalizeResumeRequest(request, this.maxResumeSessions);
    return this.buildResume(normalized, record.abortController.signal);
  }

  close(peerId: ProtocolId): void {
    const record = this.connections.get(peerId);
    if (record !== undefined) record.abortController.abort(new Error("remote peer closed"));
    this.connections.delete(peerId);
    if (this.manager.snapshot().peers.some((peer) => peer.peerId === peerId)) this.manager.closePeer(peerId);
  }

  revokeDevice(deviceId: ProtocolId): number {
    const count = this.manager.revokeDevice(deviceId);
    for (const [peerId, record] of this.connections) {
      if (record.deviceId !== deviceId) continue;
      record.abortController.abort(new Error("remote device revoked"));
      this.connections.delete(peerId);
    }
    return count;
  }

  private requireConnection(peerId: ProtocolId): ConnectionRecord {
    if (!ID_PATTERN.test(peerId)) throw new Error("remote peer is unknown");
    const record = this.connections.get(peerId);
    const peer = this.manager.snapshot().peers.find((candidate) => candidate.peerId === peerId);
    if (record === undefined || peer === undefined || peer.state !== "connected") throw new Error("remote peer is not connected");
    return record;
  }

  private async buildResume(request: NormalizedResumeRequest, signal: AbortSignal): Promise<RemoteResumeState> {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("remote peer closed");
    const delta = this.workspace.delta(request.workspaceRevision);
    const mode = delta.events.length === 0 && delta.state.revision > request.workspaceRevision ? "snapshot" : "events";
    const workspace: RemoteWorkspaceResume = {
      mode,
      requestedRevision: request.workspaceRevision,
      revision: delta.state.revision,
      cursor: delta.state.cursor,
      events: delta.events,
      ...(mode === "snapshot" ? { state: delta.state } : {}),
    };
    const workspaceBytes = new TextEncoder().encode(JSON.stringify(workspace)).byteLength;
    if (workspaceBytes > this.maxWorkspaceResumeBytes) throw new RangeError("remote workspace resume exceeds byte limit");
    const terminals: RemoteTerminalResume[] = [];
    let totalBytes = 0;
    for (const cursor of request.terminalPositions) {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("remote peer closed");
      const session = this.workspace.state.terminalSessions[cursor.sessionId];
      if (session === undefined || session.projectId !== cursor.projectId) throw new Error("remote terminal scope is invalid");
      const result = this.terminalResume === undefined
        ? { sessionId: cursor.sessionId, projectId: cursor.projectId, status: session.status, fromPosition: cursor.position, nextPosition: session.outputPosition, chunks: [] }
        : await this.terminalResume.read({ sessionId: cursor.sessionId, projectId: cursor.projectId, fromPosition: cursor.position, signal });
      const normalized = normalizeTerminalResume(result, cursor, session.status);
      for (const chunk of normalized.chunks) totalBytes += chunk.byteLength;
      if (totalBytes > this.maxResumeBytes) throw new RangeError("remote resume exceeds byte limit");
      terminals.push(normalized);
    }
    return Object.freeze({ workspace, terminals: Object.freeze(terminals) });
  }
}

type NormalizedResumeRequest = {
  readonly workspaceRevision: number;
  readonly terminalPositions: readonly RemoteTerminalPosition[];
};

function normalizeResumeRequest(value: RemoteResumeRequest | undefined, maxSessions: number): NormalizedResumeRequest {
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) throw new TypeError("remote resume request is invalid");
  const workspaceRevision = value?.workspaceRevision ?? 0;
  if (!Number.isSafeInteger(workspaceRevision) || workspaceRevision < 0) throw new RangeError("remote workspace revision is invalid");
  const positions = value?.terminalPositions ?? [];
  if (!Array.isArray(positions) || positions.length > maxSessions) throw new RangeError("remote terminal resume count exceeds limit");
  const seen = new Set<ProtocolId>();
  const terminalPositions = positions.map((cursor) => {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) throw new TypeError("remote terminal cursor is invalid");
    if (!ID_PATTERN.test(cursor.sessionId) || !ID_PATTERN.test(cursor.projectId)) throw new TypeError("remote terminal scope is invalid");
    if (!Number.isSafeInteger(cursor.position) || cursor.position < 0) throw new RangeError("remote terminal position is invalid");
    if (seen.has(cursor.sessionId)) throw new Error("remote terminal cursor is duplicated");
    seen.add(cursor.sessionId);
    return Object.freeze({ sessionId: cursor.sessionId, projectId: cursor.projectId, position: cursor.position });
  });
  return Object.freeze({ workspaceRevision, terminalPositions: Object.freeze(terminalPositions) });
}

function normalizeTerminalResume(
  value: RemoteTerminalResume,
  cursor: RemoteTerminalPosition,
  status: RemoteTerminalResume["status"],
): RemoteTerminalResume {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("remote terminal resume is invalid");
  if (value.sessionId !== cursor.sessionId || value.projectId !== cursor.projectId || value.status !== status) throw new Error("remote terminal scope is invalid");
  if (!Number.isSafeInteger(value.fromPosition) || value.fromPosition !== cursor.position || !Number.isSafeInteger(value.nextPosition) || value.nextPosition < value.fromPosition) throw new RangeError("remote terminal resume position is invalid");
  if (!Array.isArray(value.chunks)) throw new TypeError("remote terminal resume chunks are invalid");
  const chunks = value.chunks.map((chunk) => {
    if (!(chunk instanceof Uint8Array)) throw new TypeError("remote terminal resume chunk is invalid");
    return new Uint8Array(chunk);
  });
  return Object.freeze({ sessionId: value.sessionId, projectId: value.projectId, status: value.status, fromPosition: value.fromPosition, nextPosition: value.nextPosition, chunks: Object.freeze(chunks) });
}

function validateAuthRequest(
  request: RemoteApplicationAuthRequest,
  protocolVersion: number,
  maxDeviceKeyProofBytes: number,
  maxPinProofBytes: number,
): void {
  if (typeof request !== "object" || request === null || Array.isArray(request)) throw new TypeError("remote auth request is invalid");
  if (request.protocolVersion !== protocolVersion) throw new Error("remote protocol version is incompatible");
  if (!NONCE_PATTERN.test(request.clientNonce)) throw new TypeError("remote client nonce is invalid");
  if (!(request.deviceKeyProof instanceof Uint8Array) || request.deviceKeyProof.byteLength === 0 || request.deviceKeyProof.byteLength > maxDeviceKeyProofBytes) throw new RangeError("remote device proof exceeds limit");
  if (request.pinProof !== undefined && (!(request.pinProof instanceof Uint8Array) || request.pinProof.byteLength === 0 || request.pinProof.byteLength > maxPinProofBytes)) throw new RangeError("remote PIN proof exceeds limit");
  if (request.approvalToken !== undefined && (typeof request.approvalToken !== "string" || request.approvalToken.length < 8 || request.approvalToken.length > 512 || !/^[A-Za-z0-9._~-]+$/u.test(request.approvalToken))) throw new TypeError("remote approval token is invalid");
}

function validateProofShape(proof: RemoteAuthProof, now: number): void {
  if (typeof proof !== "object" || proof === null || Array.isArray(proof)) throw new Error("remote authentication failed");
  if (!ID_PATTERN.test(proof.ticketId) || !ID_PATTERN.test(proof.serverId) || !ID_PATTERN.test(proof.deviceId) || typeof proof.sessionOrigin !== "string" || proof.sessionOrigin.length > 4096 || !Number.isFinite(proof.expiresAt) || proof.expiresAt <= now || typeof proof.authenticated !== "boolean") throw new Error("remote authentication failed");
}

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
  return value;
}
