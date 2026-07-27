import {
  ConnectionProfileStore,
  type ConnectionProfile,
  type ConnectionProfileInput,
  type ConnectionProfileSnapshot,
  type ConnectionStatus,
} from "@terminay/client-core";
import {
  createResponsiveWorkspaceNavigation,
  parseHostBridgeMessage,
  type HostBridgeMessage,
  type ResponsiveWorkspaceNavigation,
  type SharedWorkspaceRoute,
} from "@terminay/responsive-ui";

/** Stable manager origin used by the hosted connection shell. */
export const WEB_MANAGER_ORIGIN = "https://web.terminay.com";
export const WEB_PROFILE_STORAGE_KEY = "terminay.web.connection-profiles.v1";

export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WebConnectionHostOptions {
  /** Browser hosts never create an embedded Local server. */
  readonly storage?: WebStorageLike;
  readonly now?: () => number;
  readonly maxProfiles?: number;
  readonly managerOrigin?: string;
  readonly openWindow?: (url: string, target: "_self" | "_blank") => void;
}

export interface WebConnectionHostSnapshot {
  readonly mode: "disconnected" | "connected";
  readonly managerOrigin: string;
  readonly profiles: ConnectionProfileSnapshot;
  readonly current?: ConnectionProfile;
}

export interface WebOpenOptions {
  readonly route?: SharedWorkspaceRoute;
  readonly projectId?: string;
  readonly viewId?: string;
  readonly panelId?: string;
  readonly newTab?: boolean;
}

export interface WebOpenResult {
  readonly profile: ConnectionProfile;
  readonly navigation: ResponsiveWorkspaceNavigation;
  readonly url: string;
  readonly target: "_self" | "_blank";
}

/**
 * Browser connection manager. Only the profile metadata listed by the
 * ConnectionProfileStore is persisted; credentials and origin-local keys stay
 * on the selected server origin and never enter this manager's storage.
 */
export class WebConnectionHost {
  readonly profiles: ConnectionProfileStore;
  readonly managerOrigin: string;
  private readonly storage: WebStorageLike | undefined;
  private readonly openWindow: ((url: string, target: "_self" | "_blank") => void) | undefined;

  constructor(options: WebConnectionHostOptions = {}) {
    this.managerOrigin = requireManagerOrigin(options.managerOrigin ?? WEB_MANAGER_ORIGIN);
    this.storage = options.storage ?? browserStorage();
    this.openWindow = options.openWindow;
    this.profiles = new ConnectionProfileStore({
      local: false,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.maxProfiles === undefined ? {} : { maxProfiles: options.maxProfiles }),
    });
    this.restore();
  }

  snapshot(): WebConnectionHostSnapshot {
    const profiles = this.profiles.snapshot();
    const current = this.profiles.currentProfile;
    return Object.freeze({ mode: current === undefined ? "disconnected" : connectionIsUsable(current) ? "connected" : "disconnected", managerOrigin: this.managerOrigin, profiles, ...(current === undefined ? {} : { current }) });
  }

  /** Add an explicitly sanitized profile, then persist only metadata. */
  addConnection(input: ConnectionProfileInput): ConnectionProfile {
    requireSessionOrigin(input.origin);
    const profile = this.profiles.remember({ ...input, isLocal: false });
    this.persist();
    return profile;
  }

  /** Import metadata from a picker or deep-link handler without accepting
   * pairing fragments, credentials, terminal fields, or project paths. */
  importConnection(value: unknown): ConnectionProfile {
    if (!isRecord(value) || typeof value.origin !== "string") throw new TypeError("connection profile origin is required");
    requireSessionOrigin(value.origin);
    const profile = this.profiles.import(value);
    if (profile.isLocal === true) throw new TypeError("web host cannot import a Local profile");
    this.persist();
    return profile;
  }

  /**
   * Consume a one-time pairing URL in memory. The fragment is deliberately
   * never returned, persisted, logged, or included in the resulting session
   * URL; a caller performs the protocol pairing against the exact origin.
   */
  consumePairingUrl(rawUrl: string, metadata: Omit<ConnectionProfileInput, "origin">): ConnectionProfile {
    const parsed = parseSessionOrigin(rawUrl);
    if (parsed.hash.length === 0) throw new TypeError("pairing URL has no one-time fragment");
    const profile = this.addConnection({ ...metadata, origin: parsed.origin });
    parsed.hash = "";
    return profile;
  }

  open(profileId: string, options: WebOpenOptions = {}): WebOpenResult {
    const existing = this.profiles.get(profileId);
    if (existing?.archived === true) throw new Error("archived connection profile cannot be opened");
    const profile = this.profiles.select(profileId);
    if (profile.isLocal === true) throw new Error("web host cannot open a Local profile");
    const navigation = createResponsiveWorkspaceNavigation({
      ...(options.route === undefined ? {} : { route: options.route }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.viewId === undefined ? {} : { viewId: options.viewId }),
      ...(options.panelId === undefined ? {} : { panelId: options.panelId }),
    });
    const url = sessionUrl(profile.origin, navigation);
    const target = options.newTab === true ? "_blank" : "_self";
    this.openWindow?.(url, target);
    this.persist();
    return Object.freeze({ profile, navigation, url, target });
  }

  /** Open the manager itself from a direct server session without sharing a
   * secret or a session-origin credential. */
  openManager(newTab = false): string {
    const target = newTab ? "_blank" : "_self";
    this.openWindow?.(this.managerOrigin, target);
    return this.managerOrigin;
  }

  retry(profileId: string): ConnectionProfile { const profile = this.profiles.markStatus(profileId, "connecting"); this.persist(); return profile; }
  markStatus(profileId: string, status: ConnectionStatus): ConnectionProfile { const profile = this.profiles.markStatus(profileId, status); this.persist(); return profile; }
  disconnect(profileId: string): ConnectionProfile { const profile = this.profiles.disconnect(profileId); this.persist(); return profile; }
  archive(profileId: string, confirmed = false): ConnectionProfile {
    const prior = this.profiles.get(profileId);
    if (prior === undefined) throw new Error(`unknown connection profile: ${profileId}`);
    if (prior.isLocal === true) throw new Error("the Local profile cannot be archived");
    if (!confirmed) throw new Error("archive requires confirmation");
    const profile = this.profiles.remember({ ...prior, archived: true, status: "offline" });
    this.persist();
    return profile;
  }
  unarchive(profileId: string): ConnectionProfile {
    const prior = this.profiles.get(profileId);
    if (prior === undefined) throw new Error(`unknown connection profile: ${profileId}`);
    const profile = this.profiles.remember({ ...prior, archived: false, status: "offline" });
    this.persist();
    return profile;
  }
  forget(profileId: string, confirmed = false): boolean { const forgotten = this.profiles.forget(profileId, confirmed); this.persist(); return forgotten; }
  revoke(profileId: string, confirmed = false): ConnectionProfile { const profile = this.profiles.revoke(profileId, confirmed); this.persist(); return profile; }

  private restore(): void {
    const encoded = this.storage?.getItem(WEB_PROFILE_STORAGE_KEY);
    if (encoded === null || encoded === undefined) return;
    try {
      const parsed: unknown = JSON.parse(encoded);
      if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.profiles)) return;
      for (const candidate of parsed.profiles) {
        try {
          if (isRecord(candidate) && typeof candidate.origin === "string") {
            requireSessionOrigin(candidate.origin);
            this.profiles.import(candidate);
          }
        } catch {
          // Ignore one malformed profile without preventing healthy entries
          // from being recovered from the host-local store.
        }
      }
      if (typeof parsed.currentProfileId === "string" && this.profiles.get(parsed.currentProfileId) !== undefined) this.profiles.select(parsed.currentProfileId);
    } catch {
      // A corrupt manager record is equivalent to an empty disconnected host.
    }
  }

  private persist(): void {
    if (this.storage === undefined) return;
    const snapshot = this.profiles.snapshot();
    this.storage.setItem(WEB_PROFILE_STORAGE_KEY, JSON.stringify({ version: 1, currentProfileId: snapshot.currentProfileId, profiles: snapshot.profiles }));
  }
}

export interface WebMessageEventLike {
  readonly origin: string;
  readonly source: unknown;
  readonly data: unknown;
}

export interface WebMessageTargetLike {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface WebHostBridgeOptions {
  readonly managerOrigin?: string;
  readonly workspaceOrigin: string;
  readonly workspaceSource: unknown;
}

/** Strict source/origin checked browser host bridge. */
export class WebHostBridge {
  readonly managerOrigin: string;
  readonly workspaceOrigin: string;
  private readonly workspaceSource: unknown;

  constructor(options: WebHostBridgeOptions) {
    this.managerOrigin = requireManagerOrigin(options.managerOrigin ?? WEB_MANAGER_ORIGIN);
    this.workspaceOrigin = requireSessionOrigin(options.workspaceOrigin);
    this.workspaceSource = options.workspaceSource;
  }

  receive(event: WebMessageEventLike): HostBridgeMessage | undefined {
    if (event.origin !== this.workspaceOrigin || event.source !== this.workspaceSource) return undefined;
    return parseHostBridgeMessage(event.data);
  }

  send(target: WebMessageTargetLike, message: HostBridgeMessage): void {
    if (target !== this.workspaceSource) throw new Error("host bridge target window mismatch");
    if (parseHostBridgeMessage(message) === undefined) throw new TypeError("host bridge message is invalid");
    target.postMessage(message, this.workspaceOrigin);
  }
}

export function sessionUrl(origin: string, navigation: ResponsiveWorkspaceNavigation): string {
  const url = new URL("/", requireSessionOrigin(origin));
  url.searchParams.set("route", navigation.route);
  if (navigation.projectId !== undefined) url.searchParams.set("project", navigation.projectId);
  if (navigation.viewId !== undefined) url.searchParams.set("view", navigation.viewId);
  if (navigation.panelId !== undefined) url.searchParams.set("panel", navigation.panelId);
  url.hash = "";
  return url.toString();
}

function connectionIsUsable(profile: ConnectionProfile): boolean {
  return profile.archived !== true && profile.status === "connected";
}

function parseSessionOrigin(rawUrl: string): URL {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new TypeError("pairing URL is invalid"); }
  if (parsed.protocol !== "https:") throw new TypeError("pairing URL must use HTTPS");
  if (parsed.username || parsed.password || parsed.search) throw new TypeError("pairing URL contains credentials or query data");
  return parsed;
}

function requireManagerOrigin(value: string): string {
  const parsed = parseOrigin(value, "manager origin");
  if (parsed.protocol !== "https:") throw new TypeError("manager origin must use HTTPS");
  return parsed.origin;
}

function requireSessionOrigin(value: string): string {
  const parsed = parseOrigin(value, "session origin");
  if (parsed.protocol !== "https:") throw new TypeError("session origin must use HTTPS");
  return parsed.origin;
}

function parseOrigin(value: string, name: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TypeError(`${name} is invalid`); }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new TypeError(`${name} must be an exact origin`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function browserStorage(): WebStorageLike | undefined {
  try {
    const candidate = (globalThis as { readonly localStorage?: unknown }).localStorage;
    if (!isRecord(candidate) || typeof candidate.getItem !== "function" || typeof candidate.setItem !== "function" || typeof candidate.removeItem !== "function") return undefined;
    return candidate as unknown as WebStorageLike;
  } catch {
    // Storage can be unavailable in private/sandboxed browsing contexts.
    return undefined;
  }
}
