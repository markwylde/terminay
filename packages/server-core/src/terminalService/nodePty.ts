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
  readonly observation: "available" | "limited";
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
      let exited = false;
      let exitSubscriptionDisposed = false;
      const exitWaiters = new Set<() => void>();
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
        exited = true;
		queueMicrotask(() => {
			if (exitSubscriptionDisposed) return;
			exitSubscriptionDisposed = true;
			childExit?.dispose();
		});
        for (const resolve of exitWaiters) resolve();
        exitWaiters.clear();
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
        kill: async (signal) => {
          child.kill(signal);
          if (exited) return;
          const exitedGracefully = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              exitWaiters.delete(done);
              resolve(false);
            }, 1_000);
            const done = () => {
              clearTimeout(timeout);
              resolve(true);
            };
            exitWaiters.add(done);
          });
		  if (exitedGracefully || exited || signal === 'SIGKILL' || signal === 9) return;
		  child.kill('SIGKILL');
		  if (exited) return;
		  await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
			  exitWaiters.delete(done);
			  resolve();
			}, 4_000);
			const done = () => {
			  clearTimeout(timeout);
			  resolve();
			};
			exitWaiters.add(done);
		  });
        },
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
        refreshForegroundProcess: foreground.observeFresh,
        // TerminalService may authoritatively finish a session before
        // node-pty delivers its exit callback (for example while shutting
        // down a wedged child).  Its generic process disposal hook must also
        // release this adapter-owned interval; waiting only for `onExit`
        // leaves the Node event loop alive.
        dispose: () => {
          foreground.dispose();
          childData?.dispose();
          // node-pty may invoke this adapter and TerminalService disposal on
          // the native exit callback's own stack. Releasing its TSFN from
          // inside that callback aborts macOS with an uncaught Napi::Error.
          // Once exit fired, node-pty owns completion of that subscription.
          if (!exited && !exitSubscriptionDisposed) {
			exitSubscriptionDisposed = true;
			childExit?.dispose();
		  }
          dataListeners.clear();
          exitListeners.clear();
          pendingData.splice(0);
          pendingExit = undefined;
          for (const resolve of exitWaiters) resolve();
          exitWaiters.clear();
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

interface FreshObservationWaiter {
  needEpoch: number;
  abortListener?: () => void;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly signal?: AbortSignal;
}

function createForegroundObserver(
  child: NodePtyProcessLike,
  shellProcess: string,
  polling: ForegroundPolling,
  resolveProcess: NodePtyFactoryOptions["resolveForegroundProcess"],
): {
  readonly subscribe: (listener: NodePtyForegroundListener) => Unsubscribe;
  readonly poll: (signal?: AbortSignal) => Promise<void>;
  readonly observeFresh: (signal?: AbortSignal) => Promise<void>;
  readonly dispose: () => void;
} {
  const listeners = new Set<NodePtyForegroundListener>();
  const freshWaiters = new Set<FreshObservationWaiter>();
  let timer: unknown | undefined;
  let lastProcess: string | undefined;
  let lastObservation: "available" | "limited" | undefined;
  let disposed = false;
  let inFlight: Promise<void> | undefined;
  let pending = false;
  let latestSignal: AbortSignal | undefined;
  let sampleAbort: AbortController | undefined;
  let epoch = 0;
  let completedEpoch = 0;

  const stop = (): void => {
    if (timer === undefined) return;
    polling.clearInterval(timer);
    timer = undefined;
  };
  const publish = (processName: string | undefined, observation: "available" | "limited"): void => {
    if (disposed || listeners.size === 0) return;
    if (observation === "available") {
      if (processName === undefined) return;
      if (processName === lastProcess && lastObservation === "available") return;
      lastProcess = processName;
    } else if (lastObservation === "limited") {
      return;
    }
    lastObservation = observation;
    const publishedName = processName ?? lastProcess ?? "";
    const event = Object.freeze({
      processName: publishedName,
      shellForeground: publishedName.length > 0 && isConfiguredShellProcess(publishedName, shellProcess),
      observation,
    });
    for (const listener of [...listeners]) listener(event);
  };
  const detachWaiter = (waiter: FreshObservationWaiter): boolean => {
    if (!freshWaiters.delete(waiter)) return false;
    if (waiter.abortListener !== undefined) {
      waiter.signal?.removeEventListener("abort", waiter.abortListener);
    }
    return true;
  };
  const settleWaiters = (): void => {
    for (const waiter of [...freshWaiters]) {
      if (completedEpoch < waiter.needEpoch) continue;
      if (detachWaiter(waiter)) waiter.resolve();
    }
  };
  const rejectWaiter = (waiter: FreshObservationWaiter, reason: unknown): void => {
    if (detachWaiter(waiter)) waiter.reject(reason);
  };
  const runSample = async (sampleEpoch: number, signal: AbortSignal | undefined): Promise<void> => {
    if (resolveProcess === undefined || child.pid === undefined) {
      if (sampleEpoch !== epoch) return;
      publish(foregroundProcessName(child), "available");
      return;
    }
    try {
      const processName = await resolveProcess(child.pid, signal);
      if (disposed || sampleEpoch !== epoch) return;
      publish(processName?.trim() || foregroundProcessName(child), "available");
    } catch {
      if (disposed || sampleEpoch !== epoch || signal?.aborted) return;
      publish(foregroundProcessName(child), "limited");
    }
  };
  const startSample = (): void => {
    if (disposed || inFlight !== undefined || listeners.size === 0) return;
    const sampleEpoch = epoch;
    const controller = new AbortController();
    sampleAbort = controller;
    const onLatestAbort = (): void => {
      controller.abort(latestSignal?.reason ?? new Error("foreground observation aborted"));
    };
    if (latestSignal?.aborted) onLatestAbort();
    else latestSignal?.addEventListener("abort", onLatestAbort, { once: true });
    inFlight = (async () => {
      try {
        await runSample(sampleEpoch, controller.signal);
        if (!disposed && sampleEpoch === epoch && !controller.signal.aborted) {
          completedEpoch = sampleEpoch;
          settleWaiters();
        }
      } catch (error) {
        for (const waiter of [...freshWaiters]) {
          if (waiter.needEpoch === sampleEpoch) rejectWaiter(waiter, error);
        }
      } finally {
        latestSignal?.removeEventListener("abort", onLatestAbort);
        if (sampleAbort === controller) sampleAbort = undefined;
        inFlight = undefined;
        if (pending && !disposed) {
          pending = false;
          startSample();
        }
      }
    })();
  };
  const requestSample = (signal?: AbortSignal): void => {
    if (disposed || listeners.size === 0) return;
    if (signal !== undefined) latestSignal = signal;
    if (resolveProcess === undefined || child.pid === undefined) {
      publish(foregroundProcessName(child), "available");
      completedEpoch = epoch;
      settleWaiters();
      return;
    }
    if (inFlight !== undefined) {
      pending = true;
      return;
    }
    startSample();
  };
  const poll = (signal?: AbortSignal): Promise<void> => {
    requestSample(signal);
    return inFlight ?? Promise.resolve();
  };
  const observeFresh = (signal?: AbortSignal): Promise<void> => {
    if (disposed || listeners.size === 0) return Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("foreground observation aborted"));
    }
    return new Promise((resolve, reject) => {
      epoch += 1;
      const waiter: FreshObservationWaiter = {
        needEpoch: epoch,
        resolve,
        reject,
        signal,
      };
      const abortListener = (): void => {
        rejectWaiter(waiter, signal?.reason ?? new Error("foreground observation aborted"));
      };
      waiter.abortListener = abortListener;
      signal?.addEventListener("abort", abortListener, { once: true });
      freshWaiters.add(waiter);
      sampleAbort?.abort(signal?.reason ?? new Error("foreground observation replaced"));
      pending = false;
      queueMicrotask(() => {
        if (!freshWaiters.has(waiter)) return;
        requestSample(signal);
        settleWaiters();
      });
    });
  };
  const start = (): void => {
    if (!disposed && timer === undefined) timer = polling.setInterval(() => { void poll(); }, polling.intervalMs);
  };

  return {
    poll,
    observeFresh,
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
      sampleAbort?.abort(new Error("foreground observation disposed"));
      for (const waiter of [...freshWaiters]) {
        rejectWaiter(waiter, new Error("foreground observation disposed"));
      }
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
  const normalized = processName.startsWith("-") ? processName.slice(1) : processName;
  if (normalized === configuredShell || normalized === "login") return true;
  return configuredShell === "sh" && normalized === "dash";
}
