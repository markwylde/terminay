import type { JsonValue } from "@terminay/protocol";
import type { QueryCommandTransport } from "./queryCommand.js";
import type { CommandOptions, QueryOptions } from "./types.js";

export const SHELL_PROFILE_OPERATIONS = Object.freeze({
  catalogue: "shell-profiles.catalogue",
  refresh: "shell-profiles.refresh",
  create: "shell-profiles.create",
  update: "shell-profiles.update",
  reorder: "shell-profiles.reorder",
  delete: "shell-profiles.delete",
  setDefault: "shell-profiles.set-default",
  setCwdPolicy: "shell-profiles.set-cwd-policy",
  validate: "shell-profiles.validate",
	detail: "shell-profiles.detail",
	reset: "shell-profiles.reset",
} as const);

export type ShellProfileStartupMode = "default" | "login" | "non-login";
export type ShellProfileCwdPolicy = "current" | "project" | "home";
export type ShellProfileTarget =
  | Readonly<{ kind: "system" }>
  | Readonly<{ kind: "executable"; executable: string }>
  | Readonly<{ kind: "wsl"; distribution: string; shellPath?: string }>;

export interface ShellProfileDefinition {
  readonly id: string;
  readonly name: string;
  readonly target: ShellProfileTarget;
  readonly args: readonly string[];
  readonly startupMode: ShellProfileStartupMode;
  readonly environment: Readonly<Record<string, string | null>>;
  readonly icon?: string;
  readonly color?: string;
}

export interface ShellProfileCatalogueEntry extends Omit<ShellProfileDefinition, "environment"> {
  readonly kind: "system" | "discovered" | "custom";
  readonly readOnly: boolean;
  readonly source: string;
  readonly availability: Readonly<{ available: boolean; reason?: string }>;
  readonly projectReferences: readonly string[];
	readonly environmentEntryCount: number;
	readonly hasEnvironmentOverlay: boolean;
	readonly argumentCount: number;
}

export interface ShellProfileCatalogue {
  readonly settingsRevision: number;
  readonly entries: readonly ShellProfileCatalogueEntry[];
  readonly defaultProfileId: string;
  readonly cwdPolicy: ShellProfileCwdPolicy;
}

export interface ShellProfileValidationResult {
  readonly valid: boolean;
  readonly fieldErrors: Readonly<Record<string, string>>;
	readonly issues: readonly Readonly<{ code: string; field: string; message: string }>[];
}

/** Transport-neutral, server-scoped shell profile facade. Renderer code sends
 * profile identities and structured records only; executable resolution and
 * launch validation remain privileged server responsibilities. */
export class ShellProfilesClient {
  constructor(private readonly transport: QueryCommandTransport) {}

  async catalogue(options: QueryOptions = {}): Promise<ShellProfileCatalogue> {
    return parseCatalogue(await this.transport.query(SHELL_PROFILE_OPERATIONS.catalogue, {}, options));
  }

  async refresh(options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    return this.mutate(SHELL_PROFILE_OPERATIONS.refresh, {}, options);
  }

	async detail(profileId: string, options: QueryOptions = {}): Promise<ShellProfileDefinition> {
		return parseProfile(await this.transport.query(SHELL_PROFILE_OPERATIONS.detail, { profileId: boundedText(profileId, "profile id", 128) }, options), false);
	}

  async create(profile: Omit<ShellProfileDefinition, "id">, options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
		const validated = profilePayload({ ...profile, id: "profile:client-validation" });
		const { id: _clientOnlyId, ...withoutId } = validated as Record<string, JsonValue>;
    return this.mutate(SHELL_PROFILE_OPERATIONS.create, { profile: withoutId }, options);
  }

  async update(profile: ShellProfileDefinition, options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    return this.mutate(SHELL_PROFILE_OPERATIONS.update, { profile: profilePayload(profile) }, options);
  }

  async reorder(profileIds: readonly string[], options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    if (profileIds.length > 64) throw new TypeError("shell profile order exceeds the limit");
    return this.mutate(SHELL_PROFILE_OPERATIONS.reorder, { profileIds: profileIds.map((id) => boundedText(id, "profile id", 128)) }, options);
  }

  async delete(profileId: string, options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    return this.mutate(SHELL_PROFILE_OPERATIONS.delete, { profileId: boundedText(profileId, "profile id", 128) }, options);
  }

  async setDefault(profileId: string, options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    return this.mutate(SHELL_PROFILE_OPERATIONS.setDefault, { profileId: boundedText(profileId, "profile id", 128) }, options);
  }

  async setCwdPolicy(cwdPolicy: ShellProfileCwdPolicy, options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
    if (!isCwdPolicy(cwdPolicy)) throw new TypeError("shell profile cwd policy is invalid");
    return this.mutate(SHELL_PROFILE_OPERATIONS.setCwdPolicy, { cwdPolicy }, options);
  }

	async reset(options: CommandOptions = {}): Promise<ShellProfileCatalogue> {
		return this.mutate(SHELL_PROFILE_OPERATIONS.reset, {}, options);
	}

  async validate(profile: ShellProfileDefinition, options: QueryOptions = {}): Promise<ShellProfileValidationResult> {
    return parseValidation(await this.transport.query(SHELL_PROFILE_OPERATIONS.validate, { profile: profilePayload(profile) }, options));
  }

  private async mutate(operation: string, payload: JsonValue, options: CommandOptions): Promise<ShellProfileCatalogue> {
		return parseCatalogue(await this.transport.command(operation, payload, options));
  }
}

function profilePayload(profile: ShellProfileDefinition): JsonValue {
  const parsed = parseProfile(profile as unknown as JsonValue, false);
  const payload = {
    id: parsed.id,
    name: parsed.name,
    target: parsed.target,
    args: [...parsed.args],
    startupMode: parsed.startupMode,
    environment: { ...parsed.environment },
    ...(parsed.icon === undefined ? {} : { icon: parsed.icon }),
    ...(parsed.color === undefined ? {} : { color: parsed.color }),
  } as JsonValue;
	assertEncodedBytes(payload, 16_384, "shell profile");
	return payload;
}

function parseCatalogue(value: JsonValue): ShellProfileCatalogue {
	assertEncodedBytes(value, 64 * 1024, "shell profile catalogue");
  if (!isRecord(value) || !safeUInt(value.settingsRevision) || !Array.isArray(value.entries) || typeof value.defaultProfileId !== "string" || !isCwdPolicy(value.cwdPolicy)) throw new TypeError("shell profile catalogue is invalid");
	if (value.entries.length > 256) throw new TypeError("shell profile catalogue exceeds the entry limit");
  const entries = value.entries.map((entry) => parseProfile(entry, true));
	if (entries.filter((entry) => entry.kind === "custom").length > 64) throw new TypeError("shell profile catalogue exceeds the custom profile limit");
  if (!entries.some((entry) => entry.id === value.defaultProfileId)) throw new TypeError("shell profile default is invalid");
  return Object.freeze({ settingsRevision: value.settingsRevision, entries: Object.freeze(entries), defaultProfileId: value.defaultProfileId, cwdPolicy: value.cwdPolicy });
}

function parseProfile(value: JsonValue, catalogueEntry: true): ShellProfileCatalogueEntry;
function parseProfile(value: JsonValue, catalogueEntry: false): ShellProfileDefinition;
function parseProfile(value: JsonValue, catalogueEntry: boolean): ShellProfileCatalogueEntry | ShellProfileDefinition {
	assertEncodedBytes(value, 16_384, "shell profile");
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || !Array.isArray(value.args) || !isStartupMode(value.startupMode)) throw new TypeError("shell profile is invalid");
  const id = boundedText(value.id, "profile id", 128);
  const name = boundedText(value.name, "profile name", 128);
	if (value.args.length > 64) throw new TypeError("shell profile arguments exceed the limit");
  const args = value.args.map((arg) => boundedText(arg, "profile argument", 4096, true));
  const target = parseTarget(value.target);
  const common = {
    id, name, target, args: Object.freeze(args), startupMode: value.startupMode,
    ...(optionalText(value.icon, "profile icon", 8) === undefined ? {} : { icon: optionalText(value.icon, "profile icon", 8) }),
    ...(optionalText(value.color, "profile color", 9) === undefined ? {} : { color: optionalText(value.color, "profile color", 9) }),
  };
  if (!catalogueEntry) {
		if (!isRecord(value.environment)) throw new TypeError("shell profile environment is invalid");
		const environment: Record<string, string | null> = {};
		if (Object.keys(value.environment).length > 128) throw new TypeError("shell profile environment exceeds the limit");
		for (const [key, entry] of Object.entries(value.environment)) {
			boundedText(key, "environment key", 256);
			if (entry !== null && typeof entry !== "string") throw new TypeError("shell profile environment is invalid");
			environment[key] = entry === null ? null : boundedText(entry, "environment value", 16_384, true);
		}
		return Object.freeze({ ...common, environment: Object.freeze(environment) });
	}
  if ((value.kind !== "system" && value.kind !== "discovered" && value.kind !== "custom") || typeof value.readOnly !== "boolean" || typeof value.source !== "string" || !isRecord(value.availability) || typeof value.availability.available !== "boolean") throw new TypeError("shell profile catalogue entry is invalid");
  const availability = Object.freeze({ available: value.availability.available, ...(optionalText(value.availability.reason, "availability reason", 1024) === undefined ? {} : { reason: optionalText(value.availability.reason, "availability reason", 1024) }) });
  const projectReferences = value.projectReferences === undefined ? [] : value.projectReferences;
  if (!Array.isArray(projectReferences) || projectReferences.some((projectId) => typeof projectId !== "string")) throw new TypeError("shell profile references are invalid");
	if (!safeUInt(value.argumentCount) || value.argumentCount > 64) throw new TypeError("shell profile argument summary is invalid");
	if (!safeUInt(value.environmentEntryCount) || value.environmentEntryCount > 128 || typeof value.hasEnvironmentOverlay !== "boolean") throw new TypeError("shell profile environment summary is invalid");
  return Object.freeze({ ...common, kind: value.kind, readOnly: value.readOnly, source: boundedText(value.source, "profile source", 256, true), availability, projectReferences: Object.freeze(projectReferences.map((id) => boundedText(id, "project id", 128))), argumentCount: value.argumentCount, environmentEntryCount: value.environmentEntryCount, hasEnvironmentOverlay: value.hasEnvironmentOverlay });
}

function parseTarget(value: JsonValue | undefined): ShellProfileTarget {
  if (!isRecord(value) || typeof value.kind !== "string") throw new TypeError("shell profile target is invalid");
  if (value.kind === "system") return Object.freeze({ kind: "system" });
  if (value.kind === "executable" && typeof value.executable === "string") return Object.freeze({ kind: "executable", executable: boundedText(value.executable, "shell executable", 4096) });
  if (value.kind === "wsl" && typeof value.distribution === "string") return Object.freeze({ kind: "wsl", distribution: boundedText(value.distribution, "WSL distribution", 256), ...(optionalText(value.shellPath, "WSL shell path", 4096) === undefined ? {} : { shellPath: optionalText(value.shellPath, "WSL shell path", 4096) }) });
  throw new TypeError("shell profile target is invalid");
}

function parseValidation(value: JsonValue): ShellProfileValidationResult {
	if (!isRecord(value) || typeof value.valid !== "boolean" || !Array.isArray(value.issues)) throw new TypeError("shell profile validation result is invalid");
  const fieldErrors: Record<string, string> = {};
	const issues = value.issues.map((issue) => {
		if (!isRecord(issue) || typeof issue.code !== "string" || typeof issue.field !== "string" || typeof issue.message !== "string") throw new TypeError("shell profile validation result is invalid");
		const parsed = Object.freeze({ code: boundedText(issue.code, "validation code", 128), field: boundedText(issue.field, "validation field", 256), message: boundedText(issue.message, "validation message", 1024) });
		fieldErrors[parsed.field] ??= parsed.message;
		return parsed;
	});
	if (value.valid !== (issues.length === 0)) {
		throw new TypeError("shell profile validation result is inconsistent");
  }
  return Object.freeze({ valid: value.valid, fieldErrors: Object.freeze(fieldErrors), issues: Object.freeze(issues) });
}

function isRecord(value: unknown): value is Record<string, JsonValue> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function safeUInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isStartupMode(value: unknown): value is ShellProfileStartupMode { return value === "default" || value === "login" || value === "non-login"; }
function isCwdPolicy(value: unknown): value is ShellProfileCwdPolicy { return value === "current" || value === "project" || value === "home"; }
function optionalText(value: unknown, label: string, max: number): string | undefined { return value === undefined ? undefined : boundedText(value, label, max, true); }
function boundedText(value: unknown, label: string, max: number, allowEmpty = false): string { if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max || value.includes("\0")) throw new TypeError(`${label} is invalid`); return value; }
function assertEncodedBytes(value: JsonValue, max: number, label: string): void { if (new TextEncoder().encode(JSON.stringify(value)).byteLength > max) throw new TypeError(`${label} exceeds the encoded size limit`); }
