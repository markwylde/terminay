import type { ConnectionProfile } from "./connectionProfiles.js";
import type { WorkspaceViewBinding } from "./windowRegistry.js";
export const DESKTOP_HOST_STATE_SCHEMA_VERSION = 1 as const;
export interface DesktopHostState { readonly schemaVersion: 1; readonly profiles: readonly ConnectionProfile[]; readonly credentialReferences: readonly string[]; readonly windows: readonly WorkspaceViewBinding[]; readonly updates: Readonly<Record<string, boolean | number | string>>; readonly osPermissions: Readonly<Record<string, boolean>>; readonly devicePreferences: Readonly<Record<string, boolean | number | string>>; }
const ALLOWED = new Set(["schemaVersion", "profiles", "credentialReferences", "windows", "updates", "osPermissions", "devicePreferences"]);
// Desktop reads its one bundle from the packaged artifact, so a per-server
// verified bundle cache no longer exists. An older store that still carries
// one is migrated by discarding the field rather than failing closed.
const DISCARDED = new Set(["bundleCache", "workspace", "workspaceSnapshot", "application", "applicationDto", "projects", "projectRoots", "panels", "panelLayout", "terminals", "terminalState", "serverSettings", "featureCapabilities"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export function migrateDesktopHostState(value: unknown): DesktopHostState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Desktop host state must be an object"); const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!ALLOWED.has(key) && !DISCARDED.has(key)) throw new TypeError(`Desktop host state field is not classified: ${key}`);
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new TypeError("Desktop host state schema is unsupported");
  return Object.freeze({ schemaVersion: 1, profiles: Object.freeze(Array.isArray(input.profiles) ? [...input.profiles] as ConnectionProfile[] : []), credentialReferences: stringIds(input.credentialReferences ?? []), windows: Object.freeze(Array.isArray(input.windows) ? [...input.windows] as WorkspaceViewBinding[] : []), updates: scalars(input.updates ?? {}, "update state"), osPermissions: booleans(input.osPermissions ?? {}), devicePreferences: scalars(input.devicePreferences ?? {}, "device preference") });
}
export function assertDesktopHostPersistenceOwnership(source: string): void {
  if (/(?:workspaceSnapshot|applicationDto|projectRoots|panelLayout|terminalState|serverSettings|featureCapabilities)\s*:/u.test(source)) throw new Error("Desktop persistence contains server-owned feature state");
}
function stringIds(value: unknown): readonly string[] { if (!Array.isArray(value) || value.length > 10_000) throw new TypeError("credential reference list is invalid"); return Object.freeze(value.map((item) => { if (typeof item !== "string" || !ID.test(item)) throw new TypeError("credential reference is invalid"); return item; })); }
function scalars(value: unknown, name: string): Readonly<Record<string, boolean | number | string>> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} is invalid`); const out: Record<string, boolean | number | string> = {}; for (const [key, item] of Object.entries(value)) { if (!ID.test(key) || (typeof item !== "boolean" && typeof item !== "number" && typeof item !== "string")) throw new TypeError(`${name} is invalid`); out[key] = item; } return Object.freeze(out); }
function booleans(value: unknown): Readonly<Record<string, boolean>> { const out = scalars(value, "OS permission"); if (Object.values(out).some((item) => typeof item !== "boolean")) throw new TypeError("OS permission is invalid"); return out as Readonly<Record<string, boolean>>; }
