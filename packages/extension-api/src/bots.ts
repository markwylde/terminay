import { EXTENSION_LIMITS, isNamespacedId } from './constants.js';
import type { Disposable } from './types.js';
import type { SchemaIssue, ValidationResult } from './validation.js';

/** Bot agents describe programs. Only the host runs them or handles credentials. */
export interface BotAgentContribution {
	id: string;
	displayName: string;
	imageInstall: { npm: string[]; debian?: string[] };
	runtimeProtocol: 'native-cli-v1';
	nativeDriver: 'codex-cli' | 'claude-code-cli';
	runtimeVersion: string;
	deviceSignIn?: BotAgentDeviceSignIn;
	credentialSecrets?: {
		environmentVariable: string;
		kind: 'sign-in-token' | 'api-key';
		label: string;
		help: string;
	}[];
	autonomousOnly: boolean;
	botConfigFiles?: { path: string; contents: string }[];
	/** Fixed non-secret settings; the host supplies credential variables separately. */
	launchEnvironment?: Record<string, string>;
}

/**
 * A sign-in the agent's own CLI performs inside the bot's container, as the
 * bot user in /home/bot (for example a device-code login). Its login stays in
 * that bot's home; the host never reads it.
 */
export interface BotAgentDeviceSignIn {
	command: { executable: string; args: string[] };
	signOutCommand: { executable: string; args: string[] };
	/**
	 * Optional offline check, run as the bot user before each session while
	 * the bot is device-signed-in. Exit 0 means the login is still in the
	 * bot's home; any other exit means it is gone, and the bot is set to
	 * Not signed in.
	 */
	statusCommand?: { executable: string; args: string[] };
	configFiles?: { path: string; contents: string }[];
	label: string;
	help: string;
}

export interface BotAgentModel {
	id: string;
	displayName: string;
}
export type BotAgentStatus =
	| { state: 'ready' }
	| { state: 'not_signed_in'; detail?: string };
export interface BotAgentLaunchRequest {
	modelId: string | null;
}
export interface BotAgentLaunch {
	args: string[];
	env: Record<string, string>;
}
export interface BotAgentRuntime {
	models(signal: AbortSignal): Promise<BotAgentModel[]>;
	status(signal: AbortSignal): Promise<BotAgentStatus>;
	/** Bounded non-secret launch environment; the host selects the native model. */
	launch(
		request: BotAgentLaunchRequest,
		signal: AbortSignal,
	): Promise<BotAgentLaunch>;
}
export interface BotAgentRegistration extends Disposable {
	readonly agentId: string;
}
export interface BotAgentRegistry {
	registerBotAgent(
		agentId: string,
		runtime: BotAgentRuntime,
	): BotAgentRegistration;
}
/** Failure details never include an extension's exception text. */
export type BotAgentResult<T> =
	| { available: true; value: T }
	| { available: false; reason: 'unavailable' };

export const BOT_ENVIRONMENT_VARIABLE_PATTERN = /^[A-Z][A-Z0-9_]*$/;
/** Host-owned storage in the bot home. Paths are always relative to /home/bot. */
export const BOT_RESERVED_DIRECTORIES: readonly string[] = Object.freeze([
	'memories',
	'.terminay',
]);

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function text(
	value: unknown,
	max: number = EXTENSION_LIMITS.stringLength,
): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= max &&
		!value.includes('\0')
	);
}
function closed(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}
function strings(
	value: unknown,
	max: number,
	valid: (s: unknown) => boolean,
): value is string[] {
	return Array.isArray(value) && value.length <= max && value.every(valid);
}
function relativePath(value: unknown, bot: boolean): value is string {
	return (
		text(value) &&
		!value.includes('..') &&
		!value.includes('\\') &&
		!/^[A-Za-z]:/.test(value) &&
		value.split('/').every((part) => part !== '' && part !== '.') &&
		(!bot || !BOT_RESERVED_DIRECTORIES.includes(value.split('/')[0]))
	);
}
function variable(value: unknown): value is string {
	return text(value, 128) && BOT_ENVIRONMENT_VARIABLE_PATTERN.test(value);
}
function command(value: unknown): boolean {
	return (
		record(value) &&
		closed(value, ['executable', 'args']) &&
		text(value.executable) &&
		/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(value.executable) &&
		strings(
			value.args,
			EXTENSION_LIMITS.maxLaunchArgs,
			(arg) =>
				typeof arg === 'string' &&
				arg.length <= EXTENSION_LIMITS.stringLength &&
				!arg.includes('\0'),
		)
	);
}
function environment(
	value: unknown,
	contribution?: BotAgentContribution,
): value is Record<string, string> {
	if (
		!record(value) ||
		Object.keys(value).length > EXTENSION_LIMITS.maxLaunchEnvEntries
	)
		return false;
	const reserved = new Set(
		contribution?.credentialSecrets?.map(
			(secret) => secret.environmentVariable,
		),
	);
	return Object.entries(value).every(
		([key, entry]) =>
			variable(key) &&
			!reserved.has(key) &&
			typeof entry === 'string' &&
			entry.length <= EXTENSION_LIMITS.stringLength &&
			!entry.includes('\0'),
	);
}

/** Closed schema: executable install scripts, host operations, and credential values have no field. */
export function validateBotAgentContribution(
	value: unknown,
	extensionId: string,
): ValidationResult<BotAgentContribution> {
	const issues: SchemaIssue[] = [];
	const check = (valid: boolean, path: string, message: string): void => {
		if (!valid) issues.push({ path, code: 'invalid_bot_agent', message });
	};
	if (!record(value))
		return {
			ok: false,
			issues: [
				{
					path: '$',
					code: 'invalid_type',
					message: 'Expected a bot agent object',
				},
			],
		};
	check(
		closed(value, [
			'id',
			'displayName',
			'imageInstall',
			'runtimeProtocol',
			'nativeDriver',
			'runtimeVersion',
			'deviceSignIn',
			'credentialSecrets',
			'autonomousOnly',
			'botConfigFiles',
			'launchEnvironment',
		]),
		'$',
		'Unknown bot agent field',
	);
	check(
		text(value.id, EXTENSION_LIMITS.providerIdLength) &&
			isNamespacedId(value.id, extensionId),
		'$.id',
		'Bot agent id must be namespaced by the extension id',
	);
	check(
		text(value.displayName, EXTENSION_LIMITS.displayNameLength),
		'$.displayName',
		'Expected a bounded display name',
	);
	const install = value.imageInstall;
	check(
		record(install) && closed(install, ['npm', 'debian']),
		'$.imageInstall',
		'Install step must contain only pinned npm packages and Debian package names',
	);
	if (record(install)) {
		check(
			Array.isArray(install.npm) &&
				install.npm.length > 0 &&
				install.npm.length <= EXTENSION_LIMITS.botInstallPackages,
			'$.imageInstall.npm',
			'Expected a bounded list of pinned npm packages',
		);
		if (Array.isArray(install.npm))
			for (const [index, specifier] of install.npm.entries()) {
				check(
					text(specifier) &&
						/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
							specifier,
						),
					`$.imageInstall.npm[${index}]`,
					`Expected an exact pinned npm version: ${typeof specifier === 'string' ? specifier.slice(0, 256) : '(invalid specifier)'}`,
				);
			}
		if (install.debian !== undefined)
			check(
				strings(
					install.debian,
					EXTENSION_LIMITS.botInstallPackages,
					(s) => text(s, 128) && /^[a-z0-9][a-z0-9+.-]+$/.test(s),
				),
				'$.imageInstall.debian',
				'Expected Debian package names',
			);
	}
	check(
		value.runtimeProtocol === 'native-cli-v1',
		'$.runtimeProtocol',
		'Expected native-cli-v1; update ACP bot contributions',
	);
	check(
		value.nativeDriver === 'codex-cli' ||
			value.nativeDriver === 'claude-code-cli',
		'$.nativeDriver',
		'Expected a supported native CLI driver; ACP declarations must be updated',
	);
	check(
		typeof value.autonomousOnly === 'boolean',
		'$.autonomousOnly',
		'Expected an Autonomous-only boolean',
	);
	check(
		text(value.runtimeVersion, 128) &&
			/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(String(value.runtimeVersion)),
		'$.runtimeVersion',
		'Expected an exact native CLI version',
	);
	const device = value.deviceSignIn;
	if (device !== undefined) {
		check(
			record(device) &&
				closed(device, [
					'command',
					'signOutCommand',
					'statusCommand',
					'configFiles',
					'label',
					'help',
				]),
			'$.deviceSignIn',
			'Unknown device sign-in field',
		);
		if (record(device)) {
			check(
				command(device.command),
				'$.deviceSignIn.command',
				'Expected a sign-in executable and arguments',
			);
			check(
				command(device.signOutCommand),
				'$.deviceSignIn.signOutCommand',
				'Expected a sign-out executable and arguments',
			);
			check(
				device.statusCommand === undefined || command(device.statusCommand),
				'$.deviceSignIn.statusCommand',
				'Expected a status executable and arguments',
			);
			check(
				text(device.label, EXTENSION_LIMITS.displayNameLength),
				'$.deviceSignIn.label',
				'Expected a bounded label',
			);
			check(
				text(device.help),
				'$.deviceSignIn.help',
				'Expected bounded help text',
			);
		}
	}
	if (value.credentialSecrets !== undefined) {
		const secrets = value.credentialSecrets;
		check(
			Array.isArray(secrets) &&
				secrets.length <= EXTENSION_LIMITS.botCredentialSecrets,
			'$.credentialSecrets',
			'Expected a bounded credential secret array',
		);
		if (Array.isArray(secrets)) {
			const seen = new Set<string>();
			for (const [index, secret] of secrets.entries()) {
				const path = `$.credentialSecrets[${index}]`;
				check(
					record(secret) &&
						closed(secret, ['environmentVariable', 'kind', 'label', 'help']),
					path,
					'Unknown credential secret field',
				);
				if (!record(secret)) continue;
				check(
					variable(secret.environmentVariable),
					`${path}.environmentVariable`,
					'Expected environment variable name [A-Z][A-Z0-9_]*',
				);
				if (typeof secret.environmentVariable === 'string') {
					check(
						!seen.has(secret.environmentVariable),
						path,
						'Duplicate credential secret environment variable',
					);
					seen.add(secret.environmentVariable);
				}
				check(
					secret.kind === 'sign-in-token' || secret.kind === 'api-key',
					`${path}.kind`,
					'Unknown secret kind; expected sign-in-token or api-key',
				);
				check(
					text(secret.label, EXTENSION_LIMITS.displayNameLength),
					`${path}.label`,
					'Expected a bounded credential label',
				);
				check(
					text(secret.help, EXTENSION_LIMITS.descriptionLength),
					`${path}.help`,
					'Expected bounded credential help',
				);
			}
		}
	}
	const configFiles = (files: unknown, basePath: string): void => {
		if (files !== undefined) {
			check(
				Array.isArray(files) && files.length <= EXTENSION_LIMITS.botConfigFiles,
				basePath,
				'Expected a bounded bot config file array',
			);
			if (Array.isArray(files)) {
				const seen = new Set<string>();
				for (const [index, file] of files.entries()) {
					const path = `${basePath}[${index}]`;
					check(
						record(file) && closed(file, ['path', 'contents']),
						path,
						'Unknown bot config file field',
					);
					if (!record(file)) continue;
					check(
						relativePath(file.path, true),
						`${path}.path`,
						'Config path must be relative, contain no .., and avoid memories and Terminay-reserved directories',
					);
					check(
						typeof file.contents === 'string' &&
							file.contents.length <=
								EXTENSION_LIMITS.botConfigContentsLength &&
							!file.contents.includes('\0'),
						`${path}.contents`,
						'Expected bounded fixed config contents',
					);
					if (typeof file.path === 'string') {
						check(!seen.has(file.path), path, 'Duplicate config path');
						seen.add(file.path);
					}
				}
			}
		}
	};
	configFiles(value.botConfigFiles, '$.botConfigFiles');
	if (record(device))
		configFiles(device.configFiles, '$.deviceSignIn.configFiles');

	if (value.launchEnvironment !== undefined && issues.length === 0)
		check(
			environment(
				value.launchEnvironment,
				value as unknown as BotAgentContribution,
			),
			'$.launchEnvironment',
			'Expected bounded non-secret environment with names [A-Z][A-Z0-9_]*; credential variables are host-owned',
		);
	return issues.length
		? { ok: false, issues }
		: {
				ok: true,
				value: structuredClone(value) as unknown as BotAgentContribution,
			};
}

export function validateBotAgentModels(
	value: unknown,
): ValidationResult<BotAgentModel[]> {
	if (
		!Array.isArray(value) ||
		value.length > EXTENSION_LIMITS.botModels ||
		!value.every(
			(m) =>
				record(m) &&
				closed(m, ['id', 'displayName']) &&
				text(m.id, EXTENSION_LIMITS.agentModelLength) &&
				text(m.displayName, EXTENSION_LIMITS.displayNameLength),
		) ||
		new Set(value.map((m) => m.id)).size !== value.length
	)
		return invalid('Expected at most 64 unique bounded models');
	return {
		ok: true,
		value: value.map((m) => ({ id: m.id, displayName: m.displayName })),
	};
}
export function validateBotAgentStatus(
	value: unknown,
): ValidationResult<BotAgentStatus> {
	if (
		!record(value) ||
		!closed(value, ['state', 'detail']) ||
		(value.state !== 'ready' && value.state !== 'not_signed_in') ||
		(value.detail !== undefined &&
			!text(value.detail, EXTENSION_LIMITS.botDetailLength)) ||
		(value.state === 'ready' && value.detail !== undefined)
	)
		return invalid('Expected ready or not_signed_in with bounded detail');
	return {
		ok: true,
		value: structuredClone(value) as unknown as BotAgentStatus,
	};
}
export function validateBotAgentLaunchRequest(
	value: unknown,
): ValidationResult<BotAgentLaunchRequest> {
	if (
		!record(value) ||
		!closed(value, ['modelId']) ||
		(value.modelId !== null &&
			!text(value.modelId, EXTENSION_LIMITS.agentModelLength))
	)
		return invalid('Expected only a chosen model id, or null for Default');
	return { ok: true, value: { modelId: value.modelId } };
}
export function validateBotAgentLaunch(
	value: unknown,
	contribution: BotAgentContribution,
): ValidationResult<BotAgentLaunch> {
	if (
		!record(value) ||
		!closed(value, ['args', 'env']) ||
		!strings(
			value.args,
			EXTENSION_LIMITS.maxLaunchArgs,
			(s) =>
				typeof s === 'string' &&
				s.length <= EXTENSION_LIMITS.stringLength &&
				!s.includes('\0'),
		) ||
		!environment(value.env, contribution)
	)
		return invalid(
			'Expected bounded launch arguments and non-secret environment; credential variables are host-owned',
		);
	return { ok: true, value: { args: [...value.args], env: { ...value.env } } };
}
function invalid(message: string): { ok: false; issues: SchemaIssue[] } {
	return {
		ok: false,
		issues: [{ path: '$', code: 'invalid_bot_result', message }],
	};
}
