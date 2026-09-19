import {
	ENVIRONMENT_VARIABLE_NAME_PATTERN,
	EXTENSION_ID_PATTERN,
	EXTENSION_LIMITS,
	FILE_EXTENSION_PATTERN,
	isNamespacedId,
	LANGUAGE_ID_PATTERN,
	LOCAL_ID_PATTERN,
	PROVIDER_VAULT_BINDING_REF_PATTERN,
	PROVIDER_VAULT_KEY_PATTERN,
} from './constants.js';
import type {
	AgentSessionSnapshot,
	AgentSessionSourceContribution,
	AgentSessionSourceDiagnostic,
	ExtensionPermission,
	LanguageServerContribution,
	LanguageServerLaunch,
	McpInstallTargetActionResult,
	McpInstallTargetContribution,
	McpInstallTargetStatus,
	McpServerCommand,
	ProviderVaultPutRequest,
	ProviderVaultPutResult,
	ProviderVaultRemoveRequest,
	ProviderVaultRemoveResult,
	ProviderVaultWithSecretRequest,
	TerminayExtensionManifest,
} from './types.js';

export interface SchemaIssue {
	path: string;
	code: string;
	message: string;
}

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; issues: SchemaIssue[] };

const permissions = new Set<ExtensionPermission>([
	'configuration:read',
	'configuration:write',
	'data:read',
	'data:write',
	'cache:write',
	'network',
	'secrets:resolve',
	'agent-observation',
	'mcp-registration',
]);
const manifestKeys = new Set([
	'manifestVersion',
	'id',
	'displayName',
	'description',
	'api',
	'engines',
	'entrypoint',
	'platforms',
	'permissions',
	'extensionDependencies',
	'contributes',
]);
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function closed(
	value: Record<string, unknown>,
	allowed: Set<string>,
	path: string,
	out: SchemaIssue[],
): void {
	for (const key of Object.keys(value))
		if (!allowed.has(key))
			out.push({
				path: `${path}.${key}`,
				code: 'unknown_field',
				message: 'Unknown field',
			});
}
function string(
	value: unknown,
	path: string,
	out: SchemaIssue[],
	max: number = EXTENSION_LIMITS.stringLength,
): value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > max) {
		out.push({
			path,
			code: 'invalid_string',
			message: `Expected a non-empty string of at most ${max} characters`,
		});
		return false;
	}
	return true;
}
function boundedInteger(
	value: unknown,
	path: string,
	minimum: number,
	maximum: number,
	out: SchemaIssue[],
): value is number {
	if (
		!Number.isSafeInteger(value) ||
		(value as number) < minimum ||
		(value as number) > maximum
	) {
		out.push({
			path,
			code: 'invalid_integer',
			message: `Expected an integer from ${minimum} through ${maximum}`,
		});
		return false;
	}
	return true;
}
function unique(values: unknown[], path: string, out: SchemaIssue[]): void {
	const seen = new Set<unknown>();
	for (let index = 0; index < values.length; index++) {
		if (seen.has(values[index]))
			out.push({
				path: `${path}[${index}]`,
				code: 'duplicate',
				message: 'Duplicate value',
			});
		seen.add(values[index]);
	}
}
function relativeEntrypoint(value: unknown, out: SchemaIssue[]): void {
	if (!string(value, '$.entrypoint', out, 256)) return;
	if (
		value.startsWith('/') ||
		value.startsWith('\\') ||
		value.includes('\\') ||
		value.split('/').includes('..') ||
		!value.endsWith('.js')
	) {
		out.push({
			path: '$.entrypoint',
			code: 'unsafe_entrypoint',
			message:
				'Entrypoint must be a relative, non-escaping .js path using forward slashes',
		});
	}
}

export function validateExtensionManifest(
	value: unknown,
): ValidationResult<TerminayExtensionManifest> {
	const out: SchemaIssue[] = [];
	if (!record(value))
		return {
			ok: false,
			issues: [
				{ path: '$', code: 'invalid_type', message: 'Expected an object' },
			],
		};
	closed(value, manifestKeys, '$', out);
	if (value.manifestVersion !== 1)
		out.push({
			path: '$.manifestVersion',
			code: 'unsupported_version',
			message: 'Only manifest version 1 is supported',
		});
	if (
		string(value.id, '$.id', out, EXTENSION_LIMITS.extensionIdLength) &&
		!EXTENSION_ID_PATTERN.test(value.id)
	)
		out.push({
			path: '$.id',
			code: 'invalid_id',
			message: 'Use lowercase DNS-style characters',
		});
	string(
		value.displayName,
		'$.displayName',
		out,
		EXTENSION_LIMITS.displayNameLength,
	);
	if (value.description !== undefined)
		string(
			value.description,
			'$.description',
			out,
			EXTENSION_LIMITS.descriptionLength,
		);
	string(value.api, '$.api', out, 64);
	relativeEntrypoint(value.entrypoint, out);
	if (!record(value.engines))
		out.push({
			path: '$.engines',
			code: 'invalid_type',
			message: 'Expected an object',
		});
	else {
		closed(value.engines, new Set(['terminay', 'node']), '$.engines', out);
		string(value.engines.terminay, '$.engines.terminay', out, 64);
		string(value.engines.node, '$.engines.node', out, 64);
	}
	if (
		!Array.isArray(value.permissions) ||
		value.permissions.length > EXTENSION_LIMITS.permissions
	)
		out.push({
			path: '$.permissions',
			code: 'invalid_array',
			message: 'Expected a bounded permission array',
		});
	else {
		unique(value.permissions, '$.permissions', out);
		value.permissions.forEach((permission, index) => {
			if (!permissions.has(permission as ExtensionPermission))
				out.push({
					path: `$.permissions[${index}]`,
					code: 'unknown_permission',
					message: 'Unknown permission',
				});
		});
	}
	validatePlatforms(value.platforms, '$.platforms', out);
	if (value.extensionDependencies !== undefined)
		validateDependencies(value.extensionDependencies, out);
	if (!record(value.contributes))
		out.push({
			path: '$.contributes',
			code: 'invalid_type',
			message: 'Expected an object',
		});
	else {
		closed(
			value.contributes,
			new Set(['agentSessionSources', 'mcpInstallTargets', 'languageServers']),
			'$.contributes',
			out,
		);
		const extensionId = typeof value.id === 'string' ? value.id : '';
		const { agentSessionSources, mcpInstallTargets, languageServers } =
			value.contributes;
		if (
			agentSessionSources === undefined &&
			mcpInstallTargets === undefined &&
			languageServers === undefined
		) {
			out.push({
				path: '$.contributes',
				code: 'missing_contribution',
				message: 'Declare at least one supported contribution',
			});
		}
		if (agentSessionSources !== undefined)
			validateNamespacedContributions(
				agentSessionSources,
				'agentSessionSources',
				EXTENSION_LIMITS.contributions,
				extensionId,
				validateAgentSessionSourceContribution,
				out,
			);
		if (mcpInstallTargets !== undefined)
			validateNamespacedContributions(
				mcpInstallTargets,
				'mcpInstallTargets',
				EXTENSION_LIMITS.mcpInstallTargets,
				extensionId,
				validateMcpInstallTargetContribution,
				out,
			);
		if (languageServers !== undefined)
			validateLanguageServerContributions(languageServers, out);
		// The permission array validator reports a malformed array itself.
		if (Array.isArray(value.permissions)) {
			if (
				Array.isArray(agentSessionSources) &&
				agentSessionSources.length > 0 &&
				!value.permissions.includes('agent-observation')
			)
				out.push({
					path: '$.permissions',
					code: 'missing_permission',
					message: 'Agent session sources require agent-observation',
				});
			if (
				Array.isArray(mcpInstallTargets) &&
				mcpInstallTargets.length > 0 &&
				!value.permissions.includes('mcp-registration')
			)
				out.push({
					path: '$.permissions',
					code: 'missing_permission',
					message: 'MCP install targets require mcp-registration',
				});
		}
	}
	return out.length === 0
		? { ok: true, value: value as unknown as TerminayExtensionManifest }
		: { ok: false, issues: out };
}

function validateDependencies(value: unknown, out: SchemaIssue[]): void {
	if (!Array.isArray(value) || value.length > EXTENSION_LIMITS.dependencies) {
		out.push({
			path: '$.extensionDependencies',
			code: 'invalid_array',
			message: 'Expected a bounded dependency array',
		});
		return;
	}
	const ids: unknown[] = [];
	value.forEach((item, index) => {
		const path = `$.extensionDependencies[${index}]`;
		if (!record(item)) {
			out.push({ path, code: 'invalid_type', message: 'Expected an object' });
			return;
		}
		closed(item, new Set(['extensionId', 'apiRange', 'optional']), path, out);
		if (
			string(
				item.extensionId,
				`${path}.extensionId`,
				out,
				EXTENSION_LIMITS.extensionIdLength,
			) &&
			!EXTENSION_ID_PATTERN.test(item.extensionId)
		)
			out.push({
				path: `${path}.extensionId`,
				code: 'invalid_id',
				message: 'Invalid extension id',
			});
		string(item.apiRange, `${path}.apiRange`, out, 64);
		if (item.optional !== undefined && typeof item.optional !== 'boolean')
			out.push({
				path: `${path}.optional`,
				code: 'invalid_type',
				message: 'Expected boolean',
			});
		ids.push(item.extensionId);
	});
	unique(ids, '$.extensionDependencies', out);
}

function validateLanguageServerContributions(
	value: unknown,
	out: SchemaIssue[],
): void {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.maxLanguageServers
	) {
		out.push({
			path: '$.contributes.languageServers',
			code: 'invalid_array',
			message: 'Expected one or more bounded contributions',
		});
		return;
	}
	const ids: unknown[] = [];
	value.forEach((item, index) => {
		const result = validateLanguageServerContribution(item);
		if (!result.ok)
			out.push(
				...result.issues.map((issue) => ({
					...issue,
					path: `$.contributes.languageServers[${index}]${issue.path.slice(1)}`,
				})),
			);
		if (record(item)) ids.push(item.id);
	});
	unique(ids, '$.contributes.languageServers', out);
}

/** Validates a standalone language server manifest contribution. */
export function validateLanguageServerContribution(
	value: unknown,
): ValidationResult<LanguageServerContribution> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'id',
			'displayName',
			'description',
			'languageIds',
			'fileExtensions',
			'runtimeNotes',
		]),
		'$',
		out,
	);
	if (string(value.id, '$.id', out, 64) && !LOCAL_ID_PATTERN.test(value.id))
		out.push({
			path: '$.id',
			code: 'invalid_id',
			message: 'Language server id must be lower-case kebab-case',
		});
	string(
		value.displayName,
		'$.displayName',
		out,
		EXTENSION_LIMITS.displayNameLength,
	);
	if (value.description !== undefined)
		string(
			value.description,
			'$.description',
			out,
			EXTENSION_LIMITS.descriptionLength,
		);
	if (value.runtimeNotes !== undefined)
		string(
			value.runtimeNotes,
			'$.runtimeNotes',
			out,
			EXTENSION_LIMITS.descriptionLength,
		);
	validateBoundedStringList(
		value.languageIds,
		'$.languageIds',
		EXTENSION_LIMITS.maxLanguageIds,
		LANGUAGE_ID_PATTERN,
		'invalid_language_id',
		'Expected a language id such as typescript',
		out,
	);
	validateBoundedStringList(
		value.fileExtensions,
		'$.fileExtensions',
		EXTENSION_LIMITS.maxFileExtensions,
		FILE_EXTENSION_PATTERN,
		'invalid_file_extension',
		'Expected a lower-case extension beginning with a dot and free of slashes and whitespace',
		out,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as LanguageServerContribution }
		: { ok: false, issues: out };
}

function validateBoundedStringList(
	value: unknown,
	path: string,
	maximum: number,
	pattern: RegExp,
	code: string,
	message: string,
	out: SchemaIssue[],
): void {
	if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
		out.push({
			path,
			code: 'invalid_array',
			message: `Expected one to ${maximum} entries`,
		});
		return;
	}
	value.forEach((item, index) => {
		if (typeof item !== 'string' || !pattern.test(item))
			out.push({ path: `${path}[${index}]`, code, message });
	});
	unique(value, path, out);
}

/**
 * Validates a launch an extension returned. The host applies this before it
 * spawns anything: the launch is extension-authored data, never a command line
 * the host trusts unbounded.
 */
export function validateLanguageServerLaunch(
	value: unknown,
): ValidationResult<LanguageServerLaunch> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['command', 'args', 'env', 'initializationOptions', 'description']),
		'$',
		out,
	);
	if (
		string(value.command, '$.command', out, EXTENSION_LIMITS.stringLength) &&
		/[\r\n]/u.test(value.command)
	)
		out.push({
			path: '$.command',
			code: 'invalid_command',
			message: 'Command must be a single-line executable path or name',
		});
	if (
		!Array.isArray(value.args) ||
		value.args.length > EXTENSION_LIMITS.maxLaunchArgs
	)
		out.push({
			path: '$.args',
			code: 'invalid_array',
			message: `Expected at most ${EXTENSION_LIMITS.maxLaunchArgs} arguments`,
		});
	else
		value.args.forEach((argument, index) => {
			string(argument, `$.args[${index}]`, out);
		});
	if (value.env !== undefined) {
		if (!record(value.env))
			out.push({
				path: '$.env',
				code: 'invalid_type',
				message: 'Expected an object',
			});
		else {
			const entries = Object.entries(value.env);
			if (entries.length > EXTENSION_LIMITS.maxLaunchEnvEntries)
				out.push({
					path: '$.env',
					code: 'invalid_object',
					message: `Expected at most ${EXTENSION_LIMITS.maxLaunchEnvEntries} environment entries`,
				});
			for (const [name, entry] of entries) {
				if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name))
					out.push({
						path: `$.env.${name}`,
						code: 'invalid_environment_variable_name',
						message: 'Invalid environment variable name',
					});
				string(entry, `$.env.${name}`, out);
			}
		}
	}
	if (value.description !== undefined)
		string(
			value.description,
			'$.description',
			out,
			EXTENSION_LIMITS.maxLaunchDescriptionLength,
		);
	return out.length === 0
		? { ok: true, value: value as unknown as LanguageServerLaunch }
		: { ok: false, issues: out };
}

/** Validates a standalone agent-provider manifest contribution. */

function validateNamespacedContributions(
	value: unknown,
	key: 'agentSessionSources' | 'mcpInstallTargets',
	maximum: number,
	extensionId: string,
	validate: (item: unknown, extensionId: string) => ValidationResult<unknown>,
	out: SchemaIssue[],
): void {
	const path = `$.contributes.${key}`;
	if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
		out.push({
			path,
			code: 'invalid_array',
			message: 'Expected one or more bounded contributions',
		});
		return;
	}
	const ids: unknown[] = [];
	value.forEach((item, index) => {
		const result = validate(item, extensionId);
		if (!result.ok)
			out.push(
				...result.issues.map((issue) => ({
					...issue,
					path: `${path}[${index}]${issue.path.slice(1)}`,
				})),
			);
		if (record(item)) ids.push(item.id);
	});
	unique(ids, path, out);
}

function namespacedContributionId(
	value: unknown,
	extensionId: string,
	out: SchemaIssue[],
): void {
	if (
		string(value, '$.id', out, EXTENSION_LIMITS.providerIdLength) &&
		!isNamespacedId(value, extensionId)
	)
		out.push({
			path: '$.id',
			code: 'invalid_namespace',
			message: 'Contribution id must be namespaced by the extension id',
		});
}

/** Validates a standalone agent session source manifest contribution. */
export function validateAgentSessionSourceContribution(
	value: unknown,
	extensionId: string,
): ValidationResult<AgentSessionSourceContribution> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'id',
			'displayName',
			'description',
			'platforms',
			'harnesses',
			'environmentVariables',
		]),
		'$',
		out,
	);
	namespacedContributionId(value.id, extensionId, out);
	string(
		value.displayName,
		'$.displayName',
		out,
		EXTENSION_LIMITS.displayNameLength,
	);
	if (value.description !== undefined)
		string(
			value.description,
			'$.description',
			out,
			EXTENSION_LIMITS.descriptionLength,
		);
	validatePlatforms(value.platforms, '$.platforms', out);
	if (
		!Array.isArray(value.harnesses) ||
		value.harnesses.length === 0 ||
		value.harnesses.length > EXTENSION_LIMITS.agentSourceHarnesses
	) {
		out.push({
			path: '$.harnesses',
			code: 'invalid_array',
			message: 'Expected one or more bounded harnesses',
		});
	} else {
		const ids: unknown[] = [];
		value.harnesses.forEach((harness, index) => {
			const path = `$.harnesses[${index}]`;
			if (!record(harness)) {
				out.push({ path, code: 'invalid_type', message: 'Expected an object' });
				return;
			}
			closed(harness, new Set(['id', 'displayName']), path, out);
			localId(harness.id, `${path}.id`, out);
			string(
				harness.displayName,
				`${path}.displayName`,
				out,
				EXTENSION_LIMITS.displayNameLength,
			);
			ids.push(harness.id);
		});
		unique(ids, '$.harnesses', out);
	}
	validateEnvironmentVariableNamesInto(
		value.environmentVariables,
		'$.environmentVariables',
		out,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentSessionSourceContribution }
		: { ok: false, issues: out };
}

/** Validates a standalone MCP install target manifest contribution. */
export function validateMcpInstallTargetContribution(
	value: unknown,
	extensionId: string,
): ValidationResult<McpInstallTargetContribution> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['id', 'displayName']), '$', out);
	namespacedContributionId(value.id, extensionId, out);
	string(
		value.displayName,
		'$.displayName',
		out,
		EXTENSION_LIMITS.displayNameLength,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as McpInstallTargetContribution }
		: { ok: false, issues: out };
}

function localId(value: unknown, path: string, out: SchemaIssue[]): void {
	if (string(value, path, out, 64) && !LOCAL_ID_PATTERN.test(value))
		out.push({
			path,
			code: 'invalid_id',
			message: 'Use a lowercase kebab-case id',
		});
}

function optionalText(
	value: unknown,
	path: string,
	maximum: number,
	out: SchemaIssue[],
): void {
	if (value !== undefined) string(value, path, out, maximum);
}

function optionalEnum(
	value: unknown,
	path: string,
	allowed: readonly string[],
	out: SchemaIssue[],
): void {
	if (value !== undefined && !allowed.includes(value as string))
		out.push({
			path,
			code: 'invalid_enum',
			message: `Expected one of ${allowed.join(', ')}`,
		});
}

function absolutePath(value: unknown, path: string, out: SchemaIssue[]): void {
	if (
		string(value, path, out, EXTENSION_LIMITS.agentPathLength) &&
		(!value.startsWith('/') || value.includes('\0'))
	)
		out.push({
			path,
			code: 'invalid_path',
			message: 'Expected an absolute path',
		});
}

const sessionStatuses = ['running', 'waiting', 'blocked', 'idle'] as const;
const turnOutcomes = ['completed', 'failed', 'interrupted'] as const;
const subagentStatuses = [
	'running',
	'completed',
	'failed',
	'cancelled',
] as const;

/**
 * Validates one session snapshot before it crosses the host boundary. When
 * `harnesses` is given, the snapshot must name one of them: the source's
 * declared harnesses, or only those switched on.
 */
export function validateAgentSessionSnapshot(
	value: unknown,
	harnesses?: ReadonlySet<string> | readonly string[],
): ValidationResult<AgentSessionSnapshot> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'id',
			'harness',
			'pid',
			'cwd',
			'title',
			'model',
			'status',
			'waitingFor',
			'tool',
			'lastTurn',
			'lastTurnEndedAt',
			'error',
			'subagents',
		]),
		'$',
		out,
	);
	string(value.id, '$.id', out, EXTENSION_LIMITS.agentSessionIdLength);
	localId(value.harness, '$.harness', out);
	if (
		harnesses !== undefined &&
		typeof value.harness === 'string' &&
		!(harnesses instanceof Set
			? harnesses.has(value.harness)
			: (harnesses as readonly string[]).includes(value.harness))
	)
		out.push({
			path: '$.harness',
			code: 'harness_not_enabled',
			message: 'Harness is undeclared or switched off',
		});
	boundedInteger(value.pid, '$.pid', 1, 2 ** 31 - 1, out);
	absolutePath(value.cwd, '$.cwd', out);
	optionalText(value.title, '$.title', EXTENSION_LIMITS.agentTitleLength, out);
	optionalText(value.model, '$.model', EXTENSION_LIMITS.agentModelLength, out);
	optionalEnum(value.status, '$.status', sessionStatuses, out);
	optionalText(
		value.waitingFor,
		'$.waitingFor',
		EXTENSION_LIMITS.agentWaitingForLength,
		out,
	);
	optionalText(value.tool, '$.tool', EXTENSION_LIMITS.agentToolNameLength, out);
	optionalEnum(value.lastTurn, '$.lastTurn', turnOutcomes, out);
	if (value.lastTurnEndedAt !== undefined)
		boundedInteger(
			value.lastTurnEndedAt,
			'$.lastTurnEndedAt',
			0,
			Number.MAX_SAFE_INTEGER,
			out,
		);
	optionalText(value.error, '$.error', EXTENSION_LIMITS.agentErrorLength, out);
	if (value.subagents !== undefined) {
		if (
			!Array.isArray(value.subagents) ||
			value.subagents.length > EXTENSION_LIMITS.agentSubagents
		) {
			out.push({
				path: '$.subagents',
				code: 'invalid_array',
				message: 'Expected a bounded subagent array',
			});
		} else {
			const ids: unknown[] = [];
			value.subagents.forEach((subagent, index) => {
				const path = `$.subagents[${index}]`;
				if (!record(subagent)) {
					out.push({
						path,
						code: 'invalid_type',
						message: 'Expected an object',
					});
					return;
				}
				closed(
					subagent,
					new Set(['id', 'parentId', 'type', 'title', 'status']),
					path,
					out,
				);
				string(
					subagent.id,
					`${path}.id`,
					out,
					EXTENSION_LIMITS.agentSessionIdLength,
				);
				optionalText(
					subagent.parentId,
					`${path}.parentId`,
					EXTENSION_LIMITS.agentSessionIdLength,
					out,
				);
				string(
					subagent.type,
					`${path}.type`,
					out,
					EXTENSION_LIMITS.agentSubagentTypeLength,
				);
				optionalText(
					subagent.title,
					`${path}.title`,
					EXTENSION_LIMITS.agentTitleLength,
					out,
				);
				if (!subagentStatuses.includes(subagent.status as never))
					out.push({
						path: `${path}.status`,
						code: 'invalid_enum',
						message: `Expected one of ${subagentStatuses.join(', ')}`,
					});
				ids.push(subagent.id);
			});
			unique(ids, '$.subagents', out);
		}
	}
	return out.length === 0
		? { ok: true, value: value as unknown as AgentSessionSnapshot }
		: { ok: false, issues: out };
}

/** Validates a full reset: bounded, and no session id reported twice. */
export function validateAgentSessionReset(
	value: unknown,
	harnesses?: ReadonlySet<string> | readonly string[],
): ValidationResult<AgentSessionSnapshot[]> {
	const out: SchemaIssue[] = [];
	if (
		!Array.isArray(value) ||
		value.length > EXTENSION_LIMITS.agentSessionsPerReset
	)
		return {
			ok: false,
			issues: [
				{
					path: '$',
					code: 'invalid_array',
					message: 'Expected a bounded session array',
				},
			],
		};
	const ids: unknown[] = [];
	value.forEach((session, index) => {
		const result = validateAgentSessionSnapshot(session, harnesses);
		if (!result.ok)
			out.push(
				...result.issues.map((issue) => ({
					...issue,
					path: `$[${index}]${issue.path.slice(1)}`,
				})),
			);
		if (record(session)) ids.push(session.id);
	});
	unique(ids, '$', out);
	return out.length === 0
		? { ok: true, value: value as AgentSessionSnapshot[] }
		: { ok: false, issues: out };
}

/** Validates a session source diagnostic: a kebab-case code and a bounded message. */
export function validateAgentSessionSourceDiagnostic(
	value: unknown,
): ValidationResult<AgentSessionSourceDiagnostic> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['code', 'message']), '$', out);
	if (
		string(
			value.code,
			'$.code',
			out,
			EXTENSION_LIMITS.agentDiagnosticCodeLength,
		) &&
		!LOCAL_ID_PATTERN.test(value.code)
	)
		out.push({
			path: '$.code',
			code: 'invalid_id',
			message: 'Use a lowercase kebab-case code',
		});
	string(
		value.message,
		'$.message',
		out,
		EXTENSION_LIMITS.agentDiagnosticLength,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentSessionSourceDiagnostic }
		: { ok: false, issues: out };
}

/** Validates the host-supplied Terminay MCP server command. */
export function validateMcpServerCommand(
	value: unknown,
): ValidationResult<McpServerCommand> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['command', 'args', 'env']), '$', out);
	string(value.command, '$.command', out, EXTENSION_LIMITS.mcpCommandLength);
	if (
		!Array.isArray(value.args) ||
		value.args.length > EXTENSION_LIMITS.mcpCommandArgs
	)
		out.push({
			path: '$.args',
			code: 'invalid_array',
			message: 'Expected a bounded argument array',
		});
	else
		value.args.forEach((arg, index) => {
			string(arg, `$.args[${index}]`, out, EXTENSION_LIMITS.mcpCommandLength);
		});
	if (value.env !== undefined) {
		if (
			!record(value.env) ||
			Object.keys(value.env).length > EXTENSION_LIMITS.mcpCommandEnvEntries
		)
			out.push({
				path: '$.env',
				code: 'invalid_type',
				message: 'Expected a bounded environment object',
			});
		else
			for (const [name, entry] of Object.entries(value.env)) {
				validateEnvironmentVariableName(name, `$.env.${name}`, out);
				if (
					typeof entry !== 'string' ||
					entry.length > EXTENSION_LIMITS.mcpCommandLength
				)
					out.push({
						path: `$.env.${name}`,
						code: 'invalid_string',
						message: 'Expected a bounded string',
					});
			}
	}
	return out.length === 0
		? { ok: true, value: value as unknown as McpServerCommand }
		: { ok: false, issues: out };
}

const mcpStates = [
	'not-installed',
	'installed',
	'changed',
	'unavailable',
	'error',
] as const;

/** Validates what an MCP install target returns from `status`. */
export function validateMcpInstallTargetStatus(
	value: unknown,
): ValidationResult<McpInstallTargetStatus> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['state', 'configPath', 'message']), '$', out);
	if (!mcpStates.includes(value.state as never))
		out.push({
			path: '$.state',
			code: 'invalid_enum',
			message: `Expected one of ${mcpStates.join(', ')}`,
		});
	string(
		value.configPath,
		'$.configPath',
		out,
		EXTENSION_LIMITS.mcpConfigPathLength,
	);
	optionalText(
		value.message,
		'$.message',
		EXTENSION_LIMITS.mcpMessageLength,
		out,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as McpInstallTargetStatus }
		: { ok: false, issues: out };
}

/** Validates what an MCP install target returns from `install` or `uninstall`. */
export function validateMcpInstallTargetActionResult(
	value: unknown,
): ValidationResult<McpInstallTargetActionResult> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['ok', 'installed', 'message', 'error']), '$', out);
	for (const key of ['ok', 'installed'] as const)
		if (typeof value[key] !== 'boolean')
			out.push({
				path: `$.${key}`,
				code: 'invalid_type',
				message: 'Expected boolean',
			});
	optionalText(
		value.message,
		'$.message',
		EXTENSION_LIMITS.mcpMessageLength,
		out,
	);
	optionalText(value.error, '$.error', EXTENSION_LIMITS.mcpMessageLength, out);
	return out.length === 0
		? { ok: true, value: value as unknown as McpInstallTargetActionResult }
		: { ok: false, issues: out };
}

function validatePlatforms(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
		out.push({
			path,
			code: 'invalid_array',
			message: 'Expected a bounded platform array',
		});
		return;
	}
	unique(value, path, out);
	value.forEach((item, index) => {
		if (!['darwin', 'linux', 'win32'].includes(String(item))) {
			out.push({
				path: `${path}[${index}]`,
				code: 'invalid_platform',
				message: 'Unsupported platform metadata',
			});
		}
	});
}

function validateEnvironmentVariableNamesInto(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (value === undefined) return;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.agentEnvironmentVariables
	) {
		out.push({
			path,
			code: 'invalid_array',
			message: 'Expected bounded environment-variable names',
		});
	} else {
		unique(value, path, out);
		value.forEach((name, index) => {
			validateEnvironmentVariableName(name, `${path}[${index}]`, out);
		});
	}
}

/** Validates one closed process-environment request before host routing. */

function validateEnvironmentVariableName(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (
		string(
			value,
			path,
			out,
			EXTENSION_LIMITS.agentEnvironmentVariableNameLength,
		) &&
		!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(value)
	) {
		out.push({
			path,
			code: 'invalid_environment_variable',
			message: 'Expected an identifier-like environment-variable name',
		});
	}
}

export function validateProviderVaultPutRequest(
	value: unknown,
): ValidationResult<ProviderVaultPutRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'bindingKey',
			'purpose',
			'value',
			'idempotencyKey',
			'expectedRevision',
		]),
		'$',
		out,
	);
	vaultKey(
		value.bindingKey,
		'$.bindingKey',
		EXTENSION_LIMITS.providerVaultBindingKeyLength,
		out,
	);
	vaultKey(
		value.purpose,
		'$.purpose',
		EXTENSION_LIMITS.providerVaultPurposeLength,
		out,
	);
	bytes(value.value, '$.value', EXTENSION_LIMITS.providerVaultSecretBytes, out);
	string(
		value.idempotencyKey,
		'$.idempotencyKey',
		out,
		EXTENSION_LIMITS.providerVaultIdempotencyKeyLength,
	);
	validateExpectedRevision(value.expectedRevision, '$.expectedRevision', out);
	return out.length === 0
		? { ok: true, value: value as unknown as ProviderVaultPutRequest }
		: { ok: false, issues: out };
}

/** Validates a local callback's opaque binding and purpose request. */
export function validateProviderVaultWithSecretRequest(
	value: unknown,
): ValidationResult<ProviderVaultWithSecretRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['binding', 'purpose']), '$', out);
	validateProviderVaultBindingInto(value.binding, '$.binding', out);
	vaultKey(
		value.purpose,
		'$.purpose',
		EXTENSION_LIMITS.providerVaultPurposeLength,
		out,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as ProviderVaultWithSecretRequest }
		: { ok: false, issues: out };
}

/** Validates an atomic target-vault removal request. */
export function validateProviderVaultRemoveRequest(
	value: unknown,
): ValidationResult<ProviderVaultRemoveRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['binding', 'idempotencyKey', 'expectedRevision']),
		'$',
		out,
	);
	validateProviderVaultBindingInto(value.binding, '$.binding', out);
	string(
		value.idempotencyKey,
		'$.idempotencyKey',
		out,
		EXTENSION_LIMITS.providerVaultIdempotencyKeyLength,
	);
	validateExpectedRevision(value.expectedRevision, '$.expectedRevision', out);
	return out.length === 0
		? { ok: true, value: value as unknown as ProviderVaultRemoveRequest }
		: { ok: false, issues: out };
}

/** Validates metadata-only results of target vault calls. */
export function validateProviderVaultPutResult(
	value: unknown,
): ValidationResult<ProviderVaultPutResult> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['binding', 'revision']), '$', out);
	validateProviderVaultBindingInto(value.binding, '$.binding', out);
	validateRevision(value.revision, '$.revision', out);
	return out.length === 0
		? { ok: true, value: value as unknown as ProviderVaultPutResult }
		: { ok: false, issues: out };
}

/** Validates metadata-only removal state. */
export function validateProviderVaultRemoveResult(
	value: unknown,
): ValidationResult<ProviderVaultRemoveResult> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['state']), '$', out);
	if (value.state !== 'deleted' && value.state !== 'pending')
		out.push({
			path: '$.state',
			code: 'invalid_state',
			message: 'Expected deleted or pending vault removal state',
		});
	return out.length === 0
		? { ok: true, value: value as unknown as ProviderVaultRemoveResult }
		: { ok: false, issues: out };
}

function validateExpectedRevision(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (
		value !== undefined &&
		(!Number.isSafeInteger(value) || Number(value) < 0)
	)
		out.push({
			path,
			code: 'invalid_revision',
			message: 'Expected a non-negative integer',
		});
}

function validateRevision(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		out.push({
			path,
			code: 'invalid_revision',
			message: 'Expected a non-negative integer',
		});
}

function vaultKey(
	value: unknown,
	path: string,
	maximum: number,
	out: SchemaIssue[],
): void {
	if (
		string(value, path, out, maximum) &&
		!PROVIDER_VAULT_KEY_PATTERN.test(value)
	)
		out.push({
			path,
			code: 'invalid_vault_key',
			message: 'Expected a bounded provider-owned vault key',
		});
}

function validateProviderVaultBindingInto(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!record(value)) {
		out.push({
			path,
			code: 'invalid_binding',
			message: 'Expected an opaque vault binding',
		});
		return;
	}
	closed(value, new Set(['bindingRef']), path, out);
	if (
		string(
			value.bindingRef,
			`${path}.bindingRef`,
			out,
			EXTENSION_LIMITS.providerVaultBindingRefLength,
		) &&
		!PROVIDER_VAULT_BINDING_REF_PATTERN.test(value.bindingRef)
	) {
		out.push({
			path: `${path}.bindingRef`,
			code: 'invalid_binding',
			message: 'Expected a bounded opaque vault binding reference',
		});
	}
}

/** Validates provider-owned JSON returned through the target dependency boundary. */
function invalidObject<T>(): ValidationResult<T> {
	return {
		ok: false,
		issues: [
			{ path: '$', code: 'invalid_type', message: 'Expected an object' },
		],
	};
}
function bytes(
	value: unknown,
	path: string,
	maximum: number,
	out: SchemaIssue[],
): void {
	if (
		!(value instanceof Uint8Array) ||
		value.byteLength === 0 ||
		value.byteLength > maximum
	)
		out.push({
			path,
			code: 'invalid_bytes',
			message: `Expected 1-${maximum} bytes`,
		});
}

export function parseExtensionManifest(
	value: unknown,
): TerminayExtensionManifest {
	const result = validateExtensionManifest(value);
	if (!result.ok)
		throw new ExtensionSchemaError(
			'Invalid Terminay extension manifest',
			result.issues,
		);
	return result.value;
}

export class ExtensionSchemaError extends Error {
	constructor(
		message: string,
		readonly issues: SchemaIssue[],
	) {
		super(message);
		this.name = 'ExtensionSchemaError';
	}
}

export function assertManifestMatchesPackage(
	manifest: TerminayExtensionManifest,
	packageJson: unknown,
): void {
	if (!record(packageJson))
		throw new ExtensionSchemaError('Invalid package.json', [
			{ path: '$', code: 'invalid_type', message: 'Expected object' },
		]);
	if (
		typeof packageJson.name !== 'string' ||
		typeof packageJson.version !== 'string'
	)
		throw new ExtensionSchemaError('Invalid package identity', [
			{
				path: '$',
				code: 'missing_package_identity',
				message: 'Package name and version are required',
			},
		]);
	if (!record(packageJson.exports))
		throw new ExtensionSchemaError('Missing package exports', [
			{
				path: '$.exports',
				code: 'missing_exports',
				message: 'Extension entrypoint must be exported',
			},
		]);
	const exported = Object.values(packageJson.exports).some(
		(entry) =>
			entry === `./${manifest.entrypoint}` ||
			(record(entry) &&
				Object.values(entry).includes(`./${manifest.entrypoint}`)),
	);
	if (!exported)
		throw new ExtensionSchemaError('Entrypoint is not exported', [
			{
				path: '$.exports',
				code: 'entrypoint_not_exported',
				message: manifest.entrypoint,
			},
		]);
}
