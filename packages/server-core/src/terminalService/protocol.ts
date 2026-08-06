import type { JsonValue } from "@terminay/protocol";
import { TerminalServiceError } from "./errors.js";
import { TerminalInputSourceAdapter, type TerminalInputSource } from "./inputSources.js";
import { TerminalService } from "./service.js";
import { TerminalServiceAdapter, type TerminalAttachment } from "./adapter.js";
import { TerminalPresentationLeaseAuthority, type TerminalPresentationLeaseState } from "./presentationLease.js";
import type {
  TerminalAuthorization,
  TerminalEvent,
  TerminalIdentity,
  TerminalSessionSnapshot,
} from "./types.js";
import type { TerminalLaunchResolver } from "./launchResolver.js";
import type {
  CommandRequest,
  OperationRegistries,
  QueryRequest,
} from "../types.js";
import type { OrderedEventJournalLike } from "../types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_INPUT_BYTES = 1024 * 1024;
// Terminal replay is base64-encoded in the command-result header. Keep the raw
// replay below half of the default 64 KiB header budget so the envelope and
// metadata cannot turn a valid attach into a protocol-limit failure.
const MAX_INITIAL_REPLAY_BYTES = 32 * 1024;
const TERMINAL_EVENT = "terminal";

export interface TerminalOperationRegistryOptions {
  readonly service: TerminalService;
  /** Canonical privileged launch boundary. Hosts without profiles may omit it
   * only for compatibility tests and must provide fully trusted create data. */
  readonly launchResolver?: TerminalLaunchResolver;
	/** @internal Explicit escape hatch for low-level PTY protocol tests only. */
	readonly allowUnresolvedTestSessions?: boolean;
  readonly attachments?: TerminalServiceAdapter;
  readonly inputSources?: TerminalInputSourceAdapter;
  readonly presentations?: TerminalPresentationLeaseAuthority;
  /** The journal must also be installed on the transport's server core. */
  readonly eventJournal: OrderedEventJournalLike;
  /** Reconcile a newly-created PTY with other server-owned authorities before
   * its identity is returned to the client. */
  readonly onSessionCreated?: (snapshot: TerminalSessionSnapshot) => void;
}

export interface TerminalOperationRegistry {
  readonly operations: OperationRegistries;
  /** Detach all protocol attachments for a client without touching the PTY. */
  readonly closeClient: (clientId: string) => void;
}

interface ProtocolAttachment {
  readonly clientId: string;
  readonly identity: TerminalIdentity;
  readonly attachment: TerminalAttachment;
}

/**
 * Bind the transport-neutral terminal client contract to server-core.
 *
 * The registry is deliberately independent of HTTP, WebRTC, Electron, and
 * xterm. A transport supplies an authenticated RequestContext and shares the
 * same OrderedEventJournal with ServerConnection. Terminal output is scoped
 * by authenticated client id before it is appended to that journal.
 */
export function createTerminalOperationRegistry(options: TerminalOperationRegistryOptions): TerminalOperationRegistry {
  if (!(options.service instanceof TerminalService)) throw new TypeError("terminal service is required");
  const attachments = options.attachments ?? new TerminalServiceAdapter(options.service);
  const inputSources = options.inputSources ?? new TerminalInputSourceAdapter(options.service);
  const protocolAttachments = new Map<string, ProtocolAttachment>();
  const byClientSession = new Map<string, string>();
  const presentations = options.presentations ?? new TerminalPresentationLeaseAuthority({
    onChanged: (state, action) => publishPresentationState(state, action),
  });

  const commands = {
    "terminal.create": (request: CommandRequest) => create(request),
    "terminal.attach": (request: CommandRequest) => attach(request),
    "terminal.resume": (request: CommandRequest) => attach(request),
    "terminal.ack": (request: CommandRequest) => acknowledge(request),
    "terminal.input": (request: CommandRequest) => input(request),
    "terminal.resize": (request: CommandRequest) => resize(request),
    "terminal.presentation": (request: CommandRequest) => presentation(request),
    "terminal.kill": (request: CommandRequest) => kill(request),
    "terminal.detach": (request: CommandRequest) => detach(request),
  };
  const queries = {
    "terminal.list": (request: QueryRequest) => list(request),
    "terminal.cwd": (request: QueryRequest) => currentCwd(request),
    "terminal.wait-inactivity": (request: QueryRequest) => waitForInactivity(request),
  };

  return {
    operations: {
      queries,
      commands,
      policies: {
        "terminal.list": { scope: "read" },
        "terminal.cwd": { scope: "read" },
        "terminal.wait-inactivity": { scope: "read" },
        "terminal.create": { scope: "write" },
        "terminal.attach": { scope: "read" },
        "terminal.resume": { scope: "read" },
        "terminal.ack": { scope: "read" },
        "terminal.input": { scope: "write" },
        "terminal.resize": { scope: "write" },
        "terminal.presentation": { scope: "write" },
        "terminal.kill": { scope: "write" },
        "terminal.detach": { scope: "read" },
      },
    },
    closeClient: (clientId) => {
      const releasedIdentities = new Map<string, TerminalIdentity>();
      for (const [id, value] of protocolAttachments) {
        if (value.clientId !== clientId) continue;
        releasedIdentities.set(sessionKey(value.clientId, value.identity), value.identity);
        attachments.detach(id);
        protocolAttachments.delete(id);
        if (byClientSession.get(sessionKey(value.clientId, value.identity)) === id) byClientSession.delete(sessionKey(value.clientId, value.identity));
      }
      // A disconnected client must not keep the viewport lease alive until its
      // timeout.  Detaching the stream and releasing dimensions are separate
      // concerns, but both are consequences of the same authenticated client
      // lifecycle event; neither affects the server-owned PTY.
      for (const identity of releasedIdentities.values()) inputSources.releaseClient(identity, clientId);
      for (const identity of releasedIdentities.values()) presentations.releaseClient(identity, clientId);
    },
  };

  async function currentCwd(request: QueryRequest): Promise<JsonValue> {
    const payload = objectPayload(request.envelope.payload);
    if (typeof payload.projectId !== "string" || typeof payload.sessionId !== "string" ||
        !ID_PATTERN.test(payload.projectId) || !ID_PATTERN.test(payload.sessionId)) {
      throw new TerminalServiceError("invalid_identity", "terminal identity is invalid");
    }
    const identity: TerminalIdentity = {
      serverId: options.service.serverId,
      projectId: payload.projectId,
      sessionId: payload.sessionId,
    };
    assertProjectClaim(request, identity.projectId);
    return {
      ...identity,
      ...(await options.service.currentCwd(
        identity,
        authorizationFor(identity, request, "read"),
      )),
    };
  }

  async function waitForInactivity(request: QueryRequest): Promise<JsonValue> {
    const payload = objectPayload(request.envelope.payload);
    if (typeof payload.projectId !== "string" || typeof payload.sessionId !== "string" || !ID_PATTERN.test(payload.projectId) || !ID_PATTERN.test(payload.sessionId)) {
      throw new TerminalServiceError("invalid_identity", "terminal identity is invalid");
    }
    const identity: TerminalIdentity = { serverId: options.service.serverId, projectId: payload.projectId, sessionId: payload.sessionId };
    const durationMs = payload.durationMs;
    if (!Number.isSafeInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > 24 * 60 * 60 * 1_000) {
      throw new RangeError("terminal inactivity duration is invalid");
    }
    await options.service.waitForInactivity(identity, durationMs as number, {
      authorization: authorizationFor(identity, request, "read"),
      signal: request.context.signal,
    });
    return { ...identity, inactive: true };
  }

  async function create(request: CommandRequest): Promise<JsonValue> {
    const payload = objectPayload(request.envelope.payload);
    if (request.context.authScope !== "write" && request.context.authScope !== "admin") {
      throw new TerminalServiceError("forbidden", "terminal creation requires write access");
    }
    const projectId = payload.projectId;
    if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) {
      throw new TerminalServiceError("invalid_identity", "project id is invalid");
    }
    assertProjectClaim(request, projectId);
    const cwd = payload.cwd;
    if (cwd !== undefined && (typeof cwd !== "string" || cwd.length === 0 || cwd.length > 4_096)) {
      throw new TerminalServiceError("invalid_identity", "terminal cwd is invalid");
    }
    const profileId = optionalId(payload.profileId, "shell profile id");
    const activePanelId = optionalId(payload.activePanelId, "active panel id");
    const cols = payload.cols === undefined ? 80 : positiveDimension(payload.cols, "cols");
    const rows = payload.rows === undefined ? 24 : positiveDimension(payload.rows, "rows");
    if (options.launchResolver === undefined && options.allowUnresolvedTestSessions !== true) {
			throw new TerminalServiceError("service_shutdown", "canonical terminal launch resolution is unavailable");
		}
    const session = options.launchResolver === undefined
      ? await options.service.createSession({ projectId, ...(cwd === undefined ? {} : { cwd }), cols, rows })
      : await options.service.createResolvedSession(await options.launchResolver.resolve({
          identity: options.service.allocateIdentity(projectId),
          ...(profileId === undefined ? {} : { explicitProfileId: profileId }),
          ...(cwd === undefined ? {} : { explicitCwd: cwd }),
          ...(activePanelId === undefined ? {} : { activePanelId }),
          cols,
          rows,
        }));
    const snapshot = session.snapshot();
    try {
      options.onSessionCreated?.(snapshot);
    } catch (error) {
      await options.service.kill(snapshot);
      throw error;
    }
    return {
      serverId: snapshot.serverId,
      projectId: snapshot.projectId,
      sessionId: snapshot.sessionId,
      cwd: snapshot.cwd,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      outputPosition: snapshot.outputPosition,
      replayFrom: snapshot.replayFrom,
      dimensions: { ...snapshot.dimensions },
      ...(snapshot.launch === undefined ? {} : { launch: { ...snapshot.launch } }),
      ...(snapshot.pid === undefined ? {} : { pid: snapshot.pid }),
    };
  }

  function optionalId(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      throw new TerminalServiceError("invalid_identity", `${name} is invalid`);
    }
    return value;
  }

  function assertProjectClaim(request: QueryRequest | CommandRequest, projectId: string): void {
    const claims = request.context.claims;
    const claimedProjectId = typeof claims === "object" && claims !== null && !Array.isArray(claims)
      && typeof claims.projectId === "string" ? claims.projectId : undefined;
    if (claimedProjectId !== undefined && claimedProjectId !== projectId) {
      throw new TerminalServiceError("forbidden", "terminal project is outside the authenticated project boundary");
    }
		if (
			request.envelope.operation === "terminal.create" &&
			typeof claims === "object" && claims !== null && !Array.isArray(claims) &&
			typeof claims.sessionId === "string"
		) {
			throw new TerminalServiceError("forbidden", "session-scoped authorization cannot create another terminal");
		}
  }

  function attach(request: CommandRequest): JsonValue {
    const payload = objectPayload(request.envelope.payload);
    const identity = parseIdentity(payload.identity, options.service.serverId);
    const clientId = assertClient(request.context.clientId, payload.clientId);
    const requestedFromPosition = position(payload.fromPosition ?? 0);
    const freshPresentation = payload.freshPresentation === true;
    if (freshPresentation && requestedFromPosition !== 0) throw new TerminalServiceError("invalid_position", "a fresh terminal presentation must start at position zero");
    const requestedInitialReplayBytes = payload.maxInitialReplayBytes === undefined
      ? undefined
      : position(payload.maxInitialReplayBytes);
    const maxInitialReplayBytes = requestedInitialReplayBytes === undefined
      ? MAX_INITIAL_REPLAY_BYTES
      : Math.min(requestedInitialReplayBytes, MAX_INITIAL_REPLAY_BYTES);
    const authorization = authorizationFor(identity, request, "read");
    const snapshot = options.service.getSession(identity);
    // A fresh emulator is valid only when the complete bounded transcript from
    // position zero is available. Reconnecting emulators may resume from their
    // exact rendered position. Never manufacture an arbitrary byte suffix.
    const presentationUnavailable = snapshot !== undefined && (
      requestedFromPosition < snapshot.replayFrom ||
      ((freshPresentation || requestedFromPosition === 0) && snapshot.outputPosition > maxInitialReplayBytes)
    );
    const fromPosition = presentationUnavailable && snapshot !== undefined
      ? snapshot.outputPosition
      : requestedFromPosition;
    const key = sessionKey(clientId, identity);
    const priorId = byClientSession.get(key);
    if (priorId !== undefined) {
      const prior = protocolAttachments.get(priorId);
      if (prior !== undefined) presentations.releaseAttachment({ ...prior.identity, clientId: prior.clientId, attachmentId: prior.attachment.attachmentId });
      attachments.detach(priorId);
      protocolAttachments.delete(priorId);
    }
    let attachmentId: string | undefined;
    const attachment = attachments.attach({ clientId, identity, authorization, fromPosition }, {
      onEvent: (event) => {
        if (attachmentId === undefined) return;
        options.eventJournal.append(TERMINAL_EVENT, terminalEventPayload(event, attachmentId, clientId));
      },
    });
    attachmentId = attachment.attachmentId;
    protocolAttachments.set(attachment.attachmentId, { clientId, identity, attachment });
    byClientSession.set(key, attachment.attachmentId);
    return {
      attachmentId: attachment.attachmentId,
      fromPosition: attachment.snapshot().fromPosition,
      position: attachment.position,
      events: presentationUnavailable && snapshot !== undefined
        ? [{ clientId, attachmentId: attachment.attachmentId, type: "presentation_unavailable", ...identity, requestedFromPosition, replayFrom: snapshot.replayFrom, outputPosition: snapshot.outputPosition }]
        : compactInitialEvents(attachment.initialEvents).map((event) => terminalEventPayload(event, attachment.attachmentId, clientId)),
      presentation: presentationPayload(presentations.state(identity), clientId, attachment.attachmentId),
    };
  }

  async function acknowledge(request: CommandRequest): Promise<JsonValue> {
    const value = attachmentFor(request, "read");
    const positionValue = position(objectPayload(request.envelope.payload).position ?? -1);
    value.attachment.ack(positionValue);
    return { attachmentId: value.attachment.attachmentId, position: positionValue };
  }

  async function input(request: CommandRequest): Promise<JsonValue> {
    const value = attachmentFor(request, "write");
    const payload = objectPayload(request.envelope.payload);
    const bytes = decodeBase64(payload.dataBase64);
    const source = parseSource(payload.source ?? "remote");
    if (source === "macro" || source === "dictation" || source === "mcp") {
      throw new TerminalServiceError("forbidden", "server-authorized terminal sources cannot use a presentation attachment", { reason: "source_boundary" });
    }
    presentations.assertHolder({ ...value.identity, clientId: value.clientId, attachmentId: value.attachment.attachmentId });
    const result = await inputSources.write({
      identity: value.identity,
      clientId: value.clientId,
      source,
      data: bytes,
      authorization: authorizationFor(value.identity, request, "write"),
      ...(payload.sequence === undefined ? {} : { sequence: position(payload.sequence) }),
    });
    return { attachmentId: value.attachment.attachmentId, bytes: result.bytes, queuedBytes: result.queuedBytes };
  }

  async function resize(request: CommandRequest): Promise<JsonValue> {
    const value = attachmentFor(request, "write");
    const payload = objectPayload(request.envelope.payload);
    const cols = positiveDimension(payload.cols, "cols");
    const rows = positiveDimension(payload.rows, "rows");
    const lease = presentations.assertHolder({ ...value.identity, clientId: value.clientId, attachmentId: value.attachment.attachmentId });
    const result = await inputSources.resize({
      identity: value.identity,
      clientId: value.clientId,
      source: parseSource(payload.source ?? "remote"),
      viewport: payload.viewport === "narrow" || payload.viewport === "mobile" ? payload.viewport : "wide",
      mode: "claim",
      cols,
      rows,
      authorization: authorizationFor(value.identity, request, "write"),
    });
    return { attachmentId: value.attachment.attachmentId, cols, rows, presentation: presentationPayload(lease, value.clientId, value.attachment.attachmentId), ...(result.ownership === undefined ? {} : { leaseExpiresAt: result.ownership.leaseExpiresAt }) };
  }

  function presentation(request: CommandRequest): JsonValue {
    const value = attachmentFor(request, "write");
    const payload = objectPayload(request.envelope.payload);
    const mode = payload.mode;
    if (mode !== "acquire" && mode !== "renew" && mode !== "takeover" && mode !== "release" && mode !== "revoke") {
      throw new TerminalServiceError("invalid_identity", "terminal presentation lease mode is invalid");
    }
    const previous = presentations.state(value.identity);
    const state = presentations.change(mode, {
      ...value.identity,
      clientId: value.clientId,
      attachmentId: value.attachment.attachmentId,
    }, {
      ...(payload.leaseMs === undefined ? {} : { leaseMs: position(payload.leaseMs) }),
      admin: request.context.authScope === "admin",
    });
    if (mode === "takeover" && previous.holder !== undefined && previous.holder.clientId !== value.clientId) {
      inputSources.releaseClient(value.identity, previous.holder.clientId);
    }
    return { result: presentationPayload(state, value.clientId, value.attachment.attachmentId) };
  }

  async function kill(request: CommandRequest): Promise<JsonValue> {
    const value = attachmentFor(request, "write");
    const signal = objectPayload(request.envelope.payload).signal;
    if (signal !== undefined && typeof signal !== "string" && typeof signal !== "number") throw new TerminalServiceError("invalid_identity", "terminal signal is invalid");
    await options.service.kill(value.identity, authorizationFor(value.identity, request, "write"), signal as number | string | undefined);
    return { attachmentId: value.attachment.attachmentId, killed: true };
  }

  async function detach(request: CommandRequest): Promise<JsonValue> {
    const value = attachmentFor(request, "read");
    attachments.detach(value.attachment);
    protocolAttachments.delete(value.attachment.attachmentId);
    const key = sessionKey(value.clientId, value.identity);
    if (byClientSession.get(key) === value.attachment.attachmentId) byClientSession.delete(key);
    presentations.releaseAttachment({ ...value.identity, clientId: value.clientId, attachmentId: value.attachment.attachmentId });
    // A detach is the normal panel lifecycle boundary (tab close, server
    // switch, or renderer replacement), not merely an output subscription
    // change. Leaving its resize lease behind makes the next authenticated
    // client appear to be competing with a client that has already left.
    // Releasing the lease never affects the PTY itself.
    inputSources.releaseClient(value.identity, value.clientId);
    return { attachmentId: value.attachment.attachmentId, detached: true };
  }

  function list(request: QueryRequest): JsonValue {
    if (request.context.authScope === "none") throw new TerminalServiceError("forbidden", "terminal listing requires read access");
    const projectId = objectPayload(request.envelope.payload).projectId;
    if (typeof projectId !== "string" || !ID_PATTERN.test(projectId)) throw new TerminalServiceError("invalid_identity", "project id is invalid");
    assertProjectClaim(request, projectId);
    const claims = request.context.claims;
    const claimedSessionId = typeof claims === "object" && claims !== null && !Array.isArray(claims)
      && typeof claims.sessionId === "string" ? claims.sessionId : undefined;
    return {
      serverId: options.service.serverId,
      projectId,
      sessions: options.service.listSessions().filter((session) => session.projectId === projectId && (claimedSessionId === undefined || session.sessionId === claimedSessionId)).map((session) => ({
        serverId: session.serverId,
        projectId: session.projectId,
        sessionId: session.sessionId,
        cwd: session.cwd,
        status: session.status,
        createdAt: session.createdAt,
        outputPosition: session.outputPosition,
        replayFrom: session.replayFrom,
        dimensions: { ...session.dimensions },
        ...(session.launch === undefined ? {} : { launch: { ...session.launch } }),
        ...(session.pid === undefined ? {} : { pid: session.pid }),
        ...(session.exit === undefined ? {} : { exit: { ...session.exit } }),
      })),
    };
  }

  function attachmentFor(request: CommandRequest, required: "read" | "write"): ProtocolAttachment {
    const payload = objectPayload(request.envelope.payload);
    const attachmentId = payload.attachmentId;
    if (typeof attachmentId !== "string") throw new TerminalServiceError("invalid_identity", "terminal attachment id is invalid");
    const value = protocolAttachments.get(attachmentId);
    if (value === undefined) throw new TerminalServiceError("session_not_found", "terminal attachment is unavailable");
    const clientId = assertClient(request.context.clientId, payload.clientId);
    if (value.clientId !== clientId || !sameIdentity(value.identity, parseIdentity(payload.identity, options.service.serverId))) throw new TerminalServiceError("forbidden", "terminal attachment identity mismatch");
    authorizationFor(value.identity, request, required);
    return value;
  }

  function publishPresentationState(state: TerminalPresentationLeaseState, action: string): void {
    for (const value of protocolAttachments.values()) {
      if (!sameIdentity(value.identity, state)) continue;
      options.eventJournal.append(TERMINAL_EVENT, {
        clientId: value.clientId,
        attachmentId: value.attachment.attachmentId,
        type: "presentation",
        action,
        ...presentationPayload(state, value.clientId, value.attachment.attachmentId),
      });
    }
  }
}

function presentationPayload(state: TerminalPresentationLeaseState, clientId: string, attachmentId: string): Record<string, JsonValue> {
  return {
    serverId: state.serverId,
    projectId: state.projectId,
    sessionId: state.sessionId,
    revision: state.revision,
    role: state.holder?.clientId === clientId && state.holder.attachmentId === attachmentId ? "controller" : "read_only",
    ...(state.holder === undefined ? {} : { holder: { ...state.holder } }),
  };
}

function authorizationFor(identity: TerminalIdentity, request: CommandRequest | QueryRequest, required: "read" | "write"): TerminalAuthorization {
  const scope = request.context.authScope;
  const allowed = required === "read" ? scope !== "none" : scope === "write" || scope === "admin";
  if (!allowed) throw new TerminalServiceError("forbidden", "terminal operation is not authorized");
  const claims = request.context.claims;
  if (typeof claims === "object" && claims !== null && !Array.isArray(claims)) {
    if (typeof claims.projectId === "string" && claims.projectId !== identity.projectId) {
      throw new TerminalServiceError("forbidden", "terminal project is outside the authenticated project boundary");
    }
    if (typeof claims.sessionId === "string" && claims.sessionId !== identity.sessionId) {
      throw new TerminalServiceError("forbidden", "terminal session is outside the authenticated session boundary");
    }
  }
  return { ...identity, clientId: request.context.clientId, scope: scope === "admin" ? "admin" : scope === "write" ? "write" : "read" };
}

function objectPayload(value: JsonValue): Readonly<Record<string, JsonValue>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function assertClient(contextClientId: string, payloadClientId: JsonValue | undefined): string {
  if (typeof payloadClientId !== "string" || payloadClientId !== contextClientId || !ID_PATTERN.test(payloadClientId)) throw new TerminalServiceError("forbidden", "terminal client identity mismatch");
  return payloadClientId;
}

function parseIdentity(value: JsonValue | undefined, serverId: string): TerminalIdentity {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TerminalServiceError("invalid_identity", "terminal identity is invalid");
  const candidate = value as Record<string, JsonValue>;
  if (candidate.serverId !== serverId || typeof candidate.projectId !== "string" || typeof candidate.sessionId !== "string" || !ID_PATTERN.test(candidate.projectId) || !ID_PATTERN.test(candidate.sessionId)) throw new TerminalServiceError("forbidden", "terminal identity is outside this server");
  return { serverId, projectId: candidate.projectId, sessionId: candidate.sessionId };
}

function sameIdentity(left: TerminalIdentity, right: TerminalIdentity): boolean {
  return left.serverId === right.serverId && left.projectId === right.projectId && left.sessionId === right.sessionId;
}

function sessionKey(clientId: string, identity: TerminalIdentity): string { return `${clientId}\u0000${identity.serverId}\u0000${identity.projectId}\u0000${identity.sessionId}`; }

function position(value: JsonValue): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new TerminalServiceError("invalid_position", "terminal position is invalid");
  return value;
}

function positiveDimension(value: JsonValue | undefined, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 1_000) throw new TerminalServiceError("invalid_dimensions", `${name} is invalid`);
  return value;
}

function parseSource(value: JsonValue): TerminalInputSource {
  if (value === "keyboard" || value === "paste" || value === "macro" || value === "dictation" || value === "mcp" || value === "remote") return value;
  throw new TerminalServiceError("invalid_identity", "terminal input source is invalid");
}

function terminalEventPayload(event: TerminalEvent, attachmentId: string, clientId: string): JsonValue {
  if (event.type === "output") return { clientId, attachmentId, type: "output", serverId: event.serverId, projectId: event.projectId, sessionId: event.sessionId, position: event.position, nextPosition: event.nextPosition, replay: event.replay, bytes: encodeBase64(event.bytes) };
  if (event.type === "exit") return { clientId, attachmentId, type: "exit", serverId: event.serverId, projectId: event.projectId, sessionId: event.sessionId, exitCode: event.exitCode, signal: event.signal, reason: event.metadata.reason, at: event.metadata.at };
  return { clientId, attachmentId, type: "resync_required", serverId: event.serverId, projectId: event.projectId, sessionId: event.sessionId, fromPosition: event.fromPosition, replayFrom: event.replayFrom, outputPosition: event.outputPosition };
}

function compactInitialEvents(events: readonly TerminalEvent[]): TerminalEvent[] {
  const compacted: TerminalEvent[] = [];
  for (const event of events) {
    const previous = compacted.at(-1);
    if (event.type !== "output" || previous?.type !== "output" || previous.nextPosition !== event.position) {
      compacted.push(event);
      continue;
    }
    const bytes = new Uint8Array(previous.bytes.byteLength + event.bytes.byteLength);
    bytes.set(previous.bytes);
    bytes.set(event.bytes, previous.bytes.byteLength);
    compacted[compacted.length - 1] = Object.freeze({
      ...previous,
      nextPosition: event.nextPosition,
      bytes,
      data: bytes,
      replay: previous.replay && event.replay,
    });
  }
  return compacted;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: JsonValue | undefined): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_INPUT_BYTES / 3) * 4 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new TerminalServiceError("invalid_bytes", "terminal input is not valid base64");
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INPUT_BYTES) throw new TerminalServiceError("input_too_large", "terminal input exceeds the configured limit");
  return bytes;
}
