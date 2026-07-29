import type { ConnectionMenuAction, ConnectionProfile, ConnectionProfileSnapshot, ConnectionSnapshot, ConnectionStatus, HostActions, HostCapabilityProvider, TerminayClient, TerminayHost } from "@terminay/client-core";
import { ConnectionProfileStore, createHostCapabilityProvider } from "@terminay/client-core";
import type { JsonValue } from "@terminay/protocol";
import { createAccessibilityPreferenceModel, type AccessibilityPreferenceInput, type AccessibilityPreferenceModel } from "./accessibility.js";

export * from "./accessibility.js";

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

/** The host-neutral render model for the shared workspace shell. React hosts
 * can turn this into DOM, native auxiliary windows, or a touch layout without
 * reimplementing route, connection, or capability policy. */
export interface ResponsiveWorkspaceShellModel {
  readonly role: "application";
  readonly layout: ResponsiveLayout;
  readonly navigation: ResponsiveWorkspaceNavigation;
  readonly route: SharedWorkspaceRouteEntry;
  readonly routeComponent: SharedWorkspaceRouteRenderModel;
  readonly routes: readonly SharedWorkspaceRouteEntry[];
  readonly connection: ConnectionSnapshot;
  readonly connectionProfiles: ConnectionProfileSnapshot;
  readonly connectionMenu: ConnectionMenuModel;
  readonly capabilities: HostCapabilityProvider;
  /** Host-resolved preferences rendered by the shared shell; never read from
   * browser globals so Desktop and web retain one accessibility contract. */
  readonly accessibility: AccessibilityPreferenceModel;
}

export interface ResponsiveWorkspaceShellOptions {
  readonly connectionProfiles: ConnectionProfileStore;
  readonly navigation?: Partial<ResponsiveWorkspaceNavigation>;
  readonly viewportWidth?: number;
  readonly canRevoke?: boolean;
  readonly accessibility?: AccessibilityPreferenceInput;
}

/** Compose the shared UI inputs into one immutable render contract. It is
 * deliberately a projection: commands still go through `TerminayClient`
 * and host actions, while the model contains no transport or DOM objects. */
export function createResponsiveWorkspaceShellModel(
  context: ResponsiveUiContext,
  options: ResponsiveWorkspaceShellOptions,
): ResponsiveWorkspaceShellModel {
  const layout = classifyResponsiveLayout(options.viewportWidth ?? 1200);
  const navigation = createResponsiveWorkspaceNavigation(options.navigation);
  const routes = createSharedWorkspaceRouteEntries(context.host.capabilities);
  const route = routes.find((entry) => entry.route === navigation.route);
  if (route === undefined) throw new Error(`shared route is not registered: ${navigation.route}`);
  const routeComponent = createSharedWorkspaceRouteRenderModel(navigation.route, context.host.capabilities);
  return Object.freeze({
    role: "application" as const,
    layout,
    navigation,
    route,
    routeComponent,
    routes,
    connection: context.connection,
    connectionProfiles: options.connectionProfiles.snapshot(),
    connectionMenu: createConnectionMenuModel(options.connectionProfiles, {
      capabilities: context.host.capabilities,
      ...(options.canRevoke === undefined ? {} : { canRevoke: options.canRevoke }),
    }),
    capabilities: context.host.capabilities,
    accessibility: createAccessibilityPreferenceModel(options.accessibility),
  });
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

/** WCAG-sized controls are a shared contract, not a CSS convention owned by
 * one host. Hosts may make a target larger, but never smaller. */
export const RESPONSIVE_MIN_TOUCH_TARGET_PX = 44 as const;

export interface ResponsiveTouchTarget {
  readonly minWidth: typeof RESPONSIVE_MIN_TOUCH_TARGET_PX;
  readonly minHeight: typeof RESPONSIVE_MIN_TOUCH_TARGET_PX;
  readonly hitSlop: "none" | "host-defined";
}

const LARGE_TOUCH_TARGET: ResponsiveTouchTarget = Object.freeze({
  minWidth: RESPONSIVE_MIN_TOUCH_TARGET_PX,
  minHeight: RESPONSIVE_MIN_TOUCH_TARGET_PX,
  hitSlop: "host-defined",
});

export type TerminalAccessoryControlId =
  | "escape"
  | "tab"
  | "ctrl"
  | "alt"
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "home"
  | "end"
  | "page-up"
  | "page-down"
  | "enter"
  | "backspace";

export interface TerminalAccessoryControl {
  readonly id: TerminalAccessoryControlId;
  readonly label: string;
  readonly ariaLabel: string;
  readonly kind: "key" | "modifier";
  /** Exact xterm-compatible input for a key control. Modifiers are stateful
   * and intentionally do not expose arbitrary command text. */
  readonly input?: string;
  readonly modifier?: "ctrl" | "alt";
  readonly touchTarget: ResponsiveTouchTarget;
}

export interface TerminalAccessoryModel {
  readonly role: "toolbar";
  readonly ariaLabel: "Terminal accessory keys";
  readonly layout: ResponsiveLayout;
  readonly controls: readonly TerminalAccessoryControl[];
  readonly preservesDesktopKeyboardInput: true;
  readonly touchTarget: ResponsiveTouchTarget;
}

export interface TerminalAccessoryOptions {
  readonly layout?: ResponsiveLayout;
  readonly includePaging?: boolean;
}

const TERMINAL_ACCESSORY_DEFINITIONS: Readonly<Record<TerminalAccessoryControlId, Omit<TerminalAccessoryControl, "touchTarget">>> = Object.freeze({
  escape: { id: "escape", label: "Esc", ariaLabel: "Escape", kind: "key", input: "\u001b" },
  tab: { id: "tab", label: "Tab", ariaLabel: "Tab", kind: "key", input: "\t" },
  ctrl: { id: "ctrl", label: "Ctrl", ariaLabel: "Control modifier", kind: "modifier", modifier: "ctrl" },
  alt: { id: "alt", label: "Alt", ariaLabel: "Alt modifier", kind: "modifier", modifier: "alt" },
  "arrow-up": { id: "arrow-up", label: "↑", ariaLabel: "Arrow up", kind: "key", input: "\u001b[A" },
  "arrow-down": { id: "arrow-down", label: "↓", ariaLabel: "Arrow down", kind: "key", input: "\u001b[B" },
  "arrow-left": { id: "arrow-left", label: "←", ariaLabel: "Arrow left", kind: "key", input: "\u001b[D" },
  "arrow-right": { id: "arrow-right", label: "→", ariaLabel: "Arrow right", kind: "key", input: "\u001b[C" },
  home: { id: "home", label: "Home", ariaLabel: "Home", kind: "key", input: "\u001b[H" },
  end: { id: "end", label: "End", ariaLabel: "End", kind: "key", input: "\u001b[F" },
  "page-up": { id: "page-up", label: "PgUp", ariaLabel: "Page up", kind: "key", input: "\u001b[5~" },
  "page-down": { id: "page-down", label: "PgDn", ariaLabel: "Page down", kind: "key", input: "\u001b[6~" },
  enter: { id: "enter", label: "Enter", ariaLabel: "Enter", kind: "key", input: "\r" },
  backspace: { id: "backspace", label: "⌫", ariaLabel: "Backspace", kind: "key", input: "\u007f" },
});

/** Describe the optional narrow-layout key strip. The host still owns focus,
 * panel attachment, and input delivery; the model only permits known keys. */
export function createTerminalAccessoryModel(options: TerminalAccessoryOptions = {}): TerminalAccessoryModel {
  const layout = options.layout ?? "narrow";
  const paging = options.includePaging !== false;
  const ids: readonly TerminalAccessoryControlId[] = paging
    ? ["escape", "tab", "ctrl", "alt", "arrow-up", "arrow-down", "arrow-left", "arrow-right", "home", "end", "page-up", "page-down", "enter", "backspace"]
    : ["escape", "tab", "ctrl", "alt", "arrow-up", "arrow-down", "arrow-left", "arrow-right", "enter", "backspace"];
  const controls = ids.map((id) => Object.freeze({ ...TERMINAL_ACCESSORY_DEFINITIONS[id], touchTarget: LARGE_TOUCH_TARGET }));
  return Object.freeze({
    role: "toolbar" as const,
    ariaLabel: "Terminal accessory keys" as const,
    layout,
    controls: Object.freeze(controls),
    preservesDesktopKeyboardInput: true as const,
    touchTarget: LARGE_TOUCH_TARGET,
  });
}

export interface TerminalAccessoryState {
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export type TerminalAccessoryAction =
  | { readonly type: "toggle-modifier"; readonly modifier: "ctrl" | "alt" }
  | { readonly type: "press"; readonly control: TerminalAccessoryControlId }
  | { readonly type: "clear-modifiers" };

export interface TerminalAccessoryActionResult {
  readonly state: TerminalAccessoryState;
  readonly input?: string;
  /** Modifiers held when the key was pressed, before the one-shot state is
   * cleared. The host applies these through its terminal input adapter. */
  readonly appliedModifiers: readonly ("ctrl" | "alt")[];
}

/** Reduce touch-key actions without accepting arbitrary shell text. Modifier
 * state is returned to the host so it can apply the same terminal semantics
 * as a physical keyboard; key input is always drawn from the allowlist. */
export function reduceTerminalAccessoryAction(state: TerminalAccessoryState, action: TerminalAccessoryAction): TerminalAccessoryActionResult {
  const current = { ctrl: state.ctrl === true, alt: state.alt === true };
  if (action.type === "toggle-modifier") {
    current[action.modifier] = !current[action.modifier];
    return Object.freeze({ state: Object.freeze(current), appliedModifiers: Object.freeze([]) });
  }
  if (action.type === "clear-modifiers") return Object.freeze({ state: Object.freeze({ ctrl: false, alt: false }), appliedModifiers: Object.freeze([]) });
  const control = TERMINAL_ACCESSORY_DEFINITIONS[action.control];
  if (control.kind === "modifier") return Object.freeze({ state: Object.freeze(current), appliedModifiers: Object.freeze([]) });
  const appliedModifiers = Object.freeze(([
    ...(current.ctrl ? ["ctrl" as const] : []),
    ...(current.alt ? ["alt" as const] : []),
  ]));
  return Object.freeze({ state: Object.freeze({ ctrl: false, alt: false }), appliedModifiers, ...(control.input === undefined ? {} : { input: control.input }) });
}

export interface ResponsiveViewportInput {
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly visualWidth?: number;
  readonly visualHeight?: number;
  readonly offsetTop?: number;
  readonly offsetLeft?: number;
  readonly chromeHeight?: number;
  readonly accessoryHeight?: number;
}

export interface ResponsiveViewportModel {
  readonly layout: ResponsiveLayout;
  readonly layoutWidth: number;
  readonly layoutHeight: number;
  readonly visualWidth: number;
  readonly visualHeight: number;
  readonly offsetTop: number;
  readonly offsetLeft: number;
  readonly contentWidth: number;
  readonly shellHeight: number;
  readonly terminalHeight: number;
  readonly keyboardVisible: boolean;
  readonly keyboardInset: number;
  readonly horizontalOverflow: false;
  readonly keepsFocusedTerminalVisible: true;
  readonly restoredShellHeight: number;
}

/** Project `window.visualViewport` measurements into a bounded layout model.
 * A host can apply shellHeight/terminalHeight as CSS dimensions and restore
 * the old geometry when the software keyboard disappears. */
export function createResponsiveViewportModel(input: ResponsiveViewportInput): ResponsiveViewportModel {
  const layoutWidth = finiteNonNegative(input.layoutWidth, "layoutWidth");
  const layoutHeight = finiteNonNegative(input.layoutHeight, "layoutHeight");
  const visualWidth = finiteNonNegative(input.visualWidth ?? layoutWidth, "visualWidth");
  const visualHeight = finiteNonNegative(input.visualHeight ?? layoutHeight, "visualHeight");
  const offsetTop = finiteNonNegative(input.offsetTop ?? 0, "offsetTop");
  const offsetLeft = finiteNonNegative(input.offsetLeft ?? 0, "offsetLeft");
  const chromeHeight = finiteNonNegative(input.chromeHeight ?? 0, "chromeHeight");
  const accessoryHeight = finiteNonNegative(input.accessoryHeight ?? 0, "accessoryHeight");
  const shellHeight = Math.max(0, visualHeight);
  const keyboardInset = Math.max(0, layoutHeight - (offsetTop + visualHeight));
  const keyboardVisible = keyboardInset >= 80;
  const usableTerminalHeight = Math.max(0, shellHeight - chromeHeight - accessoryHeight);
  return Object.freeze({
    layout: classifyResponsiveLayout(Math.min(layoutWidth, visualWidth)),
    layoutWidth,
    layoutHeight,
    visualWidth,
    visualHeight,
    offsetTop,
    offsetLeft,
    contentWidth: Math.min(layoutWidth, visualWidth),
    shellHeight,
    terminalHeight: usableTerminalHeight,
    keyboardVisible,
    keyboardInset,
    horizontalOverflow: false as const,
    keepsFocusedTerminalVisible: true as const,
    restoredShellHeight: layoutHeight,
  });
}

export interface AccessibleDrawerModel {
  readonly role: "dialog";
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly ariaModal: true;
  readonly ariaLabelledBy: string;
  readonly ariaControls: string;
  readonly closeOnEscape: true;
  readonly focus: {
    readonly initialFocusId: string;
    readonly restoreFocusId: string;
  };
  readonly reducedMotion: boolean;
  readonly touchTarget: ResponsiveTouchTarget;
}

export interface AccessibleDrawerOptions {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly restoreFocusId: string;
  readonly initialFocusId?: string;
  readonly reducedMotion?: boolean;
}

/** Provide the focus/ARIA contract for a narrow navigation or panel drawer.
 * The host decides how to animate it; reducedMotion is an explicit policy
 * input rather than a reason to remove keyboard or touch access. */
export function createAccessibleDrawerModel(options: AccessibleDrawerOptions): AccessibleDrawerModel {
  const id = validDomId(options.id, "drawer id");
  const label = nonEmpty(options.label, "drawer label");
  const restoreFocusId = validDomId(options.restoreFocusId, "drawer restore focus id");
  const initialFocusId = validDomId(options.initialFocusId ?? `${id}-close`, "drawer initial focus id");
  return Object.freeze({
    role: "dialog" as const,
    id,
    label,
    open: options.open === true,
    ariaModal: true as const,
    ariaLabelledBy: `${id}-label`,
    ariaControls: `${id}-panel`,
    closeOnEscape: true as const,
    focus: Object.freeze({ initialFocusId, restoreFocusId }),
    reducedMotion: options.reducedMotion === true,
    touchTarget: LARGE_TOUCH_TARGET,
  });
}

export interface AccessibleSelectorOption {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly ariaPosInSet: number;
  readonly ariaSetSize: number;
}

export interface AccessibleSelectorModel {
  readonly role: "combobox";
  readonly id: string;
  readonly label: string;
  readonly expanded: boolean;
  readonly ariaExpanded: boolean;
  readonly ariaControls: string;
  readonly ariaHasPopup: "listbox";
  readonly ariaActiveDescendant?: string;
  readonly selectedId?: string;
  readonly options: readonly AccessibleSelectorOption[];
  readonly touchTarget: ResponsiveTouchTarget;
}

export interface AccessibleSelectorOptions {
  readonly id: string;
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly disabled?: boolean }[];
  readonly selectedId?: string;
  readonly expanded?: boolean;
  readonly activeId?: string;
}

/** Build an accessible narrow-layout selector (for projects, views, or
 * panels) with stable option positions and no pixel/layout assumptions. */
export function createAccessibleSelectorModel(input: AccessibleSelectorOptions): AccessibleSelectorModel {
  const id = validDomId(input.id, "selector id");
  const label = nonEmpty(input.label, "selector label");
  const options = input.options.map((option, index) => Object.freeze({
    id: validDomId(option.id, "selector option id"),
    label: nonEmpty(option.label, "selector option label"),
    disabled: option.disabled === true,
    selected: option.id === input.selectedId,
    ariaPosInSet: index + 1,
    ariaSetSize: input.options.length,
  }));
  if (input.selectedId !== undefined && !options.some((option) => option.id === input.selectedId)) throw new RangeError("selector selected option is unavailable");
  const activeId = input.activeId ?? input.selectedId ?? options.find((option) => !option.disabled)?.id;
  if (activeId !== undefined && !options.some((option) => option.id === activeId && !option.disabled)) throw new RangeError("selector active option is unavailable");
  return Object.freeze({
    role: "combobox" as const,
    id,
    label,
    expanded: input.expanded === true,
    ariaExpanded: input.expanded === true,
    ariaControls: `${id}-listbox`,
    ariaHasPopup: "listbox" as const,
    ...(activeId === undefined ? {} : { ariaActiveDescendant: `${id}-option-${activeId}` }),
    ...(input.selectedId === undefined ? {} : { selectedId: input.selectedId }),
    options: Object.freeze(options),
    touchTarget: LARGE_TOUCH_TARGET,
  });
}

export interface AccessibleSelectorFocusState {
  readonly expanded: boolean;
  readonly activeIndex: number;
}

export type AccessibleSelectorKey = "ArrowDown" | "ArrowUp" | "Home" | "End" | "Enter" | " " | "Escape";

export interface AccessibleSelectorKeyboardResult {
  readonly state: AccessibleSelectorFocusState;
  readonly intent: "none" | "expand" | "collapse" | "move" | "select";
}

/** Keyboard and touch-selector navigation skips disabled entries and keeps
 * activeIndex bounded, so an accessible drawer can share the same model. */
export function reduceAccessibleSelectorKey(state: AccessibleSelectorFocusState, key: AccessibleSelectorKey, options: readonly Pick<AccessibleSelectorOption, "disabled">[]): AccessibleSelectorKeyboardResult {
  const available = options.map((option, index) => option.disabled ? -1 : index).filter((index) => index >= 0);
  if (available.length === 0) return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: -1 }), intent: "none" as const });
  const firstAvailable = available[0];
  if (firstAvailable === undefined) return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: -1 }), intent: "none" as const });
  const currentPosition = Math.max(0, available.indexOf(state.activeIndex));
  if (key === "Escape") return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: available[currentPosition] ?? firstAvailable }), intent: state.expanded ? "collapse" as const : "none" as const });
  if (key === "Enter" || key === " ") {
    if (!state.expanded) return Object.freeze({ state: Object.freeze({ expanded: true, activeIndex: available[currentPosition] ?? firstAvailable }), intent: "expand" as const });
    return Object.freeze({ state: Object.freeze({ expanded: false, activeIndex: available[currentPosition] ?? firstAvailable }), intent: "select" as const });
  }
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    const nextPosition = key === "Home" ? 0 : key === "End" ? available.length - 1 : key === "ArrowDown" ? (currentPosition + 1) % available.length : (currentPosition - 1 + available.length) % available.length;
    return Object.freeze({ state: Object.freeze({ expanded: true, activeIndex: available[nextPosition] ?? firstAvailable }), intent: "move" as const });
  }
  return Object.freeze({ state: Object.freeze({ expanded: state.expanded, activeIndex: available[currentPosition] ?? firstAvailable }), intent: "none" as const });
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return value;
}

function nonEmpty(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${name} must not be empty`);
  return value;
}

function validDomId(value: string, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_:.-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
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

export interface ResponsiveRouteTabItem {
  readonly route: SharedWorkspaceRoute;
  readonly label: string;
  readonly disabled: boolean;
  readonly selected: boolean;
  readonly tabId: string;
  readonly panelId: string;
  readonly ariaControls: string;
  readonly ariaSelected: boolean;
  readonly ariaDisabled: boolean;
  readonly tabIndex: 0 | -1;
  readonly touchTarget: ResponsiveTouchTarget;
}

/**
 * Host-neutral tablist contract for the shared route rail. It deliberately
 * carries route identifiers rather than callbacks, DOM nodes, or host actions
 * so browser and Desktop render one keyboard model.
 */
export interface ResponsiveRouteTabListModel {
  readonly role: "tablist";
  readonly ariaLabel: "Workspace routes";
  readonly ariaOrientation: "vertical" | "horizontal";
  readonly layout: ResponsiveLayout;
  readonly activeRoute: SharedWorkspaceRoute;
  readonly items: readonly ResponsiveRouteTabItem[];
}

export type ResponsiveRouteTabKey = "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "Enter" | " ";

export interface ResponsiveRouteTabKeyResult {
  readonly focusRoute: SharedWorkspaceRoute;
  readonly activeRoute: SharedWorkspaceRoute;
  readonly changed: boolean;
}

export function createResponsiveRouteTabListModel(options: {
  readonly routes: readonly SharedWorkspaceRouteEntry[];
  readonly activeRoute: SharedWorkspaceRoute;
  readonly layout: ResponsiveLayout;
  readonly disabledRoutes?: readonly SharedWorkspaceRoute[];
  readonly idPrefix?: string;
}): ResponsiveRouteTabListModel {
  const idPrefix = options.idPrefix ?? "terminay-route";
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(idPrefix)) throw new TypeError("route tab id prefix is invalid");
  if (!Array.isArray(options.routes) || options.routes.length === 0) throw new TypeError("route tabs require registered routes");
  const disabledRoutes = new Set(options.disabledRoutes ?? []);
  const routeNames = new Set<SharedWorkspaceRoute>();
  const items = options.routes.map((entry) => {
    if (routeNames.has(entry.route)) throw new TypeError("route tabs cannot repeat a route");
    routeNames.add(entry.route);
    const disabled = disabledRoutes.has(entry.route);
    const encodedRoute = encodeURIComponent(entry.route);
    return Object.freeze({
      route: entry.route,
      label: entry.label,
      disabled,
      selected: entry.route === options.activeRoute,
      tabId: `${idPrefix}-tab-${encodedRoute}`,
      panelId: `${idPrefix}-panel-${encodedRoute}`,
      ariaControls: `${idPrefix}-panel-${encodedRoute}`,
      ariaSelected: entry.route === options.activeRoute,
      ariaDisabled: disabled,
      tabIndex: entry.route === options.activeRoute ? 0 as const : -1 as const,
      touchTarget: LARGE_TOUCH_TARGET,
    });
  });
  const activeItem = items.find((item) => item.route === options.activeRoute);
  if (activeItem === undefined || activeItem.disabled) throw new TypeError("route tab active route must be enabled");
  return Object.freeze({
    role: "tablist" as const,
    ariaLabel: "Workspace routes" as const,
    ariaOrientation: options.layout === "narrow" ? "horizontal" as const : "vertical" as const,
    layout: options.layout,
    activeRoute: options.activeRoute,
    items: Object.freeze(items),
  });
}

/** Resolve roving route-tab focus and automatic route activation. Disabled
 * routes are skipped, while irrelevant keys leave both focus and selection
 * unchanged. */
export function reduceResponsiveRouteTabKey(
  model: ResponsiveRouteTabListModel,
  key: string,
  focusedRoute: SharedWorkspaceRoute = model.activeRoute,
): ResponsiveRouteTabKeyResult {
  const focusedIndex = model.items.findIndex((item) => item.route === focusedRoute && !item.disabled);
  if (focusedIndex < 0) throw new TypeError("route tab focus must identify an enabled route");
  const available = model.items.map((item, index) => item.disabled ? -1 : index).filter((index) => index >= 0);
  const currentPosition = available.indexOf(focusedIndex);
  const first = available[0];
  const last = available.at(-1);
  if (first === undefined || last === undefined) throw new TypeError("route tabs require an enabled route");
  let nextIndex = focusedIndex;
  if (key === "Home") nextIndex = first;
  else if (key === "End") nextIndex = last;
  else if (key === "ArrowRight" || key === "ArrowDown") nextIndex = available[(currentPosition + 1) % available.length] ?? focusedIndex;
  else if (key === "ArrowLeft" || key === "ArrowUp") nextIndex = available[(currentPosition - 1 + available.length) % available.length] ?? focusedIndex;
  const focusRoute = model.items[nextIndex]?.route;
  if (focusRoute === undefined) throw new TypeError("route tab focus is unavailable");
  const recognized = key === "Home" || key === "End" || key === "ArrowRight" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowUp" || key === "Enter" || key === " ";
  const activeRoute = recognized ? focusRoute : model.activeRoute;
  return Object.freeze({ focusRoute, activeRoute, changed: activeRoute !== model.activeRoute });
}

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

/** Stable semantic regions make a route a shared component contract rather
 * than only a navigation label. Hosts render these regions with their own
 * layout primitives, while the component identity and ordering remain shared
 * between web and Desktop. */
export type SharedWorkspaceRouteRegion =
  | "projects"
  | "workspace-views"
  | "dockview-panels"
  | "sidebar"
  | "terminal"
  | "file"
  | "folder"
  | "agents"
  | "git"
  | "command-surface"
  | "connection-list"
  | "connection-actions"
  | "connection-status"
  | "settings-sections"
  | "settings-editor"
  | "recording-list"
  | "recording-controls"
  | "recording-replay"
  | "macro-list"
  | "macro-editor"
  | "macro-preview"
  | "file-tree"
  | "file-tabs"
  | "file-editor"
  | "file-diff"
  | "git-status"
  | "git-worktrees"
  | "git-quick-push";

export interface SharedWorkspaceRouteComponent {
  readonly id: string;
  readonly label: string;
  readonly landmark: "main";
  readonly regions: readonly SharedWorkspaceRouteRegion[];
}

export interface SharedWorkspaceRouteRenderModel {
  readonly entry: SharedWorkspaceRouteEntry;
  readonly component: SharedWorkspaceRouteComponent;
  readonly presentation: SharedWorkspaceRouteEntry["presentation"];
}

const SHARED_ROUTE_COMPONENTS: Readonly<Record<SharedWorkspaceRoute, SharedWorkspaceRouteComponent>> = Object.freeze({
  workspace: Object.freeze({ id: "shared.route.workspace", label: "Workspace", landmark: "main", regions: sharedRegions("projects", "workspace-views", "dockview-panels", "sidebar", "terminal", "file", "folder", "agents", "git", "command-surface") }),
  connections: Object.freeze({ id: "shared.route.connections", label: "Connections", landmark: "main", regions: sharedRegions("connection-list", "connection-actions", "connection-status") }),
  settings: Object.freeze({ id: "shared.route.settings", label: "Settings", landmark: "main", regions: sharedRegions("settings-sections", "settings-editor") }),
  recordings: Object.freeze({ id: "shared.route.recordings", label: "Recordings", landmark: "main", regions: sharedRegions("recording-list", "recording-controls", "recording-replay") }),
  macros: Object.freeze({ id: "shared.route.macros", label: "Macros", landmark: "main", regions: sharedRegions("macro-list", "macro-editor", "macro-preview") }),
  file: Object.freeze({ id: "shared.route.file", label: "File", landmark: "main", regions: sharedRegions("file-tree", "file-tabs", "file-editor", "file-diff") }),
  git: Object.freeze({ id: "shared.route.git", label: "Git", landmark: "main", regions: sharedRegions("git-status", "git-worktrees", "git-quick-push") }),
});

function sharedRegions(...regions: SharedWorkspaceRouteRegion[]): readonly SharedWorkspaceRouteRegion[] {
  return Object.freeze(regions);
}

/** Resolve the complete shared component contract for a logical route. The
 * returned component is identical for web and Desktop; only the host-selected
 * presentation policy may differ. */
export function createSharedWorkspaceRouteRenderModel(
  route: SharedWorkspaceRoute,
  capabilities: HostCapabilityProvider = createHostCapabilityProvider(),
): SharedWorkspaceRouteRenderModel {
  const entry = createSharedWorkspaceRouteEntries(capabilities).find((candidate) => candidate.route === route);
  if (entry === undefined) throw new Error(`shared route is not registered: ${route}`);
  return Object.freeze({
    entry,
    component: SHARED_ROUTE_COMPONENTS[route],
    presentation: entry.presentation,
  });
}

/** Resolve all shared route components once for a host shell. */
export function createSharedWorkspaceRouteRenderModels(
  capabilities: HostCapabilityProvider = createHostCapabilityProvider(),
): readonly SharedWorkspaceRouteRenderModel[] {
  return Object.freeze(createSharedWorkspaceRouteEntries(capabilities).map((entry) => createSharedWorkspaceRouteRenderModel(entry.route, capabilities)));
}

export type SharedFileSelectionPresentation = "native-dialog" | "in-page";

export interface SharedFileSelectionModel {
  readonly action: "choose-file";
  readonly capability: "filePicker";
  readonly presentation: SharedFileSelectionPresentation;
  readonly route: "file";
  readonly label: string;
  readonly description: string;
  readonly multiple: boolean;
  readonly fallback: {
    readonly presentation: "in-page";
    readonly route: "file";
    readonly label: string;
  };
}

export type SharedFileSelectionResult =
  | { readonly kind: "native"; readonly files: readonly string[] }
  | { readonly kind: "fallback"; readonly route: "file" };

/** Resolve native file selection without making the shared workspace depend
 * on a host dialog. Hosts that advertise `filePicker` use their injected
 * action; every other host gets an in-page File-route alternative. */
export function createSharedFileSelectionModel(
  capabilities: HostCapabilityProvider = createHostCapabilityProvider(),
  options: { readonly multiple?: boolean } = {},
): SharedFileSelectionModel {
  const native = capabilities.has("filePicker");
  const multiple = options.multiple === true;
  return Object.freeze({
    action: "choose-file" as const,
    capability: "filePicker" as const,
    presentation: native ? "native-dialog" as const : "in-page" as const,
    route: "file" as const,
    label: native ? "Choose files" : "Browse workspace files",
    description: native ? "Choose files from this device" : "Use the shared File surface to choose workspace files",
    multiple,
    fallback: Object.freeze({
      presentation: "in-page" as const,
      route: "file" as const,
      label: "Browse workspace files",
    }),
  });
}

/** Execute the capability-gated branch while keeping the fallback a logical
 * route transition. The callback is host-owned navigation, not a server
 * command, so the server workspace remains usable without native APIs. */
export async function runSharedFileSelection(options: {
  readonly capabilities?: HostCapabilityProvider;
  readonly actions?: Pick<HostActions, "chooseFile">;
  readonly multiple?: boolean;
  readonly onFallback: () => void;
}): Promise<SharedFileSelectionResult> {
  const capabilities = options.capabilities ?? createHostCapabilityProvider();
  const model = createSharedFileSelectionModel(capabilities, { multiple: options.multiple });
  if (model.presentation === "native-dialog") {
    const chooseFile = options.actions?.chooseFile;
    if (chooseFile === undefined) throw new Error("filePicker capability requires a chooseFile host action");
    const files = await chooseFile({ multiple: model.multiple });
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) throw new TypeError("chooseFile host action returned invalid files");
    return Object.freeze({ kind: "native" as const, files: Object.freeze([...files]) });
  }
  options.onFallback();
  return Object.freeze({ kind: "fallback" as const, route: "file" as const });
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

export type ConnectionManagementAction = ConnectionMenuAction | "rename" | "archive" | "unarchive";

export interface ConnectionManagementConfirmation {
  readonly action: "archive" | "forget" | "revoke";
  readonly title: string;
  readonly body: string;
  readonly confirmLabel: string;
}

export interface ConnectionRenameFormModel {
  readonly profileId: string;
  readonly initialLabel: string;
  readonly value: string;
  readonly maxLength: 128;
  readonly canSubmit: boolean;
  readonly error?: string;
  readonly title: string;
  readonly submitLabel: "Save name";
}

export interface ConnectionManagementCard {
  readonly profileId: string;
  readonly label: string;
  readonly status: ConnectionStatus;
  readonly statusLabel: string;
  readonly isCurrent: boolean;
  readonly isLocal: boolean;
  readonly archived: boolean;
  readonly layout: ResponsiveLayout;
  readonly actions: readonly ConnectionManagementAction[];
  readonly confirmations: readonly ConnectionManagementConfirmation[];
}

export interface ConnectionManagementModel {
  readonly role: "region";
  readonly layout: ResponsiveLayout;
  readonly cards: readonly ConnectionManagementCard[];
}

export interface ConnectionManagementModelOptions {
  readonly capabilities?: HostCapabilityProvider;
  readonly canRevoke?: boolean;
  readonly viewportWidth?: number;
}

/** Build host-neutral management cards. The model intentionally carries
 * presentation density and copy, but no DOM or host implementation details,
 * so Desktop and web can render the same actions in different shells. */
export function createConnectionManagementModel(store: ConnectionProfileStore, options: ConnectionManagementModelOptions = {}): ConnectionManagementModel {
  const layout = classifyResponsiveLayout(options.viewportWidth ?? 1200);
  const menu = createConnectionMenuModel(store, options);
  const cards = menu.items.map((item) => {
    const profile = store.get(item.profileId);
    if (profile === undefined) throw new Error(`unknown connection profile: ${item.profileId}`);
    const actions: ConnectionManagementAction[] = [...item.actions];
    if (profile.isLocal !== true) {
      actions.push("rename");
      if (profile.archived === true) actions.push("unarchive");
      else actions.push("archive");
    }
    const uniqueActions = [...new Set(actions)];
    const confirmationActions = profile.isLocal === true
      ? []
      : (["archive", "forget", "revoke"] as const).filter((action) => action === "forget" || action === "revoke" && options.canRevoke === true || action === "archive" && profile.archived !== true);
    return Object.freeze({
      profileId: profile.id,
      label: profile.label,
      status: profile.status,
      statusLabel: formatConnectionStatus(profile.status),
      isCurrent: item.isCurrent,
      isLocal: profile.isLocal === true,
      archived: profile.archived === true,
      layout,
      actions: Object.freeze(uniqueActions),
      confirmations: Object.freeze(confirmationActions.map((action) => connectionManagementConfirmation(profile.label, action))),
    });
  });
  return Object.freeze({ role: "region" as const, layout, cards: Object.freeze(cards) });
}

/** Return a pure rename form projection. Mutating the profile remains an
 * explicit host action through ConnectionProfileStore.rename. */
export function createConnectionRenameForm(store: ConnectionProfileStore, profileId: string, value?: string): ConnectionRenameFormModel {
  const profile = store.get(profileId);
  if (profile === undefined) throw new Error(`unknown connection profile: ${profileId}`);
  const draft = value ?? profile.label;
  const error = profile.isLocal === true ? "Local cannot be renamed" : renameValidationError(draft);
  return Object.freeze({
    profileId: profile.id,
    initialLabel: profile.label,
    value: draft,
    maxLength: 128 as const,
    canSubmit: error === undefined,
    ...(error === undefined ? {} : { error }),
    title: `Rename ${profile.label}`,
    submitLabel: "Save name" as const,
  });
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

function renameValidationError(value: string): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) return "Enter a connection name";
  if (value.length > 128) return "Connection names must be 128 characters or fewer";
  if ([...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  })) return "Connection names cannot contain control characters";
  return undefined;
}

function connectionManagementConfirmation(label: string, action: "archive" | "forget" | "revoke"): ConnectionManagementConfirmation {
  if (action === "archive") return Object.freeze({ action, title: `Archive ${label}?`, body: "This hides the connection from normal selection but keeps its saved origin for recovery.", confirmLabel: "Archive connection" });
  if (action === "forget") return Object.freeze({ action, title: `Forget ${label}?`, body: "This removes host-local metadata only. It does not revoke access on the server.", confirmLabel: "Forget connection" });
  return Object.freeze({ action, title: `Revoke ${label}?`, body: "This changes server authorization and closes affected connections. Forgetting the profile is a separate action.", confirmLabel: "Revoke access" });
}

function assertItemCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("menu item count must be a non-negative safe integer");
}

function containsForbiddenKey(value: JsonValue): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_HOST_KEYS.test(key) || containsForbiddenKey(child));
}
