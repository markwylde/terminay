/**
 * Presentation-only data shared between Desktop's native host and a server
 * UI.  This is deliberately not a settings schema: it contains no server
 * state, secrets, filesystem paths, or native object handles.
 */

export const DESKTOP_PRESENTATION_VERSION = 1 as const;

export interface WindowGeometry {
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly maximized?: boolean;
}

export interface DesktopAcceleratorPresentation {
  readonly command: string;
  readonly title: string;
  /** Empty means the command is available but has no native accelerator. */
  readonly accelerator: string;
}

export type DesktopUpdaterState = "idle" | "checking" | "available" | "ready" | "error";

export interface DesktopUpdaterPresentation {
  readonly state: DesktopUpdaterState;
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly checkedAt?: string;
  readonly errorMessage?: string;
}

export interface DesktopOsIntegrationPresentation {
  readonly externalOpen: boolean;
  readonly reveal: boolean;
  readonly notifications: boolean;
  readonly nativeMenu: boolean;
  readonly dockIcon: boolean;
}

export interface DesktopPresentationMetadata {
  readonly version: typeof DESKTOP_PRESENTATION_VERSION;
  readonly accelerators: readonly DesktopAcceleratorPresentation[];
  readonly window: {
    readonly geometry?: WindowGeometry;
  };
  readonly updater: DesktopUpdaterPresentation;
  readonly osIntegration: DesktopOsIntegrationPresentation;
}

export interface DesktopPresentationInput {
  readonly accelerators?: readonly DesktopAcceleratorPresentation[];
  readonly geometry?: WindowGeometry;
  readonly updater?: DesktopUpdaterPresentation;
  readonly osIntegration?: DesktopOsIntegrationPresentation;
}

const ID_PATTERN = /^[a-z][a-z0-9._:-]{0,127}$/u;
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/u;
const ISO_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u;
const ACCELERATOR_PATTERN = /^[A-Za-z0-9+\\,./=\- ]{1,128}$/u;

export function createDesktopPresentationMetadata(input: DesktopPresentationInput = {}): DesktopPresentationMetadata {
  return normalizeDesktopPresentationMetadata({
    version: DESKTOP_PRESENTATION_VERSION,
    accelerators: input.accelerators ?? [],
    window: { ...(input.geometry === undefined ? {} : { geometry: input.geometry }) },
    updater: input.updater ?? { state: "idle", currentVersion: "0.0.0" },
    osIntegration: input.osIntegration ?? {
      externalOpen: false,
      reveal: false,
      notifications: false,
      nativeMenu: false,
      dockIcon: false,
    },
  });
}

/** Project the keyboard-shortcut portion of shared settings into the small
 * metadata shape the native menu needs. The settings object itself never
 * crosses this boundary. */
export function projectAcceleratorPresentation(
  commands: readonly Pick<DesktopAcceleratorPresentation, "command" | "title">[],
  keyboardShortcuts: Readonly<Record<string, string>>,
): readonly DesktopAcceleratorPresentation[] {
  if (!Array.isArray(commands) || typeof keyboardShortcuts !== "object" || keyboardShortcuts === null) throw new TypeError("accelerator presentation input is invalid");
  return Object.freeze(commands.map((command) => {
    const normalized = normalizeAcceleratorEntry({
      command: command.command,
      title: command.title,
      accelerator: keyboardShortcuts[command.command] ?? "",
    });
    return normalized;
  }));
}

export function normalizeDesktopPresentationMetadata(value: unknown): DesktopPresentationMetadata {
  if (!isRecord(value) || value.version !== DESKTOP_PRESENTATION_VERSION || !exactKeys(value, ["version", "accelerators", "window", "updater", "osIntegration"])) throw new TypeError("Desktop presentation metadata is invalid");
  if (!Array.isArray(value.accelerators)) throw new TypeError("Desktop accelerators are invalid");
  const accelerators = value.accelerators.map(normalizeAcceleratorEntry);
  const commandIds = new Set<string>();
  for (const entry of accelerators) {
    if (commandIds.has(entry.command)) throw new TypeError("Desktop accelerator commands must be unique");
    commandIds.add(entry.command);
  }
  if (!isRecord(value.window) || !exactKeys(value.window, [], ["geometry"])) throw new TypeError("Desktop window presentation is invalid");
  const geometry = value.window.geometry === undefined ? undefined : normalizeWindowGeometry(value.window.geometry);
  const updater = normalizeUpdaterPresentation(value.updater);
  const osIntegration = normalizeOsIntegrationPresentation(value.osIntegration);
  return Object.freeze({
    version: DESKTOP_PRESENTATION_VERSION,
    accelerators: Object.freeze(accelerators),
    window: Object.freeze(geometry === undefined ? {} : { geometry }),
    updater,
    osIntegration,
  });
}

export function normalizeWindowGeometry(value: unknown): WindowGeometry {
  if (!isRecord(value)) throw new TypeError("window geometry is invalid");
  if (!exactKeys(value, ["width", "height"], ["x", "y", "maximized"])) throw new TypeError("window geometry fields are invalid");
  const coordinate = (candidate: unknown, name: string): number | undefined => {
    if (candidate === undefined) return undefined;
    if (!Number.isSafeInteger(candidate) || (candidate as number) < -100_000 || (candidate as number) > 100_000) throw new TypeError(`${name} is invalid`);
    return candidate as number;
  };
  const dimension = (candidate: unknown, name: string): number => {
    if (!Number.isSafeInteger(candidate) || (candidate as number) < 1 || (candidate as number) > 10_000) throw new TypeError(`${name} is invalid`);
    return candidate as number;
  };
  const x = coordinate(value.x, "window x");
  const y = coordinate(value.y, "window y");
  const width = dimension(value.width, "window width");
  const height = dimension(value.height, "window height");
  if (value.maximized !== undefined && typeof value.maximized !== "boolean") throw new TypeError("window maximized flag is invalid");
  return Object.freeze({
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
    width,
    height,
    ...(value.maximized === undefined ? {} : { maximized: value.maximized }),
  });
}

function normalizeAcceleratorEntry(value: unknown): DesktopAcceleratorPresentation {
  if (!isRecord(value) || !exactKeys(value, ["command", "title", "accelerator"]) || typeof value.command !== "string" || !ID_PATTERN.test(value.command) || typeof value.title !== "string" || value.title.trim().length === 0 || value.title.length > 160 || hasControlCharacter(value.title) || typeof value.accelerator !== "string" || (value.accelerator.length > 0 && !ACCELERATOR_PATTERN.test(value.accelerator))) throw new TypeError("Desktop accelerator metadata is invalid");
  return Object.freeze({ command: value.command, title: value.title.trim(), accelerator: value.accelerator.trim() });
}

function normalizeUpdaterPresentation(value: unknown): DesktopUpdaterPresentation {
  if (!isRecord(value) || typeof value.state !== "string" || !["idle", "checking", "available", "ready", "error"].includes(value.state) || typeof value.currentVersion !== "string" || !VERSION_PATTERN.test(value.currentVersion) || !exactKeys(value, ["state", "currentVersion"], ["latestVersion", "releaseUrl", "checkedAt", "errorMessage"])) throw new TypeError("Desktop updater presentation is invalid");
  const latestVersion = optionalVersion(value.latestVersion, "latest updater version");
  const releaseUrl = value.releaseUrl === undefined ? undefined : normalizeReleaseUrl(value.releaseUrl);
  const checkedAt = optionalTimestamp(value.checkedAt, "updater checkedAt");
  const errorMessage = value.errorMessage === undefined ? undefined : boundedText(value.errorMessage, "updater error message", 512);
  if (value.state === "available" && (latestVersion === undefined || releaseUrl === undefined)) throw new TypeError("available updater state needs release metadata");
  return Object.freeze({
    state: value.state as DesktopUpdaterState,
    currentVersion: value.currentVersion,
    ...(latestVersion === undefined ? {} : { latestVersion }),
    ...(releaseUrl === undefined ? {} : { releaseUrl }),
    ...(checkedAt === undefined ? {} : { checkedAt }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
  });
}

function normalizeOsIntegrationPresentation(value: unknown): DesktopOsIntegrationPresentation {
  if (!isRecord(value) || !exactKeys(value, ["externalOpen", "reveal", "notifications", "nativeMenu", "dockIcon"]) || Object.values(value).some((candidate) => typeof candidate !== "boolean")) throw new TypeError("Desktop OS integration presentation is invalid");
  return Object.freeze({
    externalOpen: value.externalOpen as boolean,
    reveal: value.reveal as boolean,
    notifications: value.notifications as boolean,
    nativeMenu: value.nativeMenu as boolean,
    dockIcon: value.dockIcon as boolean,
  });
}

function optionalVersion(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !VERSION_PATTERN.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function optionalTimestamp(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !ISO_PATTERN.test(value) || Number.isNaN(Date.parse(value))) throw new TypeError(`${name} is invalid`);
  return value;
}

function normalizeReleaseUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || hasControlCharacter(value)) throw new TypeError("updater release URL is invalid");
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new TypeError("updater release URL is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError("updater release URL is invalid");
  return parsed.toString();
}

function boundedText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== "string" || value.length > maxLength || hasControlCharacter(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}
