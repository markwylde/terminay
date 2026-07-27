import type { ConnectionMenuAction, ConnectionProfile, ConnectionSnapshot, ConnectionStatus, HostActions, HostCapabilityProvider, TerminayClient, TerminayHost } from "@terminay/client-core";
import { ConnectionProfileStore, createHostCapabilityProvider } from "@terminay/client-core";
import type { JsonValue } from "@terminay/protocol";

export interface ResponsiveUiContext {
  readonly client: TerminayClient;
  readonly host: TerminayHost;
  readonly connection: ConnectionSnapshot;
}

export interface ResponsiveUiProviderOptions {
  readonly client: TerminayClient;
  readonly capabilities?: HostCapabilityProvider;
  readonly actions?: HostActions;
}

/** Browser-safe dependency injection boundary for the one shared workspace UI.
 * It deliberately exposes no DOM, Electron, Node, or transport implementation. */
export function createResponsiveUiProvider(options: ResponsiveUiProviderOptions): ResponsiveUiContext {
  const capabilities = options.capabilities ?? createHostCapabilityProvider();
  return Object.freeze({ client: options.client, host: Object.freeze({ capabilities, ...(options.actions === undefined ? {} : { actions: options.actions }) }), connection: options.client.snapshot });
}

export type ResponsiveLayout = "wide" | "medium" | "narrow";
export interface ResponsiveUiState {
  readonly layout: ResponsiveLayout;
  readonly projectId?: string;
  readonly viewId?: string;
  readonly activePanelId?: string;
  readonly terminalInput?: string;
}

export function classifyResponsiveLayout(width: number): ResponsiveLayout {
  if (!Number.isFinite(width) || width < 0) throw new RangeError("width must be a finite non-negative number");
  return width >= 1100 ? "wide" : width >= 720 ? "medium" : "narrow";
}

export function isJsonPayload(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonPayload);
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).every(isJsonPayload);
  return false;
}

export type SharedWorkspaceRoute =
  | "workspace"
  | "connections"
  | "settings"
  | "recordings"
  | "macros"
  | "file"
  | "git";

export interface ResponsiveWorkspaceNavigation {
  readonly route: SharedWorkspaceRoute;
  readonly projectId?: string;
  readonly viewId?: string;
  readonly panelId?: string;
}

export interface HostBridgeMessage {
  readonly type: "host.profile" | "host.navigate" | "workspace.ready" | "workspace.status";
  readonly payload: JsonValue;
}

const HOST_MESSAGE_TYPES: ReadonlySet<string> = new Set(["host.profile", "host.navigate", "workspace.ready", "workspace.status"]);
const FORBIDDEN_HOST_KEYS = /(?:terminal|workspace|projectRoot|filename|path|token|secret|grant|privateKey|pin|credential|output|command)/iu;

/** Validate the narrow cross-origin shell contract. A server bundle can send
 * readiness/status and a host can request logical navigation, but neither
 * side can pass terminal data or credentials through this bridge. */
export function parseHostBridgeMessage(value: unknown): HostBridgeMessage | undefined {
  if (!isJsonPayload(value) || typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, JsonValue>;
  if (typeof candidate.type !== "string" || !HOST_MESSAGE_TYPES.has(candidate.type) || candidate.payload === undefined) return undefined;
  if (containsForbiddenKey(candidate.payload)) return undefined;
  return { type: candidate.type as HostBridgeMessage["type"], payload: candidate.payload };
}

export function createResponsiveWorkspaceNavigation(input: Partial<ResponsiveWorkspaceNavigation> = {}): ResponsiveWorkspaceNavigation {
  const route = input.route ?? "workspace";
  if (!["workspace", "connections", "settings", "recordings", "macros", "file", "git"].includes(route)) throw new TypeError("workspace route is invalid");
  for (const [name, value] of Object.entries(input)) if (name !== "route" && value !== undefined && (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value))) throw new TypeError(`navigation ${name} is invalid`);
  return Object.freeze({ route, ...(input.projectId === undefined ? {} : { projectId: input.projectId }), ...(input.viewId === undefined ? {} : { viewId: input.viewId }), ...(input.panelId === undefined ? {} : { panelId: input.panelId }) });
}

export interface SharedWorkspaceRouteEntry {
  readonly route: SharedWorkspaceRoute;
  readonly label: string;
  readonly presentation: "in-page" | "native-auxiliary";
}

/** Shared route registry used by both hosts. Desktop may opt into an
 * auxiliary window for eligible surfaces; web always keeps the same route
 * in-page and therefore needs no popup or native capability. */
export function createSharedWorkspaceRouteEntries(capabilities: HostCapabilityProvider = createHostCapabilityProvider()): readonly SharedWorkspaceRouteEntry[] {
  const nativeAuxiliary = capabilities.has("nativeWindows");
  const entries: readonly SharedWorkspaceRouteEntry[] = [
    { route: "workspace", label: "Workspace", presentation: "in-page" },
    { route: "connections", label: "Connections", presentation: "in-page" },
    { route: "settings", label: "Settings", presentation: nativeAuxiliary ? "native-auxiliary" : "in-page" },
    { route: "recordings", label: "Recordings", presentation: nativeAuxiliary ? "native-auxiliary" : "in-page" },
    { route: "macros", label: "Macros", presentation: nativeAuxiliary ? "native-auxiliary" : "in-page" },
    { route: "file", label: "File", presentation: nativeAuxiliary ? "native-auxiliary" : "in-page" },
    { route: "git", label: "Git", presentation: nativeAuxiliary ? "native-auxiliary" : "in-page" },
  ];
  return Object.freeze(entries.map((entry) => Object.freeze(entry)));
}

/** A browser-safe menu projection. It contains only display metadata and
 * capability-gated actions; host implementations perform the actions. */
export interface ConnectionMenuItem {
  readonly role: "menuitemradio";
  readonly profileId: string;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly isCurrent: boolean;
  readonly isLocal: boolean;
  readonly position: number;
  readonly setSize: number;
  readonly ariaChecked: boolean;
  readonly ariaPosInSet: number;
  readonly ariaSetSize: number;
  readonly ariaLabel: string;
  readonly actions: readonly ConnectionMenuAction[];
}

export interface ConnectionMenuModel {
  readonly role: "menu";
  readonly currentLabel?: string;
  readonly currentStatus?: ConnectionStatus;
  readonly items: readonly ConnectionMenuItem[];
}

export interface ConnectionMenuModelOptions {
  readonly capabilities?: HostCapabilityProvider;
  readonly canRevoke?: boolean;
}

/** Build one deterministic menu model for Desktop and web. Local is sorted
 * first, then labels/ids; no host transport or DOM assumptions are involved. */
export function createConnectionMenuModel(store: ConnectionProfileStore, options: ConnectionMenuModelOptions = {}): ConnectionMenuModel {
  const current = store.currentProfile;
  const profiles = [...store.snapshot().profiles].sort(compareProfiles);
  const items = profiles.map((profile, index) => {
    const actions = store.availableActions(profile.id, {
      canExpose: options.capabilities?.has("serverExposure") === true,
      canRevoke: options.canRevoke === true,
    }).filter((action) => profile.archived !== true || action === "manage" || action === "forget");
    return Object.freeze({
      role: "menuitemradio" as const,
      profileId: profile.id,
      label: profile.label,
      status: profile.status,
      isCurrent: profile.id === current?.id,
      isLocal: profile.isLocal === true,
      position: index + 1,
      setSize: profiles.length,
      ariaChecked: profile.id === current?.id,
      ariaPosInSet: index + 1,
      ariaSetSize: profiles.length,
      ariaLabel: `${profile.label} — ${formatConnectionStatus(profile.status)}${profile.isLocal === true ? " (Local)" : ""}`,
      actions: Object.freeze(actions),
    });
  });
  return Object.freeze({
    role: "menu" as const,
    ...(current === undefined ? {} : { currentLabel: current.label, currentStatus: current.status }),
    items: Object.freeze(items),
  });
}

export interface ConnectionMenuFocusState {
  readonly expanded: boolean;
  readonly activeIndex: number;
}

export type ConnectionMenuKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "Enter" | " " | "Escape";

export interface ConnectionMenuKeyboardResult {
  readonly state: ConnectionMenuFocusState;
  readonly intent: "none" | "expand" | "collapse" | "move" | "activate";
}

/** Keyboard/touch-menu state machine. `activeIndex` is always bounded (or -1
 * for an empty menu), making it safe to bind to aria-activedescendant. */
export function createConnectionMenuFocusState(itemCount: number, initialIndex = 0): ConnectionMenuFocusState {
  assertItemCount(itemCount);
  if (itemCount === 0) return Object.freeze({ expanded: false, activeIndex: -1 });
  if (!Number.isSafeInteger(initialIndex) || initialIndex < 0 || initialIndex >= itemCount) throw new RangeError("initial menu index is out of range");
  return Object.freeze({ expanded: false, activeIndex: initialIndex });
}

export function reduceConnectionMenuKey(state: ConnectionMenuFocusState, key: ConnectionMenuKey, itemCount: number): ConnectionMenuKeyboardResult {
  assertItemCount(itemCount);
  if (itemCount === 0) return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: -1 }), intent: "none" as const });
  const active = Math.min(Math.max(state.activeIndex, 0), itemCount - 1);
  if (key === "Escape") return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: active }), intent: state.expanded ? "collapse" as const : "none" as const });
  if (key === "Enter" || key === " ") {
    if (!state.expanded) return Object.freeze({ state: Object.freeze({ expanded: true, activeIndex: active }), intent: "expand" as const });
    return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: active }), intent: "activate" as const });
  }
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    const next = key === "Home" ? 0 : key === "End" ? itemCount - 1 : key === "ArrowDown" ? (active + 1) % itemCount : (active - 1 + itemCount) % itemCount;
    return Object.freeze({ state: Object.freeze({ expanded: true, activeIndex: next }), intent: "move" as const });
  }
  return Object.freeze({ state: Object.freeze({ expanded: state.expanded, activeIndex: active }), intent: "none" as const });
}

function compareProfiles(left: ConnectionProfile, right: ConnectionProfile): number {
  if (left.isLocal !== right.isLocal) return left.isLocal === true ? -1 : 1;
  const leftLabel = left.label.toLowerCase();
  const rightLabel = right.label.toLowerCase();
  if (leftLabel < rightLabel) return -1;
  if (leftLabel > rightLabel) return 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function formatConnectionStatus(status: ConnectionStatus): string {
  return status.replaceAll("-", " ");
}

function assertItemCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("menu item count must be a non-negative safe integer");
}

function containsForbiddenKey(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_HOST_KEYS.test(key) || containsForbiddenKey(child));
}
