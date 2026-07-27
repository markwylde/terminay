import type { ProtocolId } from "@terminay/protocol";

export interface WorkspaceViewBinding {
  readonly windowId: string;
  readonly connectionId: string;
  readonly workspaceViewId?: ProtocolId;
  readonly geometry?: WindowGeometry;
}

/** Host-local native geometry. It is deliberately not part of the server
 * workspace model and is bounded before it can reach persistence or a native
 * window adapter. */
export interface WindowGeometry {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly maximized?: boolean;
}

export interface WindowViewStorage {
  load(): readonly unknown[] | Promise<readonly unknown[]>;
  save(bindings: readonly WorkspaceViewBinding[]): void | Promise<void>;
}

export type WindowSelection =
  | { readonly action: "focus"; readonly binding: WorkspaceViewBinding }
  | { readonly action: "open"; readonly binding: WorkspaceViewBinding };

const WINDOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONNECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function assertId(value: string, name: string): void {
  if (!WINDOW_ID_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
}

function normalizeGeometry(value: unknown): WindowGeometry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("window geometry is invalid");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["x", "y", "width", "height", "maximized"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`window geometry field is not allowed: ${key}`);
  const coordinate = (candidate: unknown, name: string): number | undefined => {
    if (candidate === undefined) return undefined;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < -100_000 || (candidate as number) > 100_000) throw new TypeError(`${name} is invalid`);
    return candidate as number;
  };
  const dimension = (candidate: unknown, name: string): number => {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 1 || (candidate as number) > 10_000) throw new TypeError(`${name} is invalid`);
    return candidate as number;
  };
  const x = coordinate(input.x, "window x");
  const y = coordinate(input.y, "window y");
  const width = dimension(input.width, "window width");
  const height = dimension(input.height, "window height");
  if (input.maximized !== undefined && typeof input.maximized !== "boolean") throw new TypeError("window maximized flag is invalid");
  return Object.freeze({ ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }), width, height, ...(input.maximized === undefined ? {} : { maximized: input.maximized }) });
}

function normalizeBinding(value: unknown): WorkspaceViewBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("window binding is required");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["windowId", "connectionId", "workspaceViewId", "geometry"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`window binding field is not allowed: ${key}`);
  if (typeof input.windowId !== "string") throw new TypeError("window id is invalid");
  if (typeof input.connectionId !== "string") throw new TypeError("connection id is invalid");
  assertId(input.windowId, "window id");
  if (!CONNECTION_ID_PATTERN.test(input.connectionId)) throw new TypeError("connection id is invalid");
  if (input.workspaceViewId !== undefined) {
    if (typeof input.workspaceViewId !== "string") throw new TypeError("workspace view id is invalid");
    assertId(input.workspaceViewId, "workspace view id");
  }
  const geometry = input.geometry === undefined ? undefined : normalizeGeometry(input.geometry);
  return Object.freeze({
    windowId: input.windowId,
    connectionId: input.connectionId,
    ...(input.workspaceViewId === undefined ? {} : { workspaceViewId: input.workspaceViewId }),
    ...(geometry === undefined ? {} : { geometry }),
  });
}

function viewKey(connectionId: string, workspaceViewId?: ProtocolId): string {
  return `${connectionId}\u0000${workspaceViewId ?? ""}`;
}

/** Maps native windows to logical server views. BrowserWindow ids never leave
 * this host-local registry and are not used as server object identities. */
export class WindowViewRegistry {
  private readonly byWindow = new Map<string, WorkspaceViewBinding>();
  private readonly storage: WindowViewStorage | undefined;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(options: { readonly storage?: WindowViewStorage; readonly initial?: readonly unknown[] } = {}) {
    this.storage = options.storage;
    for (const raw of options.initial ?? []) this.insert(normalizeBinding(raw));
  }

  async load(): Promise<void> {
    if (this.storage === undefined) return;
    const values = await this.storage.load();
    const parsed = parseWindowBindings(values);
    this.byWindow.clear();
    for (const binding of parsed) this.insert(binding);
  }

  serialize(): readonly WorkspaceViewBinding[] {
    return Object.freeze([...this.byWindow.values()].map((binding) => Object.freeze({
      ...binding,
      ...(binding.geometry === undefined ? {} : { geometry: Object.freeze({ ...binding.geometry }) }),
    })));
  }

  async flush(): Promise<void> {
    await this.writePromise;
  }

  bind(binding: WorkspaceViewBinding): WorkspaceViewBinding {
    const normalized = normalizeBinding(binding);
    const prior = this.byWindow.get(normalized.windowId);
    if (prior !== undefined && (prior.connectionId !== normalized.connectionId || prior.workspaceViewId !== normalized.workspaceViewId)) {
      throw new Error("window is already bound; explicit rebind is required");
    }
    this.byWindow.set(normalized.windowId, normalized);
    this.persist();
    return normalized;
  }

  rebind(windowId: string, connectionId: string, workspaceViewId?: ProtocolId): WorkspaceViewBinding {
    assertId(windowId, "window id");
    this.unbind(windowId);
    return this.bind({ windowId, connectionId, ...(workspaceViewId === undefined ? {} : { workspaceViewId }) });
  }

  unbind(windowId: string): WorkspaceViewBinding | undefined {
    assertId(windowId, "window id");
    const prior = this.byWindow.get(windowId);
    this.byWindow.delete(windowId);
    if (prior !== undefined) this.persist();
    return prior;
  }

  get(windowId: string): WorkspaceViewBinding | undefined {
    assertId(windowId, "window id");
    return this.byWindow.get(windowId);
  }

  updateGeometry(windowId: string, geometry: WindowGeometry): WorkspaceViewBinding {
    const prior = this.get(windowId);
    if (prior === undefined) throw new Error(`unknown window: ${windowId}`);
    const next = normalizeBinding({ ...prior, geometry });
    this.byWindow.set(windowId, next);
    this.persist();
    return next;
  }

  list(connectionId?: string): readonly WorkspaceViewBinding[] {
    if (connectionId !== undefined && !CONNECTION_ID_PATTERN.test(connectionId)) throw new TypeError("connection id is invalid");
    return Object.freeze([...this.byWindow.values()].filter((binding) => connectionId === undefined || binding.connectionId === connectionId));
  }

  /** Select an existing suitable window, or return a new opaque binding. */
  select(connectionId: string, workspaceViewId?: ProtocolId, options: { readonly currentWindowId?: string; readonly rebindCurrent?: boolean; readonly createWindowId?: () => string } = {}): WindowSelection {
    if (!CONNECTION_ID_PATTERN.test(connectionId)) throw new TypeError("connection id is invalid");
    if (workspaceViewId !== undefined) assertId(workspaceViewId, "workspace view id");
    const key = viewKey(connectionId, workspaceViewId);
    const existing = [...this.byWindow.values()].find((binding) => viewKey(binding.connectionId, binding.workspaceViewId) === key);
    if (existing !== undefined) return Object.freeze({ action: "focus", binding: existing });

    if (options.rebindCurrent === true && options.currentWindowId !== undefined) {
      assertId(options.currentWindowId, "current window id");
      const rebound = this.rebind(options.currentWindowId, connectionId, workspaceViewId);
      return Object.freeze({ action: "open", binding: rebound });
    }
    const windowId = options.createWindowId?.() ?? `window:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    assertId(windowId, "new window id");
    if (this.byWindow.has(windowId)) throw new Error("window id already exists");
    const binding = this.bind({ windowId, connectionId, ...(workspaceViewId === undefined ? {} : { workspaceViewId }) });
    return Object.freeze({ action: "open", binding });
  }

  clear(): void {
    if (this.byWindow.size === 0) return;
    this.byWindow.clear();
    this.persist();
  }

  private insert(binding: WorkspaceViewBinding): void {
    if (this.byWindow.has(binding.windowId)) throw new TypeError(`duplicate window binding: ${binding.windowId}`);
    this.byWindow.set(binding.windowId, binding);
  }

  private persist(): void {
    if (this.storage === undefined) return;
    const snapshot = this.serialize();
    this.writePromise = this.writePromise.catch(() => undefined).then(() => this.storage?.save(snapshot)).then(() => undefined);
  }
}

export function parseWindowBindings(value: unknown): readonly WorkspaceViewBinding[] {
  if (!Array.isArray(value)) throw new TypeError("window binding storage must be an array");
  const parsed = value.map(normalizeBinding);
  const ids = new Set<string>();
  for (const binding of parsed) {
    if (ids.has(binding.windowId)) throw new TypeError(`duplicate window binding: ${binding.windowId}`);
    ids.add(binding.windowId);
  }
  return Object.freeze(parsed);
}
