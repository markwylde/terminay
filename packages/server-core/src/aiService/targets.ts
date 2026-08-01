import type { ProtocolId } from "@terminay/protocol";
import { AiServiceError, type AiMetadataTarget, type AiTargetAuthority, type TerminalTarget, type TerminalTargetState } from "./types.js";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface MutableTarget extends TerminalTargetState {
  live: boolean;
  metadataRevision: number;
  title: string;
  note: string;
  authorizedClients?: Set<ProtocolId>;
  readonly writeInput?: (input: string) => void | Promise<void>;
}

export interface TargetRegistrationOptions {
  readonly title?: string;
  readonly note?: string;
  readonly metadataRevision?: number;
  readonly live?: boolean;
  readonly authorizedClients?: readonly ProtocolId[];
  readonly writeInput?: (input: string) => void | Promise<void>;
}

/** In-memory exact target authority useful to compose the AI service with the
 * server terminal/workspace stores. Production hosts can instead provide an
 * adapter implementing {@link AiTargetAuthority}. */
export class ExactTerminalTargetRegistry implements AiTargetAuthority {
  private readonly targets = new Map<string, MutableTarget>();
  private readonly serverId: ProtocolId;

  constructor(serverId: ProtocolId) {
    assertId(serverId, "serverId");
    this.serverId = serverId;
  }

  register(target: TerminalTarget, options: TargetRegistrationOptions = {}): TerminalTargetState {
    this.assertTarget(target);
    const key = targetKey(target);
    if (this.targets.has(key)) throw new AiServiceError("invalid_request", "terminal target is already registered");
    if (options.metadataRevision !== undefined && (!Number.isSafeInteger(options.metadataRevision) || options.metadataRevision < 0)) throw new TypeError("metadataRevision is invalid");
    const mutable: MutableTarget = {
      ...target,
      live: options.live ?? true,
      metadataRevision: options.metadataRevision ?? 0,
      title: options.title ?? "Terminal",
      note: options.note ?? "",
      ...(options.authorizedClients === undefined ? {} : { authorizedClients: new Set(options.authorizedClients) }),
      ...(options.writeInput === undefined ? {} : { writeInput: options.writeInput }),
    };
    this.targets.set(key, mutable);
    return snapshot(mutable);
  }

  getTarget(target: TerminalTarget): TerminalTargetState | undefined {
    this.assertTarget(target);
    const value = this.targets.get(targetKey(target));
    return value === undefined ? undefined : snapshot(value);
  }

  authorize(clientId: ProtocolId, target: TerminalTarget): boolean {
    this.assertTarget(target);
    const value = this.targets.get(targetKey(target));
    if (value === undefined || !value.live) return false;
    return value.authorizedClients === undefined || value.authorizedClients.has(clientId);
  }

  setAuthorizedClients(target: TerminalTarget, clients: readonly ProtocolId[] | undefined): void {
    const value = this.require(target);
    value.authorizedClients = clients === undefined ? undefined : new Set(clients);
  }

  updateMetadata(target: TerminalTarget, targetType: AiMetadataTarget, value: string, expectedRevision: number): { readonly revision: number } {
    const current = this.requireLive(target);
    if (current.metadataRevision !== expectedRevision) throw new AiServiceError("revision_conflict", "terminal metadata changed while AI was running.", true);
    if (targetType === "title") current.title = value;
    else current.note = value;
    current.metadataRevision += 1;
    return { revision: current.metadataRevision };
  }

  applyMetadata(target: TerminalTarget, targetType: AiMetadataTarget, value: string, expectedRevision: number): { readonly revision: number } {
    return this.updateMetadata(target, targetType, value, expectedRevision);
  }

  writeInput(target: TerminalTarget, input: string): void | Promise<void> {
    const current = this.requireLive(target);
    if (current.writeInput === undefined) throw new AiServiceError("target_unavailable", "terminal input is unavailable.", true);
    return current.writeInput(input);
  }

  markExited(targetOrSessionId: TerminalTarget | ProtocolId): boolean {
    if (typeof targetOrSessionId === "string") {
      let changed = false;
      for (const value of this.targets.values()) if (value.sessionId === targetOrSessionId && value.live) {
        value.live = false;
        changed = true;
      }
      return changed;
    }
    const value = this.targets.get(targetKey(targetOrSessionId));
    if (value === undefined || !value.live) return false;
    value.live = false;
    return true;
  }

  remove(target: TerminalTarget): boolean {
    this.assertTarget(target);
    return this.targets.delete(targetKey(target));
  }

  private require(target: TerminalTarget): MutableTarget {
    this.assertTarget(target);
    const value = this.targets.get(targetKey(target));
    if (value === undefined) throw new AiServiceError("target_unavailable", "terminal target is unavailable.", true);
    return value;
  }

  private requireLive(target: TerminalTarget): MutableTarget {
    const value = this.require(target);
    if (!value.live) throw new AiServiceError("target_exited", "terminal target has exited.");
    return value;
  }

  private assertTarget(target: TerminalTarget): void {
    assertId(target.serverId, "target.serverId");
    assertId(target.projectId, "target.projectId");
    assertId(target.panelId, "target.panelId");
    assertId(target.sessionId, "target.sessionId");
    if (target.serverId !== this.serverId) throw new AiServiceError("target_unavailable", "terminal belongs to another server.");
  }
}

export function targetKey(target: TerminalTarget): string {
  return `${target.serverId}/${target.projectId}/${target.panelId}/${target.sessionId}`;
}

function snapshot(value: MutableTarget): TerminalTargetState {
  return {
    serverId: value.serverId,
    projectId: value.projectId,
    panelId: value.panelId,
    sessionId: value.sessionId,
    live: value.live,
    metadataRevision: value.metadataRevision,
    title: value.title,
    note: value.note,
  };
}

function assertId(value: string, name: string): void {
  if (typeof value !== "string" || !idPattern.test(value)) throw new TypeError(`${name} is invalid`);
}
