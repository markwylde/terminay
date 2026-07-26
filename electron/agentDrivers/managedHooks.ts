import { randomUUID } from 'node:crypto';
import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentProvider } from '../../src/types/agentStatus';

export const MANAGED_HOOK_MARKER = 'TERMINAY_MANAGED_AGENT_HOOK=1';
export const MANAGED_HOOK_SCRIPT_NAME = 'terminay-agent-hook.sh';
export const MANAGED_HOOK_TIMEOUT_SECONDS = 2;

export interface AgentDriverFileSystem {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	chmod(path: string, mode: number): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface ManagedHookPaths {
	homeDir: string;
	configPath: string;
	scriptPath: string;
}

export interface ManagedHookOptions {
	homeDir?: string;
	scriptDir?: string;
	fileSystem?: AgentDriverFileSystem;
}

export type ManagedHookInstallState =
	| 'installed'
	| 'partial'
	| 'not-installed'
	| 'error';

export interface ManagedHookStatus {
	provider: AgentProvider;
	state: ManagedHookInstallState;
	configPath: string;
	scriptPath: string;
	managedHooksPresent: boolean;
	installedEvents: string[];
	missingEvents: string[];
	error?: string;
}

export interface ManagedHookReconciler {
	readonly provider: AgentProvider;
	paths(options?: ManagedHookOptions): ManagedHookPaths;
	status(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
	install(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
	uninstall(options?: ManagedHookOptions): Promise<ManagedHookStatus>;
}

export interface HookCommand {
	type?: string;
	command?: string;
	timeout?: number;
	[key: string]: unknown;
}

export interface HookDefinition {
	matcher?: string;
	hooks?: HookCommand[];
	[key: string]: unknown;
}

export interface HooksConfig {
	hooks?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface ManagedEventDefinition {
	eventName: string;
	matcher?: string;
}

export function createJsonHookReconciler(
	provider: AgentProvider,
	configSegments: string[],
	events: readonly ManagedEventDefinition[],
	reconcilerOptions: { placement?: 'append' | 'prepend' } = {},
): ManagedHookReconciler {
	const paths = (options: ManagedHookOptions = {}) =>
		resolveManagedHookPaths(
			configSegments,
			options,
			`terminay-${provider}-agent-hook.sh`,
		);

	return {
		provider,
		paths,
		async status(options = {}) {
			const resolvedPaths = paths(options);
			const fileSystem =
				options.fileSystem ?? createNodeAgentDriverFileSystem();
			const result = await readHooksConfig(
				resolvedPaths.configPath,
				fileSystem,
			);
			if ('error' in result) {
				return errorStatus(provider, resolvedPaths, events, result.error);
			}
			return statusFromPresence(provider, resolvedPaths, events, result.config);
		},
		async install(options = {}) {
			const resolvedPaths = paths(options);
			const fileSystem =
				options.fileSystem ?? createNodeAgentDriverFileSystem();
			const result = await readHooksConfig(
				resolvedPaths.configPath,
				fileSystem,
			);
			if ('error' in result) {
				return errorStatus(provider, resolvedPaths, events, result.error);
			}

			try {
				const command = buildManagedHookCommand(
					resolvedPaths.scriptPath,
					provider,
				);
				const hooks = getHookRecord(result.config);
				for (const event of events) {
					if (
						hooks[event.eventName] !== undefined &&
						!Array.isArray(hooks[event.eventName])
					) {
						return errorStatus(
							provider,
							resolvedPaths,
							events,
							`${resolvedPaths.configPath} has a non-array ${event.eventName} hook; refusing to overwrite it`,
						);
					}
					hooks[event.eventName] = reconcileManagedDefinition(
						hooks[event.eventName],
						command,
						event.matcher,
						reconcilerOptions.placement ?? 'prepend',
					);
				}

				await writeManagedHookScript(resolvedPaths.scriptPath, fileSystem);
				await writeJsonAtomically(
					resolvedPaths.configPath,
					{ ...result.config, hooks },
					fileSystem,
				);
				return statusFromPresence(provider, resolvedPaths, events, {
					...result.config,
					hooks,
				});
			} catch (cause) {
				return errorStatus(provider, resolvedPaths, events, cause);
			}
		},
		async uninstall(options = {}) {
			const resolvedPaths = paths(options);
			const fileSystem =
				options.fileSystem ?? createNodeAgentDriverFileSystem();
			const result = await readHooksConfig(
				resolvedPaths.configPath,
				fileSystem,
			);
			if ('error' in result) {
				return errorStatus(provider, resolvedPaths, events, result.error);
			}

			try {
				const hooks = getHookRecord(result.config);
				let changed = false;
				for (const [eventName, definitions] of Object.entries(hooks)) {
					if (!Array.isArray(definitions)) {
						continue;
					}
					const cleaned = removeTerminayManagedHooks(definitions);
					if (JSON.stringify(cleaned) === JSON.stringify(definitions)) {
						continue;
					}
					changed = true;
					if (cleaned.length === 0) {
						delete hooks[eventName];
					} else {
						hooks[eventName] = cleaned;
					}
				}

				if (changed && result.exists) {
					await writeJsonAtomically(
						resolvedPaths.configPath,
						{ ...result.config, hooks },
						fileSystem,
					);
				}
				await fileSystem.remove(resolvedPaths.scriptPath);
				return statusFromPresence(provider, resolvedPaths, events, {
					...result.config,
					hooks,
				});
			} catch (cause) {
				return errorStatus(provider, resolvedPaths, events, cause);
			}
		},
	};
}

/**
 * Keep an existing managed hook at its current group/handler index. Codex
 * includes those indexes in hook trust keys, so moving the hook can invalidate
 * unrelated user approvals. A first install may choose append for the same
 * reason.
 */
export function reconcileManagedDefinition(
	definitions: unknown,
	command: string,
	matcher: string | undefined,
	placement: 'append' | 'prepend',
): HookDefinition[] {
	const current = Array.isArray(definitions)
		? definitions.map((definition) =>
				isPlainObject(definition) ? { ...definition } : definition,
			)
		: [];
	let retainedManagedHook = false;
	const reconciled: HookDefinition[] = [];

	for (const value of current) {
		if (!isPlainObject(value)) {
			reconciled.push(value as HookDefinition);
			continue;
		}
		const definition = { ...value } as HookDefinition;
		if (!Array.isArray(definition.hooks)) {
			reconciled.push(definition);
			continue;
		}

		const hooks: HookCommand[] = [];
		for (const hook of definition.hooks) {
			if (!isTerminayManagedCommand(hook?.command)) {
				hooks.push(hook);
				continue;
			}
			if (!retainedManagedHook) {
				hooks.push({
					type: 'command',
					command,
					timeout: MANAGED_HOOK_TIMEOUT_SECONDS,
				});
				retainedManagedHook = true;
			}
		}
		if (hooks.length > 0) {
			definition.hooks = hooks;
			reconciled.push(definition);
		}
	}

	if (retainedManagedHook) {
		return reconciled;
	}
	const managed = createManagedDefinition(command, matcher);
	return placement === 'append'
		? [...reconciled, managed]
		: [managed, ...reconciled];
}

export function createNodeAgentDriverFileSystem(): AgentDriverFileSystem {
	return {
		readFile: (path) => readFile(path, 'utf8'),
		writeFile: (path, content) => writeFile(path, content, 'utf8'),
		mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
		rename,
		chmod,
		remove: (path) => rm(path, { force: true }),
	};
}

export function resolveManagedHookPaths(
	configSegments: string[],
	options: ManagedHookOptions = {},
	scriptName = MANAGED_HOOK_SCRIPT_NAME,
): ManagedHookPaths {
	const homeDir = options.homeDir ?? homedir();
	const scriptDir =
		options.scriptDir ?? join(homeDir, '.terminay', 'agent-hooks');
	return {
		homeDir,
		configPath: join(homeDir, ...configSegments),
		scriptPath: join(scriptDir, scriptName),
	};
}

export function buildManagedHookCommand(
	scriptPath: string,
	provider: AgentProvider,
): string {
	const quotedPath = quotePosix(scriptPath);
	return `${MANAGED_HOOK_MARKER} /bin/sh ${quotedPath} ${quotePosix(provider)}`;
}

export function buildManagedHookScript(): string {
	return [
		'#!/bin/sh',
		'payload=$(cat)',
		`provider=\${1:-}`,
		'if [ -z "$payload" ] || [ -z "$provider" ]; then',
		'  exit 0',
		'fi',
		'if [ -z "$TERMINAY_SESSION_ID" ] || [ -z "$TERMINAY_AGENT_HOOK_ENDPOINT" ] || [ -z "$TERMINAY_AGENT_HOOK_TOKEN" ]; then',
		'  exit 0',
		'fi',
		'case "$TERMINAY_AGENT_HOOK_ENDPOINT" in',
		'  http://127.0.0.1:*|http://localhost:*) ;;',
		'  *) exit 0 ;;',
		'esac',
		'printf \'%s\' "$payload" | curl -sS -X POST "$TERMINAY_AGENT_HOOK_ENDPOINT" \\',
		'  --connect-timeout 0.5 --max-time 1.5 --noproxy "*" \\',
		'  -H "Content-Type: application/json" \\',
		`  -H "X-Terminay-Agent-Hook-Token: \${TERMINAY_AGENT_HOOK_TOKEN}" \\`,
		`  -H "X-Terminay-Session-Id: \${TERMINAY_SESSION_ID}" \\`,
		`  -H "X-Terminay-Agent-Provider: \${provider}" \\`,
		'  --data-binary @- >/dev/null 2>&1 || true',
		'exit 0',
		'',
	].join('\n');
}

export function isTerminayManagedCommand(command: unknown): boolean {
	return (
		typeof command === 'string' && command.startsWith(`${MANAGED_HOOK_MARKER} `)
	);
}

export function removeTerminayManagedHooks(
	definitions: unknown,
): HookDefinition[] {
	if (!Array.isArray(definitions)) {
		return [];
	}

	const cleaned: HookDefinition[] = [];
	for (const value of definitions) {
		if (!isPlainObject(value)) {
			cleaned.push(value as HookDefinition);
			continue;
		}
		const definition = { ...value } as HookDefinition;
		if (!Array.isArray(definition.hooks)) {
			if (!isTerminayManagedCommand(definition.command)) {
				cleaned.push(definition);
			}
			continue;
		}

		const hooks = definition.hooks.filter(
			(hook) => !isTerminayManagedCommand(hook?.command),
		);
		if (hooks.length > 0) {
			definition.hooks = hooks;
			cleaned.push(definition);
		}
	}
	return cleaned;
}

export function createManagedDefinition(
	command: string,
	matcher?: string,
): HookDefinition {
	const definition: HookDefinition = {
		hooks: [
			{
				type: 'command',
				command,
				timeout: MANAGED_HOOK_TIMEOUT_SECONDS,
			},
		],
	};
	if (matcher !== undefined) {
		definition.matcher = matcher;
	}
	return definition;
}

export async function readHooksConfig(
	path: string,
	fileSystem: AgentDriverFileSystem,
): Promise<
	{ config: HooksConfig; exists: boolean } | { error: string; exists: boolean }
> {
	let raw: string;
	try {
		raw = await fileSystem.readFile(path);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
			return { config: {}, exists: false };
		}
		return { error: describeError(cause), exists: false };
	}

	if (raw.trim() === '') {
		return { config: {}, exists: true };
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isPlainObject(parsed)) {
			return {
				error: `${path} does not contain a JSON object; refusing to overwrite it`,
				exists: true,
			};
		}
		if (parsed.hooks !== undefined && !isPlainObject(parsed.hooks)) {
			return {
				error: `${path} has a non-object hooks value; refusing to overwrite it`,
				exists: true,
			};
		}
		return { config: parsed as HooksConfig, exists: true };
	} catch (cause) {
		return {
			error: `Could not parse ${path} as JSON: ${describeError(cause)}`,
			exists: true,
		};
	}
}

export async function writeJsonAtomically(
	path: string,
	value: unknown,
	fileSystem: AgentDriverFileSystem,
): Promise<void> {
	await fileSystem.mkdir(dirname(path));
	const temporaryPath = join(
		dirname(path),
		`.${MANAGED_HOOK_SCRIPT_NAME}.${randomUUID()}.tmp`,
	);
	try {
		await fileSystem.writeFile(
			temporaryPath,
			`${JSON.stringify(value, null, 2)}\n`,
		);
		await fileSystem.rename(temporaryPath, path);
		await fileSystem.chmod(path, 0o600);
	} catch (cause) {
		await fileSystem.remove(temporaryPath).catch(() => undefined);
		throw cause;
	}
}

export async function writeManagedHookScript(
	path: string,
	fileSystem: AgentDriverFileSystem,
): Promise<void> {
	await fileSystem.mkdir(dirname(path));
	await fileSystem.writeFile(path, buildManagedHookScript());
	await fileSystem.chmod(path, 0o700);
}

export function getHookRecord(config: HooksConfig): Record<string, unknown> {
	return isPlainObject(config.hooks) ? { ...config.hooks } : {};
}

export function getManagedEventPresence(
	config: HooksConfig,
	events: readonly ManagedEventDefinition[],
): { installedEvents: string[]; missingEvents: string[] } {
	const hooks = getHookRecord(config);
	const installedEvents: string[] = [];
	const missingEvents: string[] = [];

	for (const { eventName } of events) {
		const definitions = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
		const installed = definitions.some(
			(definition) =>
				isPlainObject(definition) &&
				Array.isArray(definition.hooks) &&
				definition.hooks.some(
					(hook) =>
						isPlainObject(hook) && isTerminayManagedCommand(hook.command),
				),
		);
		(installed ? installedEvents : missingEvents).push(eventName);
	}
	return { installedEvents, missingEvents };
}

export function statusFromPresence(
	provider: AgentProvider,
	paths: ManagedHookPaths,
	events: readonly ManagedEventDefinition[],
	config: HooksConfig,
): ManagedHookStatus {
	const { installedEvents, missingEvents } = getManagedEventPresence(
		config,
		events,
	);
	return {
		provider,
		state:
			missingEvents.length === 0
				? 'installed'
				: installedEvents.length === 0
					? 'not-installed'
					: 'partial',
		configPath: paths.configPath,
		scriptPath: paths.scriptPath,
		managedHooksPresent: installedEvents.length > 0,
		installedEvents,
		missingEvents,
	};
}

export function errorStatus(
	provider: AgentProvider,
	paths: ManagedHookPaths,
	events: readonly ManagedEventDefinition[],
	error: unknown,
): ManagedHookStatus {
	return {
		provider,
		state: 'error',
		configPath: paths.configPath,
		scriptPath: paths.scriptPath,
		managedHooksPresent: false,
		installedEvents: [],
		missingEvents: events.map(({ eventName }) => eventName),
		error: describeError(error),
	};
}

export function quotePosix(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function isPlainObject(
	value: unknown,
): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
