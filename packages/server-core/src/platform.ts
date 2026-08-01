/**
 * Host-owned paths required by server services.
 *
 * The server runtime deliberately receives these values instead of reaching
 * into Electron (or another host framework) for app paths.  Keep this type
 * data-only so it can cross the standalone/embedded composition boundary.
 */
export interface ServerPlatformPaths {
  readonly dataRoot: string;
  readonly home: string;
  readonly temp: string;
  readonly configRoot?: string;
  readonly cacheRoot?: string;
  readonly logRoot?: string;
}

export function validateServerPlatformPaths(paths: ServerPlatformPaths, expectedDataRoot?: string): ServerPlatformPaths {
  if (typeof paths !== "object" || paths === null) throw new TypeError("server platform paths are required");
  const checked = {
    dataRoot: checkedPath(paths.dataRoot, "data root"),
    home: checkedPath(paths.home, "home path"),
    temp: checkedPath(paths.temp, "temporary path"),
    ...(paths.configRoot === undefined ? {} : { configRoot: checkedPath(paths.configRoot, "config path") }),
    ...(paths.cacheRoot === undefined ? {} : { cacheRoot: checkedPath(paths.cacheRoot, "cache path") }),
    ...(paths.logRoot === undefined ? {} : { logRoot: checkedPath(paths.logRoot, "log path") }),
  } satisfies ServerPlatformPaths;
  if (expectedDataRoot !== undefined && checked.dataRoot !== expectedDataRoot) throw new TypeError("platform data root does not match runtime data root");
  return Object.freeze(checked);
}

function checkedPath(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || value.includes("\0") || value.includes("\r") || value.includes("\n")) throw new TypeError(`${label} is invalid`);
  return value;
}
