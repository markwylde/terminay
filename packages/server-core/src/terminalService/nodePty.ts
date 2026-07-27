import type {
  PtyDataListener,
  PtyExitListener,
  PtyFactory,
  PtyProcess,
  PtySpawnOptions,
  TerminalDimensions,
  Unsubscribe,
} from "./types.js";

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
  readonly onData: (listener: (data: string) => void) => NodePtyDisposable | void;
  readonly onExit: (listener: (event: { readonly exitCode: number; readonly signal?: number }) => void) => NodePtyDisposable | void;
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: (signal?: number | string) => void;
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
export function createNodePtyFactory(module: NodePtyModuleLike): PtyFactory {
  if (module === undefined || typeof module.spawn !== "function") throw new TypeError("node-pty module must provide spawn");
  return {
    spawn(options: PtySpawnOptions): PtyProcess {
      const child = module.spawn(options.shellPath, [...options.args], {
        name: options.name,
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        ...(options.env === undefined ? {} : { env: cleanEnvironment(options.env) }),
      });
      return {
        ...(typeof child.pid === "number" ? { pid: child.pid } : {}),
        write: (bytes) => child.write(new TextDecoder().decode(bytes)),
        resize: (dimensions) => child.resize(dimensions.cols, dimensions.rows),
        kill: (signal) => child.kill(signal),
        onData: (listener: PtyDataListener) => normalizeDisposable(child.onData((data) => listener(new TextEncoder().encode(data)))),
        onExit: (listener: PtyExitListener) => normalizeDisposable(child.onExit((event) => listener({ exitCode: event.exitCode, signal: event.signal ?? null }))),
      };
    },
  };
}

/** Alias that makes host composition read naturally at the server boundary. */
export const createServerPtyFactory = createNodePtyFactory;

function normalizeDisposable(value: NodePtyDisposable | void): Unsubscribe | void {
  return value === undefined ? undefined : () => value.dispose();
}

function cleanEnvironment(value: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) if (entry !== undefined) result[key] = entry;
  return result;
}
