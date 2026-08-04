/**
 * Host-neutral accessibility and terminal-safety contracts for the shared
 * responsive workspace.  Hosts resolve browser/native preferences and apply
 * the returned policy; this module deliberately has no DOM or transport
 * dependencies.
 */

export type ResponsiveColorScheme = "system" | "light" | "dark";

export interface AccessibilityPreferenceInput {
  readonly reducedMotion?: boolean;
  readonly colorScheme?: ResponsiveColorScheme;
  readonly forcedColors?: boolean;
  readonly highContrast?: boolean;
  /** A host hint, never a browser/DOM detection mechanism. */
  readonly screenReader?: boolean;
}

export interface AccessibilityPreferenceModel {
  readonly reducedMotion: boolean;
  readonly motion: {
    readonly transition: "none" | "standard";
    readonly durationScale: 0 | 1;
    readonly preserveKeyboardAccess: true;
  };
  readonly colorScheme: ResponsiveColorScheme;
  readonly forcedColors: boolean;
  readonly highContrast: boolean;
  readonly screenReader: boolean;
  readonly announcements: {
    readonly statusLive: "polite";
    readonly terminalLive: "off";
    readonly terminalAtomic: false;
  };
}

/** Resolve host-provided preference values into one immutable shared policy. */
export function createAccessibilityPreferenceModel(input: AccessibilityPreferenceInput = {}): AccessibilityPreferenceModel {
  const reducedMotion = optionalBoolean(input.reducedMotion, "reducedMotion");
  const forcedColors = optionalBoolean(input.forcedColors, "forcedColors");
  const highContrast = optionalBoolean(input.highContrast, "highContrast");
  const screenReader = optionalBoolean(input.screenReader, "screenReader");
  const colorScheme = input.colorScheme ?? "system";
  if (colorScheme !== "system" && colorScheme !== "light" && colorScheme !== "dark") throw new TypeError("colorScheme is invalid");
  return Object.freeze({
    reducedMotion,
    motion: Object.freeze({
      transition: reducedMotion ? "none" as const : "standard" as const,
      durationScale: reducedMotion ? 0 as const : 1 as const,
      preserveKeyboardAccess: true as const,
    }),
    colorScheme,
    forcedColors,
    highContrast,
    screenReader,
    announcements: Object.freeze({
      statusLive: "polite" as const,
      terminalLive: "off" as const,
      terminalAtomic: false as const,
    }),
  });
}

export interface FocusRestorationPlanInput {
  readonly open: boolean;
  readonly initialFocusId?: string;
  readonly restoreFocusId?: string;
}

export interface FocusRestorationPlan {
  readonly open: boolean;
  readonly initialFocusId: string | null;
  readonly restoreFocusId: string | null;
  readonly openFocusTarget: string | null;
  readonly closeFocusTarget: string | null;
  readonly preserveFocus: true;
  /** Missing targets never cause a focus jump; the host leaves focus alone. */
  readonly missingTargetPolicy: "leave-focus-unchanged";
}

/** Describe the focus hand-off for a drawer/modal without touching the DOM. */
export function createFocusRestorationPlan(input: FocusRestorationPlanInput): FocusRestorationPlan {
  if (typeof input.open !== "boolean") throw new TypeError("open must be boolean");
  const initialFocusId = optionalDomId(input.initialFocusId, "initial focus id");
  const restoreFocusId = optionalDomId(input.restoreFocusId, "restore focus id");
  const open = input.open === true;
  return Object.freeze({
    open,
    initialFocusId,
    restoreFocusId,
    openFocusTarget: open ? initialFocusId : null,
    closeFocusTarget: open ? null : restoreFocusId,
    preserveFocus: true as const,
    missingTargetPolicy: "leave-focus-unchanged" as const,
  });
}

export type TerminalSafetyDenial = "not-allowlisted" | "input-too-large" | "invalid-geometry";

export interface TerminalSafetyModel {
  readonly maxInputBytes: number;
  readonly maxCols: number;
  readonly maxRows: number;
  readonly preservesPhysicalKeyboardInput: true;
  readonly accessoryInput: "allowlist-only";
  readonly terminalOutputLive: "off";
  readonly malformedInput: "deny";
}

export interface TerminalSafetyOptions {
  readonly maxInputBytes?: number;
  readonly maxCols?: number;
  readonly maxRows?: number;
}

export interface TerminalAccessoryValidation {
  readonly accepted: boolean;
  readonly bytes: number;
  readonly value?: string;
  readonly denial?: TerminalSafetyDenial;
}

export interface TerminalGeometry {
  readonly cols: number;
  readonly rows: number;
  readonly clamped: boolean;
}

const DEFAULT_MAX_INPUT_BYTES = 64 * 1024;
const DEFAULT_MAX_COLS = 500;
const DEFAULT_MAX_ROWS = 200;

/** Create the bounded policy shared by touch-terminal hosts. */
export function createTerminalSafetyModel(options: TerminalSafetyOptions = {}): TerminalSafetyModel {
  const maxInputBytes = positiveInteger(options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES, "maxInputBytes");
  const maxCols = positiveInteger(options.maxCols ?? DEFAULT_MAX_COLS, "maxCols");
  const maxRows = positiveInteger(options.maxRows ?? DEFAULT_MAX_ROWS, "maxRows");
  return Object.freeze({
    maxInputBytes,
    maxCols,
    maxRows,
    preservesPhysicalKeyboardInput: true as const,
    accessoryInput: "allowlist-only" as const,
    terminalOutputLive: "off" as const,
    malformedInput: "deny" as const,
  });
}

/** Validate one touch-accessory payload. Physical keyboard input is not sent
 * through this validator and therefore retains full terminal functionality. */
export function validateTerminalAccessoryInput(
  value: unknown,
  allowlistedInputs: readonly string[],
  options: Pick<TerminalSafetyModel, "maxInputBytes"> = createTerminalSafetyModel(),
): TerminalAccessoryValidation {
  if (typeof value !== "string" || !allowlistedInputs.includes(value)) return Object.freeze({ accepted: false, bytes: 0, denial: "not-allowlisted" as const });
  const bytes = new TextEncoder().encode(value).byteLength;
  if (bytes > options.maxInputBytes) return Object.freeze({ accepted: false, bytes, denial: "input-too-large" as const });
  return Object.freeze({ accepted: true, bytes, value });
}

/** Clamp touch-provided geometry to safe positive integer bounds. */
export function boundTerminalGeometry(
  input: { readonly cols: number; readonly rows: number },
  options: Pick<TerminalSafetyModel, "maxCols" | "maxRows"> = createTerminalSafetyModel(),
): TerminalGeometry {
  if (!Number.isFinite(input.cols) || !Number.isFinite(input.rows)) throw new RangeError("terminal geometry must be finite");
  if (input.cols <= 0 || input.rows <= 0) throw new RangeError("terminal geometry must be positive");
  const cols = Math.max(1, Math.min(options.maxCols, Math.floor(input.cols)));
  const rows = Math.max(1, Math.min(options.maxRows, Math.floor(input.rows)));
  return Object.freeze({ cols, rows, clamped: cols !== input.cols || rows !== input.rows });
}

function optionalBoolean(value: boolean | undefined, name: string): boolean {
  if (value !== undefined && typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  return value === true;
}

function optionalDomId(value: string | undefined, name: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_:.-]{0,127}$/u.test(value)) throw new TypeError(`${name} is invalid`);
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
