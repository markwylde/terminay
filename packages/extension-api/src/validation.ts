import {
	ENVIRONMENT_VARIABLE_NAME_PATTERN,
	EXTENSION_ID_PATTERN,
	EXTENSION_LIMITS,
	isNamespacedId,
	PROVIDER_VAULT_BINDING_REF_PATTERN,
	PROVIDER_VAULT_KEY_PATTERN,
} from './constants.js';
import type {
	AgentBindingFingerprint,
	AgentChildJournalSource,
	AgentDirectoryListOptions,
	AgentEnvironmentRelativePathRequest,
	AgentHomeRelativeFileRequest,
	AgentHomeRelativePathRequest,
	AgentLifecycleEvent,
	AgentModelMetadata,
	AgentObservationDiagnostic,
	AgentPathUnderEnvironmentRequest,
	AgentPathUnderHomeRequest,
	AgentProcessEnvironmentRequest,
	AgentProviderContribution,
	AgentProviderDefinition,
	AgentRelativeToEnvironmentRequest,
	AgentSessionBindingRequest,
	AgentTerminalTtyFact,
	ExtensionPermission,
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
			new Set(['agentProviders']),
			'$.contributes',
			out,
		);
		const extensionId = typeof value.id === 'string' ? value.id : '';
		const agentProviders = value.contributes.agentProviders;
		if (agentProviders === undefined) {
			out.push({
				path: '$.contributes',
				code: 'missing_contribution',
				message: 'Declare at least one supported contribution',
			});
		}
		if (agentProviders !== undefined)
			validateAgentContributions(agentProviders, extensionId, out);
		if (
			Array.isArray(agentProviders) &&
			agentProviders.length > 0 &&
			!Array.isArray(value.permissions)
		) {
			// The permission array validator reports the more specific type error.
		} else if (
			Array.isArray(agentProviders) &&
			agentProviders.length > 0 &&
			Array.isArray(value.permissions) &&
			!value.permissions.includes('agent-observation')
		) {
			out.push({
				path: '$.permissions',
				code: 'missing_permission',
				message: 'Agent providers require agent-observation',
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

function validateAgentContributions(
	value: unknown,
	extensionId: string,
	out: SchemaIssue[],
): void {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.contributions
	) {
		out.push({
			path: '$.contributes.agentProviders',
			code: 'invalid_array',
			message: 'Expected one or more bounded contributions',
		});
		return;
	}
	const ids: unknown[] = [];
	value.forEach((item, index) => {
		const result = validateAgentProviderContribution(item, extensionId);
		if (!result.ok)
			out.push(
				...result.issues.map((issue) => ({
					...issue,
					path: `$.contributes.agentProviders[${index}]${issue.path.slice(1)}`,
				})),
			);
		if (record(item)) ids.push(item.id);
	});
	unique(ids, '$.contributes.agentProviders', out);
}

/** Validates a standalone agent-provider manifest contribution. */
export function validateAgentProviderContribution(
	value: unknown,
	extensionId: string,
): ValidationResult<AgentProviderContribution> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'id',
			'displayName',
			'description',
			'icon',
			'platforms',
			'processMatchers',
			'mappings',
			'requiredEnvironmentVariables',
		]),
		'$',
		out,
	);
	if (
		string(value.id, '$.id', out, EXTENSION_LIMITS.providerIdLength) &&
		!isNamespacedId(value.id, extensionId)
	) {
		out.push({
			path: '$.id',
			code: 'invalid_namespace',
			message: 'Provider id must be namespaced by the extension id',
		});
	}
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
	if (
		value.icon !== undefined &&
		![
			'terminal',
			'server',
			'cloud',
			'key',
			'folder',
			'network',
			'database',
			'warning',
			'info',
		].includes(String(value.icon))
	) {
		out.push({
			path: '$.icon',
			code: 'invalid_icon',
			message: 'Unsupported icon',
		});
	}
	validatePlatforms(value.platforms, '$.platforms', out);
	validateAgentProcessMatchers(value.processMatchers, out);
	validateAgentMappings(value.mappings, out);
	validateAgentEnvironmentVariableNamesInto(
		value.requiredEnvironmentVariables,
		'$.requiredEnvironmentVariables',
		out,
		true,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentProviderContribution }
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

function validateAgentProcessMatchers(
	value: unknown,
	out: SchemaIssue[],
): void {
	if (value === undefined) return;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.agentProcessMatchers
	) {
		out.push({
			path: '$.processMatchers',
			code: 'invalid_array',
			message: 'Expected bounded process matchers',
		});
		return;
	}
	const identities: unknown[] = [];
	value.forEach((matcher, index) => {
		const path = `$.processMatchers[${index}]`;
		if (!record(matcher)) {
			out.push({ path, code: 'invalid_type', message: 'Expected an object' });
			return;
		}
		closed(matcher, new Set(['executableName', 'arguments']), path, out);
		if (
			string(matcher.executableName, `${path}.executableName`, out, 128) &&
			/[\\/\0\r\n]/.test(matcher.executableName)
		) {
			out.push({
				path: `${path}.executableName`,
				code: 'invalid_matcher',
				message: 'Executable name must not contain a path or control character',
			});
		}
		if (matcher.arguments !== undefined) {
			if (!Array.isArray(matcher.arguments) || matcher.arguments.length > 16)
				out.push({
					path: `${path}.arguments`,
					code: 'invalid_array',
					message: 'Expected bounded argument tokens',
				});
			else
				matcher.arguments.forEach((argument, argumentIndex) => {
					string(argument, `${path}.arguments[${argumentIndex}]`, out, 256);
				});
		}
		identities.push(
			JSON.stringify([matcher.executableName, matcher.arguments]),
		);
	});
	unique(identities, '$.processMatchers', out);
}

function validateAgentMappings(value: unknown, out: SchemaIssue[]): void {
	if (value === undefined) return;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > EXTENSION_LIMITS.agentMappings
	) {
		out.push({
			path: '$.mappings',
			code: 'invalid_array',
			message: 'Expected bounded mapping declarations',
		});
		return;
	}
	const versions: unknown[] = [];
	value.forEach((mapping, index) => {
		const path = `$.mappings[${index}]`;
		if (!record(mapping)) {
			out.push({ path, code: 'invalid_type', message: 'Expected an object' });
			return;
		}
		closed(
			mapping,
			new Set(['mappingVersion', 'providerVersionRange']),
			path,
			out,
		);
		string(
			mapping.mappingVersion,
			`${path}.mappingVersion`,
			out,
			EXTENSION_LIMITS.agentProviderVersionLength,
		);
		string(
			mapping.providerVersionRange,
			`${path}.providerVersionRange`,
			out,
			EXTENSION_LIMITS.agentProviderVersionLength,
		);
		versions.push(mapping.mappingVersion);
	});
	unique(versions, '$.mappings', out);
}

/** Validates a declared/requested bounded environment-variable name list. */
export function validateAgentEnvironmentVariableNames(
	value: unknown,
): ValidationResult<string[]> {
	const out: SchemaIssue[] = [];
	validateAgentEnvironmentVariableNamesInto(value, '$.names', out);
	return out.length === 0
		? { ok: true, value: value as string[] }
		: { ok: false, issues: out };
}

function validateAgentEnvironmentVariableNamesInto(
	value: unknown,
	path: string,
	out: SchemaIssue[],
	optional = false,
): void {
	if (value === undefined && optional) return;
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
export function validateAgentProcessEnvironmentRequest(
	value: unknown,
): ValidationResult<AgentProcessEnvironmentRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['names']), '$', out);
	validateAgentEnvironmentVariableNamesInto(value.names, '$.names', out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentProcessEnvironmentRequest }
		: { ok: false, issues: out };
}

/** Validates bounded values returned from terminal-scoped process observation. */
export function validateAgentObservedEnvironment(
	value: unknown,
	requestedNames?: readonly string[],
): ValidationResult<Record<string, string>> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	const requested =
		requestedNames === undefined ? undefined : new Set(requestedNames);
	const entries = Object.entries(value);
	if (entries.length > EXTENSION_LIMITS.agentEnvironmentVariables)
		out.push({
			path: '$',
			code: 'limit_exceeded',
			message: 'Too many observed environment variables',
		});
	entries.forEach(([name, observed]) => {
		validateEnvironmentVariableName(name, `$.${name}`, out);
		if (requested !== undefined && !requested.has(name))
			out.push({
				path: `$.${name}`,
				code: 'undeclared_environment_variable',
				message: 'Observed variable was not requested',
			});
		if (
			typeof observed !== 'string' ||
			observed.length > EXTENSION_LIMITS.agentEnvironmentVariableValueLength
		) {
			out.push({
				path: `$.${name}`,
				code: 'invalid_environment_value',
				message: `Expected a string of at most ${EXTENSION_LIMITS.agentEnvironmentVariableValueLength} characters`,
			});
		}
	});
	return out.length === 0
		? { ok: true, value: value as Record<string, string> }
		: { ok: false, issues: out };
}

/** Validates a known path resolved below one declared terminal environment value. */
export function validateAgentRelativeToEnvironmentRequest(
	value: unknown,
): ValidationResult<AgentRelativeToEnvironmentRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['relativePath', 'environmentVariable', 'extension']),
		'$',
		out,
	);
	validateHomeRelativePath(value.relativePath, '$.relativePath', out);
	validateEnvironmentVariableName(
		value.environmentVariable,
		'$.environmentVariable',
		out,
	);
	if (value.extension !== undefined)
		validateFileExtension(value.extension, '$.extension', out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentRelativeToEnvironmentRequest }
		: { ok: false, issues: out };
}

/** Validates provider-record path data constrained by one declared terminal environment value. */
export function validateAgentPathUnderEnvironmentRequest(
	value: unknown,
): ValidationResult<AgentPathUnderEnvironmentRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'providerPath',
			'environmentVariable',
			'beneathRelative',
			'extension',
		]),
		'$',
		out,
	);
	if (
		string(
			value.providerPath,
			'$.providerPath',
			out,
			EXTENSION_LIMITS.agentProviderPathLength,
		)
	) {
		if (
			!isAbsoluteProviderPath(value.providerPath) ||
			/[\0\r\n]/.test(value.providerPath)
		)
			out.push({
				path: '$.providerPath',
				code: 'unsafe_path',
				message: 'Expected a bounded absolute provider-record path',
			});
	}
	validateEnvironmentVariableName(
		value.environmentVariable,
		'$.environmentVariable',
		out,
	);
	if (value.beneathRelative !== undefined)
		validateHomeRelativePath(value.beneathRelative, '$.beneathRelative', out);
	if (value.extension !== undefined)
		validateFileExtension(value.extension, '$.extension', out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentPathUnderEnvironmentRequest }
		: { ok: false, issues: out };
}

/** Validates a fact-only path lookup below one declared terminal environment value. */
export function validateAgentEnvironmentRelativePathRequest(
	value: unknown,
): ValidationResult<AgentEnvironmentRelativePathRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['handle', 'environmentVariable', 'beneathRelative']),
		'$',
		out,
	);
	validateOpaqueHandle(value.handle, '$.handle', out);
	validateEnvironmentVariableName(
		value.environmentVariable,
		'$.environmentVariable',
		out,
	);
	if (value.beneathRelative !== undefined)
		validateHomeRelativePath(value.beneathRelative, '$.beneathRelative', out);
	return out.length === 0
		? {
				ok: true,
				value: value as unknown as AgentEnvironmentRelativePathRequest,
			}
		: { ok: false, issues: out };
}

/** Validates a normalized non-escaping relative path fact returned by the host. */
export function validateAgentEnvironmentRelativePath(
	value: unknown,
): ValidationResult<string> {
	const out: SchemaIssue[] = [];
	validateEnvironmentRelativePath(value, '$', out);
	return out.length === 0
		? { ok: true, value: value as string }
		: { ok: false, issues: out };
}

function validateEnvironmentRelativePath(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (
		!string(
			value,
			path,
			out,
			EXTENSION_LIMITS.agentEnvironmentRelativePathLength,
		)
	)
		return;
	if (
		value.startsWith('/') ||
		value.startsWith('\\') ||
		value.includes('\\') ||
		value
			.split('/')
			.some((part) => part === '' || part === '.' || part === '..')
	) {
		out.push({
			path,
			code: 'unsafe_path',
			message: 'Expected a normalized non-escaping relative path',
		});
	}
}

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

/** Validates display-only model metadata before it crosses the host boundary. */
export function validateAgentModelMetadata(
	value: unknown,
): ValidationResult<AgentModelMetadata> {
	const out: SchemaIssue[] = [];
	validateAgentModelMetadataInto(value, '$', out);
	return out.length === 0
		? { ok: true, value: value as AgentModelMetadata }
		: { ok: false, issues: out };
}

function validateAgentModelMetadataInto(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!record(value)) {
		out.push({ path, code: 'invalid_type', message: 'Expected an object' });
		return;
	}
	closed(
		value,
		new Set(['id', 'displayName', 'reasoningEffort', 'contextWindowTokens']),
		path,
		out,
	);
	string(value.id, `${path}.id`, out, EXTENSION_LIMITS.agentNativeIdLength);
	if (value.displayName !== undefined)
		string(
			value.displayName,
			`${path}.displayName`,
			out,
			EXTENSION_LIMITS.displayNameLength,
		);
	if (value.reasoningEffort !== undefined)
		string(value.reasoningEffort, `${path}.reasoningEffort`, out, 64);
	if (
		value.contextWindowTokens !== undefined &&
		(!Number.isSafeInteger(value.contextWindowTokens) ||
			Number(value.contextWindowTokens) < 1 ||
			Number(value.contextWindowTokens) > 16 * 1024 * 1024)
	) {
		out.push({
			path: `${path}.contextWindowTokens`,
			code: 'invalid_number',
			message: 'Context window must be a bounded positive integer',
		});
	}
}

/** Validates evidence used for a terminal-scoped provider session binding. */
export function validateAgentSessionBindingRequest(
	value: unknown,
): ValidationResult<AgentSessionBindingRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set([
			'providerSessionId',
			'mappingVersion',
			'journal',
			'fingerprint',
			'metadata',
		]),
		'$',
		out,
	);
	string(
		value.providerSessionId,
		'$.providerSessionId',
		out,
		EXTENSION_LIMITS.agentSessionIdLength,
	);
	string(
		value.mappingVersion,
		'$.mappingVersion',
		out,
		EXTENSION_LIMITS.agentProviderVersionLength,
	);
	if (value.journal !== undefined)
		validateOpaqueHandle(value.journal, '$.journal', out);
	validateAgentBindingFingerprintInto(value.fingerprint, '$.fingerprint', out);
	if (value.metadata !== undefined)
		validatePrimitiveMap(
			value.metadata,
			'$.metadata',
			EXTENSION_LIMITS.agentMetadataEntries,
			out,
		);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentSessionBindingRequest }
		: { ok: false, issues: out };
}

export function validateAgentBindingFingerprint(
	value: unknown,
): ValidationResult<AgentBindingFingerprint> {
	const out: SchemaIssue[] = [];
	validateAgentBindingFingerprintInto(value, '$', out);
	return out.length === 0
		? { ok: true, value: value as AgentBindingFingerprint }
		: { ok: false, issues: out };
}

/** Validates a bounded terminal device fact without treating it as a path. */
export function validateAgentTerminalTtyFact(
	value: unknown,
): ValidationResult<AgentTerminalTtyFact> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['deviceId', 'deviceName']), '$', out);
	string(
		value.deviceId,
		'$.deviceId',
		out,
		EXTENSION_LIMITS.agentTtyDeviceIdLength,
	);
	if (value.deviceName !== undefined)
		string(
			value.deviceName,
			'$.deviceName',
			out,
			EXTENSION_LIMITS.agentTtyDeviceNameLength,
		);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentTerminalTtyFact }
		: { ok: false, issues: out };
}

/**
 * Validates a known home-relative resolution request. Absolute paths,
 * backslashes, traversal, and extension escapes are rejected before routing to
 * an environment broker.
 */
export function validateAgentHomeRelativeFileRequest(
	value: unknown,
): ValidationResult<AgentHomeRelativeFileRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['relativePath', 'beneath', 'extension']), '$', out);
	validateHomeRelativePath(value.relativePath, '$.relativePath', out);
	if (value.beneath !== undefined) {
		if (!record(value.beneath))
			out.push({
				path: '$.beneath',
				code: 'invalid_type',
				message: 'Expected a home-relative constraint',
			});
		else {
			closed(value.beneath, new Set(['homeRelative']), '$.beneath', out);
			validateHomeRelativePath(
				value.beneath.homeRelative,
				'$.beneath.homeRelative',
				out,
			);
		}
	}
	if (value.extension !== undefined)
		validateFileExtension(value.extension, '$.extension', out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentHomeRelativeFileRequest }
		: { ok: false, issues: out };
}

/**
 * Validates one provider-record path that the host may canonicalize only under
 * a declared home-relative root. The provider path is data, never authority.
 */
export function validateAgentPathUnderHomeRequest(
	value: unknown,
): ValidationResult<AgentPathUnderHomeRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['providerPath', 'beneath', 'extension']), '$', out);
	if (
		string(
			value.providerPath,
			'$.providerPath',
			out,
			EXTENSION_LIMITS.agentProviderPathLength,
		)
	) {
		if (
			!isAbsoluteProviderPath(value.providerPath) ||
			/[\0\r\n]/.test(value.providerPath)
		)
			out.push({
				path: '$.providerPath',
				code: 'unsafe_path',
				message: 'Expected a bounded absolute provider-record path',
			});
	}
	if (!record(value.beneath))
		out.push({
			path: '$.beneath',
			code: 'invalid_type',
			message: 'Expected an explicit home-relative constraint',
		});
	else {
		closed(value.beneath, new Set(['homeRelative']), '$.beneath', out);
		validateHomeRelativePath(
			value.beneath.homeRelative,
			'$.beneath.homeRelative',
			out,
		);
	}
	if (value.extension !== undefined)
		validateFileExtension(value.extension, '$.extension', out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentPathUnderHomeRequest }
		: { ok: false, issues: out };
}

/** Validates a fact-only normalized path lookup for an opaque file handle. */
export function validateAgentHomeRelativePathRequest(
	value: unknown,
): ValidationResult<AgentHomeRelativePathRequest> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['handle', 'beneath']), '$', out);
	validateOpaqueHandle(value.handle, '$.handle', out);
	if (!record(value.beneath))
		out.push({
			path: '$.beneath',
			code: 'invalid_type',
			message: 'Expected an explicit home-relative constraint',
		});
	else {
		closed(value.beneath, new Set(['homeRelative']), '$.beneath', out);
		validateHomeRelativePath(
			value.beneath.homeRelative,
			'$.beneath.homeRelative',
			out,
		);
	}
	return out.length === 0
		? { ok: true, value: value as unknown as AgentHomeRelativePathRequest }
		: { ok: false, issues: out };
}

/** Validates bounded opaque-directory discovery without accepting paths. */
export function validateAgentDirectoryListOptions(
	value: unknown,
): ValidationResult<AgentDirectoryListOptions> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['extensions', 'maxDepth', 'maxEntries', 'maxBytes']),
		'$',
		out,
	);
	const extensions = value.extensions;
	if (
		!Array.isArray(extensions) ||
		extensions.length === 0 ||
		extensions.length > 16
	) {
		out.push({
			path: '$.extensions',
			code: 'invalid_array',
			message: 'Expected bounded file suffixes',
		});
	} else {
		unique(extensions, '$.extensions', out);
		extensions.forEach((extension, index) => {
			validateFileExtension(extension, `$.extensions[${index}]`, out);
		});
	}
	boundedInteger(
		value.maxDepth,
		'$.maxDepth',
		0,
		EXTENSION_LIMITS.agentDirectoryListDepth,
		out,
	);
	boundedInteger(
		value.maxEntries,
		'$.maxEntries',
		1,
		EXTENSION_LIMITS.agentDirectoryListEntries,
		out,
	);
	boundedInteger(
		value.maxBytes,
		'$.maxBytes',
		1,
		EXTENSION_LIMITS.agentDirectoryListBytes,
		out,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentDirectoryListOptions }
		: { ok: false, issues: out };
}

/**
 * Child sources are bounded evidence under an already established root
 * binding. Their stable ids are required so a second root can never be
 * inferred from a child journal.
 */
export function validateAgentChildJournalSources(
	value: unknown,
): ValidationResult<AgentChildJournalSource[]> {
	const out: SchemaIssue[] = [];
	if (
		!Array.isArray(value) ||
		value.length > EXTENSION_LIMITS.agentChildJournalSources
	) {
		out.push({
			path: '$',
			code: 'invalid_array',
			message: 'Expected bounded child journal sources',
		});
	} else {
		const childIds: unknown[] = [];
		value.forEach((source, index) => {
			const path = `$[${index}]`;
			if (!record(source)) {
				out.push({
					path,
					code: 'invalid_type',
					message: 'Expected a child journal source',
				});
				return;
			}
			closed(source, new Set(['childId', 'journal', 'source']), path, out);
			agentId(source.childId, `${path}.childId`, out);
			validateOpaqueHandle(source.journal, `${path}.journal`, out);
			if (!isWatcherOrPromise(source.source))
				out.push({
					path: `${path}.source`,
					code: 'invalid_watcher',
					message: 'Expected an async file watcher or promise',
				});
			childIds.push(source.childId);
		});
		unique(childIds, '$', out);
	}
	return out.length === 0
		? { ok: true, value: value as unknown as AgentChildJournalSource[] }
		: { ok: false, issues: out };
}

function validateHomeRelativePath(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!string(value, path, out, EXTENSION_LIMITS.agentHomeRelativePathLength))
		return;
	if (
		value.startsWith('/') ||
		value.startsWith('\\') ||
		value.includes('\\') ||
		value
			.split('/')
			.some((part) => part === '' || part === '.' || part === '..')
	) {
		out.push({
			path,
			code: 'unsafe_path',
			message:
				'Expected a non-escaping home-relative path using forward slashes',
		});
	}
}
function isAbsoluteProviderPath(value: string): boolean {
	return (
		value.startsWith('/') ||
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.startsWith('\\\\')
	);
}
function validateFileExtension(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!string(value, path, out, EXTENSION_LIMITS.agentFileExtensionLength))
		return;
	if (
		!value.startsWith('.') ||
		value.includes('/') ||
		value.includes('\\') ||
		value.includes('\0')
	)
		out.push({
			path,
			code: 'unsafe_extension',
			message: 'Expected a filename extension',
		});
}
function isWatcherOrPromise(value: unknown): boolean {
	if (
		(typeof value !== 'object' && typeof value !== 'function') ||
		value === null
	)
		return false;
	const candidate = value as {
		then?: unknown;
		[Symbol.asyncIterator]?: unknown;
	};
	return (
		typeof candidate.then === 'function' ||
		typeof candidate[Symbol.asyncIterator] === 'function'
	);
}

function validateAgentBindingFingerprintInto(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!record(value)) {
		out.push({ path, code: 'invalid_type', message: 'Expected an object' });
		return;
	}
	closed(value, new Set(['kind', 'process', 'file', 'metadata']), path, out);
	string(value.kind, `${path}.kind`, out, 128);
	if (value.process === undefined && value.file === undefined)
		out.push({
			path,
			code: 'missing_evidence',
			message: 'A binding fingerprint needs scoped process or file evidence',
		});
	if (value.process !== undefined)
		validateOpaqueHandle(value.process, `${path}.process`, out);
	if (value.file !== undefined)
		validateOpaqueHandle(value.file, `${path}.file`, out);
	if (value.metadata !== undefined)
		validatePrimitiveMap(
			value.metadata,
			`${path}.metadata`,
			EXTENSION_LIMITS.agentFingerprintEntries,
			out,
		);
}

function validateOpaqueHandle(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (!record(value) || !string(value.id, `${path}.id`, out, 256)) {
		if (!record(value))
			out.push({
				path,
				code: 'invalid_handle',
				message: 'Expected a host-issued opaque handle',
			});
	}
}

function validatePrimitiveMap(
	value: unknown,
	path: string,
	maximum: number,
	out: SchemaIssue[],
): void {
	if (!record(value)) {
		out.push({ path, code: 'invalid_type', message: 'Expected an object' });
		return;
	}
	const entries = Object.entries(value);
	if (entries.length > maximum) {
		out.push({
			path,
			code: 'limit_exceeded',
			message: 'Too many metadata entries',
		});
		return;
	}
	entries.forEach(([key, item]) => {
		if (
			key.length === 0 ||
			key.length > 128 ||
			(!['string', 'number', 'boolean'].includes(typeof item) && item !== null)
		) {
			out.push({
				path: `${path}.${key}`,
				code: 'invalid_metadata',
				message: 'Metadata must use bounded JSON primitives',
			});
		} else if (
			typeof item === 'string' &&
			item.length > EXTENSION_LIMITS.stringLength
		) {
			out.push({
				path: `${path}.${key}`,
				code: 'limit_exceeded',
				message: 'Metadata string is too long',
			});
		} else if (typeof item === 'number' && !Number.isFinite(item)) {
			out.push({
				path: `${path}.${key}`,
				code: 'invalid_metadata',
				message: 'Metadata number must be finite',
			});
		}
	});
}

/** Closed validator for provider-neutral lifecycle events. */
export function validateAgentLifecycleEvent(
	value: unknown,
): ValidationResult<AgentLifecycleEvent> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	const kind = value.kind;
	if (typeof kind !== 'string') {
		out.push({
			path: '$.kind',
			code: 'invalid_event',
			message: 'Expected a lifecycle event kind',
		});
		return { ok: false, issues: out };
	}
	const common = ['kind', 'occurredAt'];
	const targeted = ['agentId'];
	switch (kind) {
		case 'session.started':
			closed(
				value,
				new Set([...common, 'title', 'promptText', 'model']),
				'$',
				out,
			);
			agentText(
				value.title,
				'$.title',
				EXTENSION_LIMITS.agentTitleLength,
				out,
				false,
			);
			agentText(
				value.promptText,
				'$.promptText',
				EXTENSION_LIMITS.agentPromptLength,
				out,
				false,
			);
			if (value.model !== undefined)
				validateAgentModelMetadataInto(value.model, '$.model', out);
			break;
		case 'agent.metadata':
			closed(
				value,
				new Set([...common, ...targeted, 'title', 'promptText', 'model']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			if (
				value.title === undefined &&
				value.promptText === undefined &&
				value.model === undefined
			)
				out.push({
					path: '$',
					code: 'missing_metadata',
					message: 'Metadata changes must contain metadata',
				});
			agentText(
				value.title,
				'$.title',
				EXTENSION_LIMITS.agentTitleLength,
				out,
				false,
			);
			agentText(
				value.promptText,
				'$.promptText',
				EXTENSION_LIMITS.agentPromptLength,
				out,
				false,
			);
			if (value.model !== undefined)
				validateAgentModelMetadataInto(value.model, '$.model', out);
			break;
		case 'turn.started':
			closed(
				value,
				new Set([...common, ...targeted, 'turnId', 'promptText']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			agentId(value.turnId, '$.turnId', out);
			agentText(
				value.promptText,
				'$.promptText',
				EXTENSION_LIMITS.agentPromptLength,
				out,
				false,
			);
			break;
		case 'tool.started':
			closed(
				value,
				new Set([...common, ...targeted, 'toolId', 'name', 'description']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			agentId(value.toolId, '$.toolId', out);
			agentText(
				value.name,
				'$.name',
				EXTENSION_LIMITS.displayNameLength,
				out,
				true,
			);
			agentText(
				value.description,
				'$.description',
				EXTENSION_LIMITS.agentReasonLength,
				out,
				false,
			);
			break;
		case 'tool.finished':
			closed(
				value,
				new Set([...common, ...targeted, 'toolId', 'outcome']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			agentId(value.toolId, '$.toolId', out);
			validateOutcome(value.outcome, '$.outcome', out, false);
			break;
		case 'wait.started':
			closed(
				value,
				new Set([
					...common,
					...targeted,
					'waitId',
					'state',
					'reason',
					'inferred',
				]),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			agentId(value.waitId, '$.waitId', out);
			if (value.state !== 'waiting' && value.state !== 'blocked')
				out.push({
					path: '$.state',
					code: 'invalid_state',
					message: 'Wait state must be waiting or blocked',
				});
			agentText(
				value.reason,
				'$.reason',
				EXTENSION_LIMITS.agentReasonLength,
				out,
				false,
			);
			if (value.inferred !== undefined && typeof value.inferred !== 'boolean')
				out.push({
					path: '$.inferred',
					code: 'invalid_type',
					message: 'inferred must be a boolean',
				});
			break;
		case 'wait.finished':
			closed(value, new Set([...common, ...targeted, 'waitId']), '$', out);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			agentId(value.waitId, '$.waitId', out);
			break;
		case 'agent.done':
			closed(
				value,
				new Set([...common, ...targeted, 'outcome', 'summary']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			validateOutcome(value.outcome, '$.outcome', out, true);
			agentText(
				value.summary,
				'$.summary',
				EXTENSION_LIMITS.agentSummaryLength,
				out,
				false,
			);
			break;
		case 'agent.exited':
			closed(
				value,
				new Set([...common, ...targeted, 'exitCode', 'signal']),
				'$',
				out,
			);
			validateOptionalAgentId(value.agentId, '$.agentId', out);
			if (value.exitCode === undefined && value.signal === undefined)
				out.push({
					path: '$',
					code: 'missing_exit_status',
					message: 'Exit events require an exit code or signal',
				});
			if (
				value.exitCode !== undefined &&
				(!Number.isSafeInteger(value.exitCode) ||
					Math.abs(Number(value.exitCode)) > 255)
			)
				out.push({
					path: '$.exitCode',
					code: 'invalid_exit_code',
					message: 'Expected a bounded integer exit code',
				});
			agentText(value.signal, '$.signal', 64, out, false);
			break;
		case 'session.stopped':
			closed(value, new Set([...common, 'reason']), '$', out);
			agentText(
				value.reason,
				'$.reason',
				EXTENSION_LIMITS.agentReasonLength,
				out,
				false,
			);
			break;
		case 'subagent.started':
			closed(
				value,
				new Set([
					...common,
					'subagentId',
					'parentAgentId',
					'title',
					'promptText',
					'model',
				]),
				'$',
				out,
			);
			agentId(value.subagentId, '$.subagentId', out);
			validateOptionalAgentId(value.parentAgentId, '$.parentAgentId', out);
			agentText(
				value.title,
				'$.title',
				EXTENSION_LIMITS.agentTitleLength,
				out,
				false,
			);
			agentText(
				value.promptText,
				'$.promptText',
				EXTENSION_LIMITS.agentPromptLength,
				out,
				false,
			);
			if (value.model !== undefined)
				validateAgentModelMetadataInto(value.model, '$.model', out);
			break;
		case 'subagent.done':
			closed(
				value,
				new Set([...common, 'subagentId', 'outcome', 'summary']),
				'$',
				out,
			);
			agentId(value.subagentId, '$.subagentId', out);
			validateOutcome(value.outcome, '$.outcome', out, true);
			agentText(
				value.summary,
				'$.summary',
				EXTENSION_LIMITS.agentSummaryLength,
				out,
				false,
			);
			break;
		default:
			out.push({
				path: '$.kind',
				code: 'invalid_event',
				message: 'Unknown lifecycle event kind',
			});
	}
	validateOccurredAt(value.occurredAt, out);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentLifecycleEvent }
		: { ok: false, issues: out };
}

/** Validates safe, displayable fallback diagnostics. */
export function validateAgentObservationDiagnostic(
	value: unknown,
): ValidationResult<AgentObservationDiagnostic> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(value, new Set(['reason', 'message']), '$', out);
	if (
		![
			'environment-capability-missing',
			'process-not-recognized',
			'session-not-found',
			'session-not-bound',
			'unsupported-provider-version',
			'malformed-observation',
			'observation-limit-exceeded',
			'cancelled',
		].includes(String(value.reason))
	) {
		out.push({
			path: '$.reason',
			code: 'invalid_reason',
			message: 'Unknown safe diagnostic reason',
		});
	}
	agentText(
		value.message,
		'$.message',
		EXTENSION_LIMITS.agentDiagnosticLength,
		out,
		false,
	);
	return out.length === 0
		? { ok: true, value: value as unknown as AgentObservationDiagnostic }
		: { ok: false, issues: out };
}

/** Runtime shape check for an activation-time agent provider implementation. */
export function validateAgentProviderDefinition(
	value: unknown,
): ValidationResult<AgentProviderDefinition> {
	const out: SchemaIssue[] = [];
	if (!record(value)) return invalidObject();
	closed(
		value,
		new Set(['mappingVersion', 'matchesForeground', 'observe']),
		'$',
		out,
	);
	string(
		value.mappingVersion,
		'$.mappingVersion',
		out,
		EXTENSION_LIMITS.agentProviderVersionLength,
	);
	if (typeof value.matchesForeground !== 'function')
		out.push({
			path: '$.matchesForeground',
			code: 'invalid_type',
			message: 'Expected a foreground matcher function',
		});
	if (typeof value.observe !== 'function')
		out.push({
			path: '$.observe',
			code: 'invalid_type',
			message: 'Expected an observation function',
		});
	return out.length === 0
		? { ok: true, value: value as unknown as AgentProviderDefinition }
		: { ok: false, issues: out };
}

function agentId(value: unknown, path: string, out: SchemaIssue[]): void {
	string(value, path, out, EXTENSION_LIMITS.agentNativeIdLength);
}
function validateOptionalAgentId(
	value: unknown,
	path: string,
	out: SchemaIssue[],
): void {
	if (value !== undefined) agentId(value, path, out);
}
function agentText(
	value: unknown,
	path: string,
	maximum: number,
	out: SchemaIssue[],
	required: boolean,
): void {
	if (value === undefined && !required) return;
	string(value, path, out, maximum);
}
function validateOutcome(
	value: unknown,
	path: string,
	out: SchemaIssue[],
	required: boolean,
): void {
	if (value === undefined && !required) return;
	if (value !== 'success' && value !== 'error' && value !== 'cancelled')
		out.push({
			path,
			code: 'invalid_outcome',
			message: 'Unknown completion outcome',
		});
}
function validateOccurredAt(value: unknown, out: SchemaIssue[]): void {
	if (value === undefined) return;
	if (
		typeof value !== 'string' ||
		value.length > 64 ||
		Number.isNaN(Date.parse(value))
	)
		out.push({
			path: '$.occurredAt',
			code: 'invalid_timestamp',
			message: 'Expected an ISO-8601 timestamp',
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
