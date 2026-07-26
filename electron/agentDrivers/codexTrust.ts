import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, posix as pathPosix } from 'node:path';
import type {
	AgentDriverFileSystem,
	HookCommand,
	HookDefinition,
	HooksConfig,
	ManagedHookOptions,
	ManagedHookPaths,
	ManagedHookStatus,
} from './managedHooks';
import {
	createNodeAgentDriverFileSystem,
	getHookRecord,
	isPlainObject,
	isTerminayManagedCommand,
} from './managedHooks';

type CodexEventLabel =
	| 'session_start'
	| 'user_prompt_submit'
	| 'pre_tool_use'
	| 'permission_request'
	| 'post_tool_use'
	| 'subagent_start'
	| 'subagent_stop'
	| 'stop';

type TrustEntry = {
	key: string;
	hash: string;
};

const EVENT_LABELS: Readonly<Record<string, CodexEventLabel>> = {
	SessionStart: 'session_start',
	UserPromptSubmit: 'user_prompt_submit',
	PreToolUse: 'pre_tool_use',
	PermissionRequest: 'permission_request',
	PostToolUse: 'post_tool_use',
	SubagentStart: 'subagent_start',
	SubagentStop: 'subagent_stop',
	Stop: 'stop',
};

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalize);
	}
	if (value && typeof value === 'object') {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

function normalizeSourcePath(sourcePath: string): string {
	const normalized = pathPosix.isAbsolute(sourcePath)
		? pathPosix.normalize(sourcePath)
		: pathPosix.resolve(sourcePath);
	return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function matcherForEvent(
	eventLabel: CodexEventLabel,
	matcher: unknown,
): string | undefined {
	if (eventLabel === 'user_prompt_submit' || eventLabel === 'stop') {
		return undefined;
	}
	return typeof matcher === 'string' ? matcher : undefined;
}

function trustedHash(
	eventLabel: CodexEventLabel,
	definition: HookDefinition,
	hook: HookCommand,
): string {
	const handler: Record<string, unknown> = {
		async: hook.async ?? false,
		command: hook.command,
		timeout: Math.max(
			1,
			typeof hook.timeout === 'number' ? hook.timeout : 600,
		),
		type: 'command',
	};
	if (typeof hook.statusMessage === 'string') {
		handler.statusMessage = hook.statusMessage;
	}
	const identity: Record<string, unknown> = {
		event_name: eventLabel,
		hooks: [handler],
	};
	const matcher = matcherForEvent(eventLabel, definition.matcher);
	if (matcher !== undefined) {
		identity.matcher = matcher;
	}
	const serialized = JSON.stringify(canonicalize(identity));
	return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

export function collectCodexManagedTrustEntries(
	hooksPath: string,
	config: HooksConfig,
): TrustEntry[] {
	const sourcePath = normalizeSourcePath(hooksPath);
	const entries: TrustEntry[] = [];
	for (const [eventName, rawDefinitions] of Object.entries(
		getHookRecord(config),
	)) {
		const eventLabel = EVENT_LABELS[eventName];
		if (!eventLabel || !Array.isArray(rawDefinitions)) {
			continue;
		}
		rawDefinitions.forEach((rawDefinition, groupIndex) => {
			if (!isPlainObject(rawDefinition)) {
				return;
			}
			const definition = rawDefinition as HookDefinition;
			if (!Array.isArray(definition.hooks)) {
				return;
			}
			definition.hooks.forEach((hook, handlerIndex) => {
				if (!isTerminayManagedCommand(hook?.command)) {
					return;
				}
				entries.push({
					key: `${sourcePath}:${eventLabel}:${groupIndex}:${handlerIndex}`,
					hash: trustedHash(eventLabel, definition, hook),
				});
			});
		});
	}
	return entries;
}

function escapeTomlString(value: string): string {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.split('\b')
		.join('\\b')
		.replace(/\f/g, '\\f')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}

function trustHeader(key: string): string {
	return `[hooks.state."${escapeTomlString(key)}"]`;
}

type TomlBlock = {
	start: number;
	end: number;
	headerEnd: number;
};

function findTableBlocks(content: string): TomlBlock[] {
	const headers = [...content.matchAll(/^[ \t]*\[[^\r\n]+\][ \t]*(?:#.*)?$/gm)];
	return headers.map((match, index) => {
		const start = match.index ?? 0;
		const headerEnd = start + match[0].length;
		return {
			start,
			headerEnd,
			end: headers[index + 1]?.index ?? content.length,
		};
	});
}

function blockHeader(content: string, block: TomlBlock): string {
	return content.slice(block.start, block.headerEnd).trim();
}

function blockHash(content: string, block: TomlBlock): string | undefined {
	const body = content.slice(block.headerEnd, block.end);
	return /^[ \t]*trusted_hash[ \t]*=[ \t]*"([^"\r\n]+)"/m.exec(body)?.[1];
}

function blockEnabled(content: string, block: TomlBlock): boolean {
	const body = content.slice(block.headerEnd, block.end);
	return !/^[ \t]*enabled[ \t]*=[ \t]*false[ \t]*(?:#.*)?$/m.test(body);
}

function formatBlock(entry: TrustEntry, enabled: boolean): string {
	return [
		trustHeader(entry.key),
		`enabled = ${enabled}`,
		`trusted_hash = "${escapeTomlString(entry.hash)}"`,
	].join('\n');
}

function replaceRanges(
	content: string,
	replacements: Array<{ start: number; end: number; value: string }>,
): string {
	let updated = content;
	for (const replacement of [...replacements].sort(
		(left, right) => right.start - left.start,
	)) {
		updated =
			updated.slice(0, replacement.start) +
			replacement.value +
			updated.slice(replacement.end);
	}
	return updated;
}

export function reconcileCodexTrustToml(
	content: string,
	entries: readonly TrustEntry[],
): string {
	let updated = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	for (const entry of entries) {
		const header = trustHeader(entry.key);
		const matches = findTableBlocks(updated).filter(
			(block) => blockHeader(updated, block) === header,
		);
		if (matches.length === 0) {
			const separator =
				updated.length === 0
					? ''
					: updated.endsWith('\n\n')
						? ''
						: updated.endsWith('\n')
							? '\n'
							: '\n\n';
			updated += `${separator}${formatBlock(entry, true)}\n`;
			continue;
		}
		const enabled = matches.every((block) => blockEnabled(updated, block));
		if (
			matches.length === 1 &&
			updated.slice(matches[0].start, matches[0].end).trim() ===
				formatBlock(entry, enabled)
		) {
			continue;
		}
		updated = replaceRanges(
			updated,
			matches.map((block, index) => ({
				start: block.start,
				end: block.end,
				value: index === 0 ? `${formatBlock(entry, enabled)}\n\n` : '',
			})),
		);
	}
	return updated;
}

export function removeCodexTrustToml(
	content: string,
	entries: readonly TrustEntry[],
): string {
	const keys = new Set(entries.map(({ key }) => trustHeader(key)));
	const hashes = new Set(entries.map(({ hash }) => hash));
	const ranges = findTableBlocks(content).filter((block) => {
		const header = blockHeader(content, block);
		if (keys.has(header)) {
			return true;
		}
		return header.startsWith('[hooks.state.') &&
			hashes.has(blockHash(content, block) ?? '');
	});
	return replaceRanges(
		content,
		ranges.map((block) => ({ start: block.start, end: block.end, value: '' })),
	);
}

async function readOptionalText(
	path: string,
	fileSystem: AgentDriverFileSystem,
): Promise<string> {
	try {
		return await fileSystem.readFile(path);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
			return '';
		}
		throw cause;
	}
}

async function writeTextAtomically(
	path: string,
	content: string,
	fileSystem: AgentDriverFileSystem,
): Promise<void> {
	await fileSystem.mkdir(dirname(path));
	const temporaryPath = join(
		dirname(path),
		`.terminay-codex-trust.${randomUUID()}.tmp`,
	);
	try {
		await fileSystem.writeFile(temporaryPath, content);
		await fileSystem.rename(temporaryPath, path);
		await fileSystem.chmod(path, 0o600);
	} catch (cause) {
		await fileSystem.remove(temporaryPath).catch(() => undefined);
		throw cause;
	}
}

export async function reconcileCodexManagedTrust(
	paths: ManagedHookPaths,
	config: HooksConfig,
	options: ManagedHookOptions = {},
): Promise<void> {
	const fileSystem =
		options.fileSystem ?? createNodeAgentDriverFileSystem();
	const configTomlPath = join(paths.homeDir, '.codex', 'config.toml');
	const existing = await readOptionalText(configTomlPath, fileSystem);
	const entries = collectCodexManagedTrustEntries(paths.configPath, config);
	await writeTextAtomically(
		configTomlPath,
		reconcileCodexTrustToml(existing, entries),
		fileSystem,
	);
}

export async function inspectCodexManagedTrust(
	paths: ManagedHookPaths,
	config: HooksConfig,
	options: ManagedHookOptions = {},
): Promise<{ current: boolean; missingKeys: string[] }> {
	const fileSystem =
		options.fileSystem ?? createNodeAgentDriverFileSystem();
	const configTomlPath = join(paths.homeDir, '.codex', 'config.toml');
	const content = await readOptionalText(configTomlPath, fileSystem);
	const entries = collectCodexManagedTrustEntries(paths.configPath, config);
	const blocks = findTableBlocks(content);
	const missingKeys = entries
		.filter((entry) => {
			const header = trustHeader(entry.key);
			return !blocks.some(
				(block) =>
					blockHeader(content, block) === header &&
					blockHash(content, block) === entry.hash &&
					blockEnabled(content, block),
			);
		})
		.map(({ key }) => key);
	return { current: missingKeys.length === 0, missingKeys };
}

export async function removeCodexManagedTrust(
	paths: ManagedHookPaths,
	config: HooksConfig,
	options: ManagedHookOptions = {},
): Promise<void> {
	const fileSystem =
		options.fileSystem ?? createNodeAgentDriverFileSystem();
	const configTomlPath = join(paths.homeDir, '.codex', 'config.toml');
	const existing = await readOptionalText(configTomlPath, fileSystem);
	if (existing.length === 0) {
		return;
	}
	const entries = collectCodexManagedTrustEntries(paths.configPath, config);
	const updated = removeCodexTrustToml(existing, entries);
	if (updated !== existing) {
		await writeTextAtomically(configTomlPath, updated, fileSystem);
	}
}

export function codexTrustErrorStatus(
	status: ManagedHookStatus,
	error: unknown,
): ManagedHookStatus {
	return {
		...status,
		state: 'error',
		error: error instanceof Error ? error.message : String(error),
	};
}
