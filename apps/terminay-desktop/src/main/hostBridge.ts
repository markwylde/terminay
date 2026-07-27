import type { HostCapabilitySet } from "@terminay/client-core";

export const DESKTOP_HOST_BRIDGE_VERSION = 1 as const;

export type DesktopHostActionType =
  | "window.open"
  | "window.focus"
  | "window.close"
  | "menu.command"
  | "clipboard.read"
  | "clipboard.write"
  | "file.choose"
  | "external.open"
  | "reveal"
  | "update.status"
  | "notification.show";

export type DesktopHostAction =
  | { readonly type: "window.open"; readonly profileId: string; readonly workspaceViewId?: string }
  | { readonly type: "window.focus"; readonly windowId: string }
  | { readonly type: "window.close"; readonly windowId?: string }
  | { readonly type: "menu.command"; readonly command: string }
  | { readonly type: "clipboard.read" }
  | { readonly type: "clipboard.write"; readonly text: string }
  | { readonly type: "file.choose"; readonly multiple?: boolean }
  | { readonly type: "external.open"; readonly url: string }
  | { readonly type: "reveal"; readonly fileId: string }
  | { readonly type: "update.status"; readonly channel: "stable" | "beta"; readonly state: "available" | "downloading" | "ready" | "error" }
  | { readonly type: "notification.show"; readonly title: string; readonly body?: string };

export interface DesktopHostRequest {
  readonly version: typeof DESKTOP_HOST_BRIDGE_VERSION;
  readonly sourceId: string;
  readonly windowId: string;
  readonly connectionId: string;
  readonly userGesture: boolean;
  readonly action: DesktopHostAction;
}

export interface DesktopHostContext {
  readonly version: typeof DESKTOP_HOST_BRIDGE_VERSION;
  readonly windowId: string;
  readonly connectionId: string;
  readonly profileLabel: string;
  readonly capabilities: HostCapabilitySet;
}

export interface DesktopHostBridgeHandlers {
  readonly windowOpen?: (request: Extract<DesktopHostAction, { type: "window.open" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly windowFocus?: (request: Extract<DesktopHostAction, { type: "window.focus" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly windowClose?: (request: Extract<DesktopHostAction, { type: "window.close" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly menuCommand?: (request: Extract<DesktopHostAction, { type: "menu.command" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly clipboardRead?: (context: DesktopHostContext) => Promise<string> | string;
  readonly clipboardWrite?: (request: Extract<DesktopHostAction, { type: "clipboard.write" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly fileChoose?: (request: Extract<DesktopHostAction, { type: "file.choose" }>, context: DesktopHostContext) => Promise<readonly string[]> | readonly string[];
  readonly externalOpen?: (request: Extract<DesktopHostAction, { type: "external.open" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly reveal?: (request: Extract<DesktopHostAction, { type: "reveal" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly updateStatus?: (request: Extract<DesktopHostAction, { type: "update.status" }>, context: DesktopHostContext) => Promise<void> | void;
  readonly notificationShow?: (request: Extract<DesktopHostAction, { type: "notification.show" }>, context: DesktopHostContext) => Promise<void> | void;
}

export interface DesktopHostBinding {
  readonly sourceId: string;
  readonly context: DesktopHostContext;
  readonly handlers: DesktopHostBridgeHandlers;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMMAND_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/;
const FILE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CAPABILITY_NAMES = new Set(["nativeWindows", "secureStorage", "notifications", "filePicker", "clipboard", "serverExposure", "connectionProfiles"]);

function assertId(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function keysOf(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = new Set(keysOf(value));
  return required.every((key) => keys.has(key)) && [...keys].every((key) => required.includes(key) || optional.includes(key));
}

function actionRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("host action must be an object");
  return value as Record<string, unknown>;
}

/** Runtime validation is repeated in the main router and preload facade. It
 * rejects extra fields so a server bundle cannot smuggle native arguments. */
export function validateDesktopHostAction(value: unknown): DesktopHostAction {
  const action = actionRecord(value);
  if (typeof action.type !== "string") throw new TypeError("host action type is required");
  switch (action.type as DesktopHostActionType) {
    case "window.open": {
      if (!exactKeys(action, ["type", "profileId"], ["workspaceViewId"]) || typeof action.profileId !== "string") throw new TypeError("window.open payload is invalid");
      assertId(action.profileId, "profile id");
      if (action.workspaceViewId !== undefined) assertId(action.workspaceViewId, "workspace view id");
      return Object.freeze({ type: "window.open", profileId: action.profileId, ...(action.workspaceViewId === undefined ? {} : { workspaceViewId: action.workspaceViewId }) });
    }
    case "window.focus": {
      if (!exactKeys(action, ["type", "windowId"])) throw new TypeError("window.focus payload is invalid");
      assertId(action.windowId, "window id");
      return Object.freeze({ type: "window.focus", windowId: action.windowId });
    }
    case "window.close": {
      if (!exactKeys(action, ["type"], ["windowId"])) throw new TypeError("window.close payload is invalid");
      if (action.windowId !== undefined) assertId(action.windowId, "window id");
      return Object.freeze({ type: "window.close", ...(action.windowId === undefined ? {} : { windowId: action.windowId }) });
    }
    case "menu.command": {
      if (!exactKeys(action, ["type", "command"]) || typeof action.command !== "string" || !COMMAND_PATTERN.test(action.command)) throw new TypeError("menu.command payload is invalid");
      return Object.freeze({ type: "menu.command", command: action.command });
    }
    case "clipboard.read":
      if (!exactKeys(action, ["type"])) throw new TypeError("clipboard.read payload is invalid");
      return Object.freeze({ type: "clipboard.read" });
    case "clipboard.write":
      if (!exactKeys(action, ["type", "text"]) || typeof action.text !== "string" || action.text.length > 1024 * 1024) throw new TypeError("clipboard.write payload is invalid");
      return Object.freeze({ type: "clipboard.write", text: action.text });
    case "file.choose":
      if (!exactKeys(action, ["type"], ["multiple"]) || (action.multiple !== undefined && typeof action.multiple !== "boolean")) throw new TypeError("file.choose payload is invalid");
      return Object.freeze({ type: "file.choose", ...(action.multiple === undefined ? {} : { multiple: action.multiple }) });
    case "external.open":
      if (!exactKeys(action, ["type", "url"]) || typeof action.url !== "string") throw new TypeError("external.open payload is invalid");
      try {
        const url = new URL(action.url);
        if (url.protocol !== "https:") throw new Error();
      } catch {
        throw new TypeError("external.open only accepts HTTPS URLs");
      }
      return Object.freeze({ type: "external.open", url: action.url });
    case "reveal":
      if (!exactKeys(action, ["type", "fileId"]) || typeof action.fileId !== "string" || !FILE_TOKEN_PATTERN.test(action.fileId)) throw new TypeError("reveal payload is invalid");
      return Object.freeze({ type: "reveal", fileId: action.fileId });
    case "update.status":
      if (!exactKeys(action, ["type", "channel", "state"]) || (action.channel !== "stable" && action.channel !== "beta") || (action.state !== "available" && action.state !== "downloading" && action.state !== "ready" && action.state !== "error")) throw new TypeError("update.status payload is invalid");
      return Object.freeze({ type: "update.status", channel: action.channel, state: action.state });
    case "notification.show":
      if (!exactKeys(action, ["type", "title"], ["body"]) || typeof action.title !== "string" || action.title.trim().length === 0 || action.title.length > 200 || (action.body !== undefined && (typeof action.body !== "string" || action.body.length > 4_096))) throw new TypeError("notification.show payload is invalid");
      return Object.freeze({ type: "notification.show", title: action.title, ...(action.body === undefined ? {} : { body: action.body }) });
    default:
      throw new TypeError("host action is not allowed");
  }
}

export function validateDesktopHostRequest(value: unknown): DesktopHostRequest {
  const request = actionRecord(value);
  if (!exactKeys(request, ["version", "sourceId", "windowId", "connectionId", "userGesture", "action"]) || request.version !== DESKTOP_HOST_BRIDGE_VERSION) throw new TypeError("host request version or fields are invalid");
  assertId(request.sourceId, "host source id");
  assertId(request.windowId, "window id");
  assertId(request.connectionId, "connection id");
  if (typeof request.userGesture !== "boolean") throw new TypeError("host user gesture is invalid");
  return Object.freeze({ version: DESKTOP_HOST_BRIDGE_VERSION, sourceId: request.sourceId, windowId: request.windowId, connectionId: request.connectionId, userGesture: request.userGesture, action: validateDesktopHostAction(request.action) });
}

function requiresGesture(_action: DesktopHostAction): boolean {
  return true;
}

function requiredCapability(action: DesktopHostAction): keyof HostCapabilitySet | undefined {
  switch (action.type) {
    case "window.open":
    case "window.focus":
    case "window.close":
    case "menu.command":
    case "external.open":
    case "reveal":
      return "nativeWindows";
    case "clipboard.read":
    case "clipboard.write":
      return "clipboard";
    case "file.choose":
      return "filePicker";
    case "update.status":
      return undefined;
    case "notification.show":
      return "notifications";
  }
}

/** Main-process router. A server UI gets one binding and cannot address a
 * different native window or connection through the same bridge. */
export class DesktopHostBridgeRouter {
  private readonly bindings = new Map<string, DesktopHostBinding>();

  register(binding: DesktopHostBinding): void {
    assertId(binding.sourceId, "host source id");
    if (binding.context.version !== DESKTOP_HOST_BRIDGE_VERSION) throw new TypeError("unsupported host bridge version");
    assertId(binding.context.windowId, "window id");
    assertId(binding.context.connectionId, "connection id");
    if (binding.context.profileLabel.trim().length === 0 || binding.context.profileLabel.length > 160 || hasControlCharacter(binding.context.profileLabel)) throw new TypeError("profile label is invalid");
    for (const [name, enabled] of Object.entries(binding.context.capabilities)) {
      if (!CAPABILITY_NAMES.has(name) || typeof enabled !== "boolean") throw new TypeError("host capability declaration is invalid");
    }
    if (this.bindings.has(binding.sourceId)) throw new Error(`host source already registered: ${binding.sourceId}`);
    this.bindings.set(binding.sourceId, Object.freeze({ ...binding, context: Object.freeze({ ...binding.context, capabilities: Object.freeze({ ...binding.context.capabilities }) }) }));
  }

  unregister(sourceId: string): void {
    this.bindings.delete(sourceId);
  }

  context(sourceId: string): DesktopHostContext {
    return this.requireBinding(sourceId).context;
  }

  async request(value: unknown): Promise<unknown> {
    const request = validateDesktopHostRequest(value);
    const binding = this.requireBinding(request.sourceId);
    if (request.windowId !== binding.context.windowId || request.connectionId !== binding.context.connectionId) throw new Error("host request is outside the bound window or connection");
    if (requiresGesture(request.action) && !request.userGesture) throw new Error("host action requires a user gesture");
    const { context, handlers } = binding;
    const action = request.action;
    const capability = requiredCapability(action);
    if (capability !== undefined && context.capabilities[capability] !== true) throw new Error(`host capability is unavailable: ${capability}`);
    switch (action.type) {
      case "window.open":
        if (action.profileId !== context.connectionId) throw new Error("host cannot open a different connection through a server UI bridge");
        return handlers.windowOpen?.(action, context);
      case "window.focus":
        if (action.windowId !== context.windowId) throw new Error("host cannot focus an unrelated native window");
        return handlers.windowFocus?.(action, context);
      case "window.close":
        if (action.windowId !== undefined && action.windowId !== context.windowId) throw new Error("host cannot close an unrelated native window");
        return handlers.windowClose?.(action, context);
      case "menu.command": return handlers.menuCommand?.(action, context);
      case "clipboard.read": return handlers.clipboardRead?.(context);
      case "clipboard.write": return handlers.clipboardWrite?.(action, context);
      case "file.choose": return handlers.fileChoose?.(action, context);
      case "external.open": return handlers.externalOpen?.(action, context);
      case "reveal": return handlers.reveal?.(action, context);
      case "update.status": return handlers.updateStatus?.(action, context);
      case "notification.show": return handlers.notificationShow?.(action, context);
    }
  }

  private requireBinding(sourceId: string): DesktopHostBinding {
    const binding = this.bindings.get(sourceId);
    if (binding === undefined) throw new Error("unknown host bridge source");
    return binding;
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}
