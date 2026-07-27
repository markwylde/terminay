import type {
  TerminayTerminalClient,
  CommandOptions,
  TerminalClientAttachRequest,
  TerminalClientAttachment,
  TerminalDimensions,
  TerminalStreamEvent,
} from "@terminay/client-core";

/**
 * The temporary Desktop boundary for terminal actions that have not yet been
 * moved into a panel component.  It deliberately accepts the same immutable
 * server/project/session identity as the shared terminal client; renderer and
 * window ownership identifiers are not part of this contract.
 */
export interface DesktopTerminalAuthorityRequest extends TerminalClientAttachRequest {}

export interface DesktopTerminalAuthoritySession {
  readonly attachmentId: string;
  readonly identity: TerminalClientAttachment["identity"];
  readonly initialEvents: readonly TerminalStreamEvent[];
  readonly position: number;
  readonly closed: boolean;
  readonly onEvent: TerminalClientAttachment["onEvent"];
  readonly ack: (position: number, options?: CommandOptions) => Promise<void>;
  readonly write: (data: Uint8Array | string, options?: CommandOptions) => Promise<void>;
  readonly resize: (dimensions: TerminalDimensions, options?: CommandOptions) => Promise<void>;
  readonly kill: (signal?: number | string, options?: CommandOptions) => Promise<void>;
  readonly detach: (options?: CommandOptions) => Promise<void>;
}

/**
 * Compatibility-only adapter used while Desktop callers are migrated away
 * from the legacy preload terminal methods.  All terminal mutations still
 * flow through an attachment owned by `TerminayTerminalClient`.
 */
export class DesktopTerminalAuthorityAdapter {
  constructor(private readonly client: TerminayTerminalClient) {}

  async attach(request: DesktopTerminalAuthorityRequest): Promise<DesktopTerminalAuthoritySession> {
    validateRequest(request);
    return createSession(await this.client.attach(request));
  }

  async resume(request: DesktopTerminalAuthorityRequest): Promise<DesktopTerminalAuthoritySession> {
    validateRequest(request);
    return createSession(await this.client.resume(request));
  }
}

function createSession(attachment: TerminalClientAttachment): DesktopTerminalAuthoritySession {
  return attachment;
}

function validateRequest(value: unknown): asserts value is DesktopTerminalAuthorityRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("terminal authority request is invalid");
  const request = value as Record<string, unknown>;
  // These fields were used by the old Electron PTY map.  Rejecting them at
  // the boundary prevents a renderer/window id from becoming PTY authority
  // while legacy callers are incrementally migrated.
  rejectRendererOwnership(request);
  for (const field of ["serverId", "projectId", "sessionId", "clientId"] as const) {
    const part = request[field];
    if (typeof part !== "string" || part.length === 0 || part.length > 128 || hasControlCharacter(part)) throw new TypeError(`terminal authority ${field} is invalid`);
  }
  const authorization = request.authorization;
  if (authorization === undefined) return;
  if (typeof authorization !== "object" || authorization === null || Array.isArray(authorization)) throw new TypeError("terminal authority authorization is invalid");
  const auth = authorization as Record<string, unknown>;
  rejectRendererOwnership(auth);
  for (const field of ["serverId", "projectId", "sessionId"] as const) {
    if (auth[field] !== request[field]) throw new Error("terminal authority authorization identity mismatch");
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function rejectRendererOwnership(value: Record<string, unknown>): void {
  for (const field of ["webContentsId", "windowId", "rendererId"] as const) {
    if (field in value) throw new TypeError("terminal authority cannot use renderer or window ownership");
  }
}
