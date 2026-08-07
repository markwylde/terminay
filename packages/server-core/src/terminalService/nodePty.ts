import type {
  PtyDataListener,
  PtyExitListener,
  PtyProcess,
  PtySpawnOptions,
  TerminalDimensions,
  Unsubscribe,
} from "./types.js";

/**
 * Node-PTY-specific observation of the process currently in the foreground.
 *
 * It remains server-internal lifecycle evidence: the terminal stream contract
 * never publishes it to renderers or remote clients.
 */
export interface NodePtyForegroundProcess {
  readonly processName: string;
  readonly shellForeground: boolean;
}

export type NodePtyForegroundListener = (event: NodePtyForegroundProcess) => void;

/** Extra, host-neutral capabilities supplied by the node-pty adapter. */
export interface NodePtyProcess extends PtyProcess {
  readonly onForegroundProcess: (listener: NodePtyForegroundListener) => Unsubscribe;
}

export interface NodePtyForegroundPollingOptions {
  /** Poll cadence for node-pty's `process` property. Defaults to 1.5 seconds. */
  readonly intervalMs?: number;
  /** Injectable only so adapter tests do not need wall-clock timers. */
  readonly setInterval?: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval?: (timer: unknown) => void;
}

export interface NodePtyFactoryOptions {
  readonly foregroundPolling?: NodePtyForegroundPollingOptions;
  readonly resolveCwd?: (pid: number, signal?: AbortSignal) => Promise<string | null>;
}

/**
 * The small subset of node-pty consumed by the server terminal authority.
 *
 * Keeping this structural interface here means server-core does not need to
 * import Electron (or a concrete node-pty module) and makes the privileged
 * host responsible for choosing/loading its PTY implementation.
 */
export interface NodePtyProcessLike {
  readonly pid?: number;
  readonly process?: string;
  readonly onData: (listener: (data: string) => void) => NodePtyDisposable | undefined;
  readonly onExit: (listener: (event: { readonly exitCode: number; readonly signal?: number }) => void) => NodePtyDisposable | undefined;
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: (signal?: number | string) => void;
	readonly pause?: () => void;
	readonly resume?: () => void;
}

export interface NodePtyDisposable { readonly dispose: () => void; }

export interface NodePtyModuleLike {
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: NodePtySpawnOptions,
  ) => NodePtyProcessLike;
}

export interface NodePtySpawnOptions extends TerminalDimensions {
  readonly name?: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Adapt node-pty to the server-owned PTY contract.
 *
 * There is deliberately no webContents/window/client argument here. The
 * returned factory can be installed once when the embedded or standalone
 * server starts, and TerminalService keeps the process alive independently of
 * any attaching client.
 */
export function createNodePtyFactory(module: NodePtyModuleLike, factoryOptions: NodePtyFactoryOptions = {}): { readonly spawn: (options: PtySpawnOptions) => NodePtyProcess } {
  if (module === undefined || typeof module.spawn !== "function") throw new TypeError("node-pty module must provide spawn");
  const foregroundPolling = createForegroundPolling(factoryOptions.foregroundPolling);
  return {
    spawn(options: PtySpawnOptions): NodePtyProcess {
      const child = module.spawn(options.shellPath, [...options.args], {
        name: options.name,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        ...(options.env === undefined ? {} : { env: cleanEnvironment(options.env) }),
      });
      const foreground = createForegroundObserver(child, shellName(options.shellPath), foregroundPolling);
      // This observer is intentionally independent from TerminalService's
      // exit subscription: foreground polling must be released even when a
      // host creates a PTY before the service attaches its own listener.
      child.onExit(() => foreground.dispose());
      return {
        ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
        write: (bytes) => child.write(new TextDecoder().decode(bytes)),
        resize: (dimensions) => child.resize(dimensions.cols, dimensions.rows),
        kill: (signal) => child.kill(signal),
				...(typeof child.pause === "function" ? { pause: () => child.pause?.() } : {}),
				...(typeof child.resume === "function" ? { resume: () => child.resume?.() } : {}),
        onData: (listener: PtyDataListener) => normalizeDisposable(child.onData((data) => listener(new TextEncoder().encode(data)))),
        onExit: (listener: PtyExitListener) => normalizeDisposable(child.onExit((event) => listener({ exitCode: event.exitCode, signal: event.signal ?? null }))),
        ...(typeof child.pid === "number" && factoryOptions.resolveCwd !== undefined
          ? { getCwd: (signal?: AbortSignal) => factoryOptions.resolveCwd!(child.pid!, signal) }
          : {}),
        onForegroundProcess: foreground.subscribe,
        // TerminalService may authoritatively finish a session before
        // node-pty delivers its exit callback (for example while shutting
        // down a wedged child).  Its generic process disposal hook must also
        // release this adapter-owned interval; waiting only for `onExit`
        // leaves the Node event loop alive.
        dispose: () => foreground.dispose(),
      };
    },
  };
}

/** Alias that makes host composition read naturally at the server boundary. */
export const createServerPtyFactory = createNodePtyFactory;

function normalizeDisposable(value: NodePtyDisposable | undefined): Unsubscribe | undefined {
  return value === undefined ? undefined : () => value.dispose();
}

function cleanEnvironment(value: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined) result[key] = entry;
  return result;
}

interface ForegroundPolling {
  readonly intervalMs: number;
  readonly setInterval: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval: (timer: unknown) => void;
}

function createForegroundPolling(options: NodePtyForegroundPollingOptions | undefined): ForegroundPolling {
  const intervalMs = options?.intervalMs ?? 1_500;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError("foreground polling intervalMs must be a positive finite number");
  const setTimer = options?.setInterval ?? ((callback: () => void, delay: number) => globalThis.setInterval(callback, delay));
  const clearTimer = options?.clearInterval ?? ((timer: unknown) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>));
  return { intervalMs, setInterval: setTimer, clearInterval: clearTimer };
}

function createForegroundObserver(
  child: NodePtyProcessLike,
  shellProcess: string,
  polling: ForegroundPolling,
): { readonly subscribe: (listener: NodePtyForegroundListener) => Unsubscribe; readonly dispose: () => void } {
  const listeners = new Set<NodePtyForegroundListener>();
  let timer: unknown | undefined;
  let lastProcess: string | undefined;
  let disposed = false;

  const stop = (): void => {
    if (timer === undefined) return;
    polling.clearInterval(timer);
    timer = undefined;
  };
  const poll = (): void => {
    if (disposed || listeners.size === 0) return;
    const processName = foregroundProcessName(child);
    if (processName === undefined || processName === lastProcess) return;
    lastProcess = processName;
    const event = Object.freeze({ processName, shellForeground: processName === shellProcess });
    for (const listener of [...listeners]) listener(event);
  };
  const start = (): void => {
    if (!disposed && timer === undefined) timer = polling.setInterval(poll, polling.intervalMs);
  };

  return {
    subscribe(listener: NodePtyForegroundListener): Unsubscribe {
      if (typeof listener !== "function") throw new TypeError("foreground listener must be a function");
      if (disposed) return () => {};
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      stop();
    },
  };
}

function foregroundProcessName(child: NodePtyProcessLike): string | undefined {
  try {
    const value = child.process;
    const processName = typeof value === "string" ? value.trim() : "";
    return processName.length === 0 ? undefined : processName;
  } catch {
    return undefined;
  }
}

function shellName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
