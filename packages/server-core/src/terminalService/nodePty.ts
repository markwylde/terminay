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
  readonly resolveForegroundProcess?: (pid: number, signal?: AbortSignal) => Promise<string | null>;
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
      const foreground = createForegroundObserver(
        child,
        shellName(options.shellPath),
        foregroundPolling,
        factoryOptions.resolveForegroundProcess,
      );
      const dataListeners = new Set<(data: string) => void>();
      const exitListeners = new Set<(event: { readonly exitCode: number; readonly signal?: number }) => void>();
      const pendingData: string[] = [];
      let pendingExit: { readonly exitCode: number; readonly signal?: number } | undefined;
      const childData = child.onData((data) => {
        // Output is an authoritative indication that the PTY advanced. Refresh
        // the foreground projection at the same host boundary so a delayed or
        // starved interval cannot leave destructive-close protection stale.
        // The interval remains necessary for silent foreground processes.
        void foreground.poll();
        if (dataListeners.size === 0) {
          pendingData.push(data);
          return;
        }
        for (const listener of [...dataListeners]) listener(data);
      });
      const childExit = child.onExit((event) => {
        foreground.dispose();
        if (exitListeners.size === 0) {
          pendingExit = event;
          return;
        }
        for (const listener of [...exitListeners]) listener(event);
      });
      return {
        ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
        write: (bytes) => child.write(new TextDecoder().decode(bytes)),
        resize: (dimensions) => child.resize(dimensions.cols, dimensions.rows),
        kill: (signal) => child.kill(signal),
				...(typeof child.pause === "function" ? { pause: () => child.pause?.() } : {}),
				...(typeof child.resume === "function" ? { resume: () => child.resume?.() } : {}),
        onData: (listener: PtyDataListener) => {
          const forward = (data: string) => listener(new TextEncoder().encode(data));
          dataListeners.add(forward);
          if (pendingData.length > 0) {
            const initial = pendingData.splice(0);
            for (const data of initial) forward(data);
          }
          return () => dataListeners.delete(forward);
        },
        onExit: (listener: PtyExitListener) => {
          const forward = (event: { readonly exitCode: number; readonly signal?: number }) =>
            listener({ exitCode: event.exitCode, signal: event.signal ?? null });
          exitListeners.add(forward);
          if (pendingExit !== undefined) {
            const initial = pendingExit;
            pendingExit = undefined;
            forward(initial);
          }
          return () => exitListeners.delete(forward);
        },
        ...(typeof child.pid === "number" && factoryOptions.resolveCwd !== undefined
          ? { getCwd: (signal?: AbortSignal) => factoryOptions.resolveCwd!(child.pid!, signal) }
          : {}),
        onForegroundProcess: foreground.subscribe,
        refreshForegroundProcess: foreground.poll,
        // TerminalService may authoritatively finish a session before
        // node-pty delivers its exit callback (for example while shutting
        // down a wedged child).  Its generic process disposal hook must also
        // release this adapter-owned interval; waiting only for `onExit`
        // leaves the Node event loop alive.
        dispose: () => {
          foreground.dispose();
          childData?.dispose();
          childExit?.dispose();
          dataListeners.clear();
          exitListeners.clear();
          pendingData.splice(0);
          pendingExit = undefined;
        },
      };
    },
  };
}

/** Alias that makes host composition read naturally at the server boundary. */
export const createServerPtyFactory = createNodePtyFactory;

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
  resolveProcess: NodePtyFactoryOptions["resolveForegroundProcess"],
): { readonly subscribe: (listener: NodePtyForegroundListener) => Unsubscribe; readonly poll: (signal?: AbortSignal) => Promise<void>; readonly dispose: () => void } {
  const listeners = new Set<NodePtyForegroundListener>();
  let timer: unknown | undefined;
  let lastProcess: string | undefined;
  let disposed = false;
  let resolving: Promise<void> | undefined;
  let requestedObservation = 0;
  let completedObservation = 0;
  let latestSignal: AbortSignal | undefined;

  const stop = (): void => {
    if (timer === undefined) return;
    polling.clearInterval(timer);
    timer = undefined;
  };
  const publish = (processName: string | undefined): void => {
    if (disposed || listeners.size === 0) return;
    if (processName === undefined || processName === lastProcess) return;
    lastProcess = processName;
    const event = Object.freeze({ processName, shellForeground: isConfiguredShellProcess(processName, shellProcess) });
    for (const listener of [...listeners]) listener(event);
  };
  const poll = (signal?: AbortSignal): Promise<void> => {
    if (disposed || listeners.size === 0) return Promise.resolve();
    if (resolveProcess === undefined || child.pid === undefined) {
      publish(foregroundProcessName(child));
      return Promise.resolve();
    }
    // A close-time activity snapshot must not accept an observation that was
    // already in flight while the shell still owned the foreground group. Each
    // refresh requests a new host sample; concurrent callers are coalesced
    // into at most one follow-up observation after the current one completes.
    requestedObservation += 1;
    latestSignal = signal;
    if (resolving !== undefined) return resolving;
    resolving = (async () => {
      while (!disposed && completedObservation < requestedObservation) {
        const target = requestedObservation;
        const currentSignal = latestSignal;
        await resolveProcess(child.pid!, currentSignal).then(
          (processName) => publish(processName?.trim() || foregroundProcessName(child)),
          () => publish(foregroundProcessName(child)),
        );
        completedObservation = target;
      }
    })().finally(() => { resolving = undefined; });
    return resolving;
  };
  const start = (): void => {
    if (!disposed && timer === undefined) timer = polling.setInterval(() => { void poll(); }, polling.intervalMs);
  };

  return {
    poll,
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

function isConfiguredShellProcess(processName: string, configuredShell: string): boolean {
  if (processName === configuredShell) return true;
  return configuredShell === "sh" && processName === "dash";
}
