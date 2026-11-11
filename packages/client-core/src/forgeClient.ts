import { FEATURE_CAPABILITIES, type JsonValue } from "@terminay/protocol";
import type { ClientEvent, CommandOptions, QueryOptions } from "./types.js";

/** Application-protocol operations for pull requests and issues (ADR-0106). */
export const FORGE_CLIENT_OPERATIONS = Object.freeze({
  sources: "forge.sources",
  accounts: "forge.accounts",
  owners: "forge.owners",
  query: "forge.query",
  detail: "forge.detail",
  claims: "forge.claims",
  counts: "forge.counts",
  settingsGet: "forge.settings.get",
  settingsSet: "forge.settings.set",
  accountsAdd: "forge.accounts.add",
  accountsRemove: "forge.accounts.remove",
} as const);

export const FORGE_CLIENT_CHANGED_EVENT = "forge.changed";

export type ForgeClientItemKind = "pullRequest" | "issue";
export type ForgeClientPullRequestScope = "reviewRequested" | "authored" | "involved" | "all";
export type ForgeClientIssueScope = "assigned" | "authored" | "mentioned" | "all";
export type ForgeClientState = "open" | "closed" | "merged" | "all";

export interface ForgeClientItemReference {
  readonly kind: ForgeClientItemKind;
  readonly origin: string;
  readonly owner: string;
  readonly name: string;
  readonly number: number;
}

export interface ForgeClientListRequest {
  readonly kind: ForgeClientItemKind;
  readonly scope: ForgeClientPullRequestScope | ForgeClientIssueScope;
  readonly state: ForgeClientState;
  readonly purpose: "home" | "project";
  readonly projectId?: string;
  readonly repositories?: ReadonlyArray<{ readonly origin: string; readonly owner: string; readonly name: string }>;
  readonly text?: string;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly fresh?: boolean;
}

export interface ForgeClientWorktreeMatch {
  readonly projectId: string;
  readonly worktreeId: string;
  readonly branch: string;
}

export interface ForgeClientListItem {
  readonly sourceId: string;
  readonly item: JsonValue & { readonly reference: ForgeClientItemReference; readonly title: string; readonly updatedAt: string };
  readonly worktrees: readonly ForgeClientWorktreeMatch[];
}

export interface ForgeClientSourceOutcome {
  readonly sourceId: string;
  readonly origin?: string;
  readonly state: "ok" | "failed" | "skipped";
  readonly error?: string;
}

export interface ForgeClientListResult {
  readonly items: readonly ForgeClientListItem[];
  readonly sources: readonly ForgeClientSourceOutcome[];
  readonly nextCursor?: string;
  readonly fetchedAt?: number;
}

export interface ForgeClientSettings {
  readonly repositories: "all" | "openProjects" | "owners";
  readonly owners: readonly string[];
  readonly pullRequestsOnHome: boolean;
  readonly issuesOnHome: boolean;
  readonly projectTabs: boolean;
}

export interface ForgeClientTransport {
  readonly query: <T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: QueryOptions) => Promise<T>;
  readonly command: <T extends JsonValue = JsonValue>(operation: string, payload?: JsonValue, options?: CommandOptions) => Promise<T>;
  readonly subscribeClientEvents?: <T extends JsonValue = JsonValue>(event: string, listener: (message: ClientEvent<T>) => void, onResync?: () => void) => Promise<() => void>;
}

export interface ForgeClientOptions {
  /** The capabilities the server advertised in its hello. */
  readonly serverCapabilities?: readonly string[];
}

/** Raised when a response was superseded by a newer request on the same key. */
export class ForgeSupersededError extends Error {
  constructor() {
    super("superseded by a newer forge request");
    this.name = "ForgeSupersededError";
  }
}

/**
 * Pull requests and issues from the server's forge sources. Pull-based: the
 * client asks when a view needs data, never on a timer. A view passes a key
 * (its scope), and a response to a request that a later one on the same key
 * replaced is dropped rather than shown.
 */
export class TerminayForgeClient {
  private readonly sequences = new Map<string, number>();

  constructor(
    private readonly transport: ForgeClientTransport,
    private readonly options: ForgeClientOptions = {},
  ) {}

  /** False when the server does not serve forge sources; hide the forge UI. */
  get available(): boolean {
    return this.options.serverCapabilities?.includes(FEATURE_CAPABILITIES.forge) === true;
  }

  sources() {
    return this.transport.query(FORGE_CLIENT_OPERATIONS.sources, {});
  }

  accounts(fresh = false) {
    return this.transport.query(FORGE_CLIENT_OPERATIONS.accounts, fresh ? { fresh: true } : {});
  }

  owners() {
    return this.transport.query(FORGE_CLIENT_OPERATIONS.owners, {});
  }

  claims(projectId: string) {
    return this.transport.query(FORGE_CLIENT_OPERATIONS.claims, { projectId });
  }

  counts() {
    return this.transport.query<{ pullRequests: number | null; issues: number | null }>(FORGE_CLIENT_OPERATIONS.counts, {});
  }

  /** List items; with a `key`, a response overtaken by a newer request on that key rejects with ForgeSupersededError. */
  async list(request: ForgeClientListRequest, key?: string): Promise<ForgeClientListResult> {
    const sequence = key === undefined ? 0 : this.next(key);
    const result = await this.transport.query<JsonValue>(FORGE_CLIENT_OPERATIONS.query, request as unknown as JsonValue);
    if (key !== undefined && this.sequences.get(key) !== sequence) throw new ForgeSupersededError();
    return result as unknown as ForgeClientListResult;
  }

  async detail(sourceId: string, reference: ForgeClientItemReference, options: { fresh?: boolean; key?: string } = {}) {
    const sequence = options.key === undefined ? 0 : this.next(options.key);
    const result = await this.transport.query(FORGE_CLIENT_OPERATIONS.detail, {
      sourceId,
      reference: reference as unknown as JsonValue,
      ...(options.fresh ? { fresh: true } : {}),
    });
    if (options.key !== undefined && this.sequences.get(options.key) !== sequence) throw new ForgeSupersededError();
    return result;
  }

  async settings(): Promise<{ settings: Record<string, ForgeClientSettings> }> {
    return (await this.transport.query(FORGE_CLIENT_OPERATIONS.settingsGet, {})) as unknown as {
      settings: Record<string, ForgeClientSettings>;
    };
  }

  setSettings(extensionId: string, settings: ForgeClientSettings) {
    return this.transport.command(FORGE_CLIENT_OPERATIONS.settingsSet, {
      extensionId,
      settings: settings as unknown as JsonValue,
    });
  }

  addAccount(extensionId: string, origin: string, token: string) {
    return this.transport.command(FORGE_CLIENT_OPERATIONS.accountsAdd, { extensionId, origin, token });
  }

  removeAccount(extensionId: string, origin: string) {
    return this.transport.command(FORGE_CLIENT_OPERATIONS.accountsRemove, { extensionId, origin });
  }

  /** Follow `forge.changed`; the view refreshes what it is showing. */
  async onChanged(listener: () => void): Promise<() => void> {
    if (this.transport.subscribeClientEvents === undefined) return () => {};
    return this.transport.subscribeClientEvents(FORGE_CLIENT_CHANGED_EVENT, () => listener(), listener);
  }

  private next(key: string): number {
    const value = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, value);
    return value;
  }
}
