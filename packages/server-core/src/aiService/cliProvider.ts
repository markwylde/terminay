import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import {
	DEFAULT_MAX_CONTEXT_BYTES,
	DEFAULT_MAX_CONTEXT_CHARS,
	DEFAULT_MAX_PROVIDER_OUTPUT_BYTES,
	DEFAULT_MODEL_LIST_TIMEOUT_MS,
	DEFAULT_PROVIDER_TIMEOUT_MS,
	stripTerminalControls,
	trimChars,
	trimUtf8,
	utf8ByteLength,
} from './bounds.js';
import type {
	AiModel,
	AiProvider,
	AiProviderAdapter,
	AiProviderGenerateRequest,
	AiProviderModelRequest,
} from './types.js';
import { AiServiceError } from './types.js';

/** A server-owned provider environment. The object is never included in a
 * protocol result or status snapshot. */
export type ProviderEnvironment = Readonly<Record<string, string>>;

export interface ProviderCliInvocation {
	readonly provider: AiProvider;
	readonly model: string;
	readonly target: 'title' | 'note';
	readonly prompt: string;
}

export interface ProviderCliCommand {
	readonly command: string;
	readonly listArgs?: (provider: AiProvider) => readonly string[];
	readonly generateArgs?: (
		invocation: ProviderCliInvocation,
	) => readonly string[];
	readonly parseModels?: (stdout: string) => readonly AiModel[];
	readonly parseOutput?: (stdout: string) => string;
}

export interface ServerAiProviderOptions {
	/** The server working directory supplied to provider CLIs. */
	readonly cwd: string;
	/** Defaults to the server process environment; callers can provide a
	 * snapshot for deterministic tests or a headless deployment. */
	readonly environment?: Readonly<Record<string, string | undefined>>;
	readonly commands?: Partial<Record<AiProvider, ProviderCliCommand>>;
	readonly configuredModels?: Partial<Record<AiProvider, readonly AiModel[]>>;
	readonly credentialEnvironmentVariables?: Partial<Record<AiProvider, string>>;
	readonly maxOutputBytes?: number;
	readonly providerTimeoutMs?: number;
	readonly modelListTimeoutMs?: number;
	readonly modelCacheMs?: number;
	readonly additionalPathDirectories?: readonly string[];
}

const DEFAULT_MODEL_CACHE_MS = 30_000;
const MAX_ENV_VALUE_BYTES = 64 * 1024;
const providerCredentialEnv: Record<AiProvider, string> = {
	codex: 'OPENAI_API_KEY',
	'claude-code': 'ANTHROPIC_API_KEY',
};

/** Merge the server environment with provider-only additions while enforcing
 * bounded values and no NUL bytes. This is intentionally server-side; clients
 * receive only normalized model metadata and request status. */
export function createProviderEnvironment(
	base: Readonly<Record<string, string | undefined>> = process.env,
	options: {
		readonly additionalPathDirectories?: readonly string[];
		readonly additions?: Readonly<Record<string, string | undefined>>;
	} = {},
): ProviderEnvironment {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries({
		...base,
		...options.additions,
	})) {
		if (value === undefined) continue;
		assertEnvironmentEntry(key, value);
		result[key] = value;
	}

	const additional = options.additionalPathDirectories ?? [];
	const pathDelimiter = process.platform === 'win32' ? ';' : ':';
	const existingPath = result.PATH ?? '';
	const pathEntries = existingPath
		.split(pathDelimiter)
		.filter((entry) => entry.length > 0);
	for (const directory of additional) {
		if (
			typeof directory !== 'string' ||
			directory.length === 0 ||
			directory.includes('\0')
		)
			continue;
		if (!pathEntries.includes(directory)) pathEntries.push(directory);
	}
	if (pathEntries.length > 0) result.PATH = pathEntries.join(pathDelimiter);
	return Object.freeze(result);
}

/** Create bounded Codex/Claude Code adapters. CLI details and credentials stay
 * behind this server-owned adapter boundary; the generic AiMetadataService
 * continues to enforce exact targets, replay bounds, normalization, and
 * cancellation. */
export function createServerAiProviderAdapters(
	options: ServerAiProviderOptions,
): Partial<Record<AiProvider, AiProviderAdapter>> {
	if (
		typeof options.cwd !== 'string' ||
		options.cwd.length === 0 ||
		options.cwd.includes('\0')
	)
		throw new TypeError('provider cwd is invalid');
	const maxOutputBytes =
		options.maxOutputBytes ?? DEFAULT_MAX_PROVIDER_OUTPUT_BYTES;
	const providerTimeoutMs =
		options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
	const modelListTimeoutMs =
		options.modelListTimeoutMs ?? DEFAULT_MODEL_LIST_TIMEOUT_MS;
	const cacheMs = options.modelCacheMs ?? DEFAULT_MODEL_CACHE_MS;
	assertPositive(maxOutputBytes, 'maxOutputBytes');
	assertPositive(providerTimeoutMs, 'providerTimeoutMs');
	assertPositive(modelListTimeoutMs, 'modelListTimeoutMs');
	if (!Number.isSafeInteger(cacheMs) || cacheMs < 0)
		throw new RangeError('modelCacheMs must be non-negative');

	const environment = createProviderEnvironment(options.environment, {
		additionalPathDirectories: options.additionalPathDirectories,
	});
	const commands = {
		codex:
			options.commands?.codex ?? defaultCodexCommand(environment, options.cwd),
		'claude-code':
			options.commands?.['claude-code'] ??
			defaultClaudeCodeCommand(environment),
	} satisfies Record<AiProvider, ProviderCliCommand>;
	validateCommand(commands.codex, 'Codex');
	validateCommand(commands['claude-code'], 'Claude Code');
	const configured = {
		codex:
			options.configuredModels?.codex ??
			configuredModelsFromEnvironment(
				environment.TERMINAY_CODEX_MODELS_JSON,
				maxOutputBytes,
			),
		'claude-code':
			options.configuredModels?.['claude-code'] ??
			configuredModelsFromEnvironment(
				environment.TERMINAY_CLAUDE_CODE_MODELS_JSON,
				maxOutputBytes,
			),
	} satisfies Record<AiProvider, readonly AiModel[] | undefined>;
	const cache = new Map<
		AiProvider,
		{ readonly at: number; readonly models: readonly AiModel[] }
	>();
	const credentialVariables = {
		codex:
			options.credentialEnvironmentVariables?.codex ??
			providerCredentialEnv.codex,
		'claude-code':
			options.credentialEnvironmentVariables?.['claude-code'] ??
			providerCredentialEnv['claude-code'],
	} satisfies Record<AiProvider, string>;

	const createAdapter = (provider: AiProvider): AiProviderAdapter => ({
		listModels: async (request) => {
			assertProviderRequest(
				provider,
				request.provider,
				request.signal,
				request.maxOutputBytes,
			);
			const now = Date.now();
			const previous = cache.get(provider);
			if (previous !== undefined && now - previous.at <= cacheMs)
				return previous.models;
			const configuredModels = configured[provider];
			const models =
				configuredModels === undefined
					? await discoverModels(
							provider,
							commands[provider],
							options.cwd,
							environment,
							credentialVariables[provider],
							modelListTimeoutMs,
							maxOutputBytes,
							request,
						)
					: normalizeModels(configuredModels, maxOutputBytes);
			cache.set(provider, { at: now, models });
			return models;
		},
		generate: async (request) => {
			assertProviderRequest(
				provider,
				request.provider,
				request.signal,
				request.maxOutputBytes,
			);
			const model = normalizeModel(request.model);
			const command = commands[provider];
			if (command.generateArgs === undefined)
				throw new Error(
					`${providerLabel(provider)} generation is unavailable.`,
				);
			const invocation: ProviderCliInvocation = {
				provider,
				model,
				target: request.target,
				prompt: buildPrompt(request),
			};
			const run = (env: ProviderEnvironment): Promise<string> =>
				runCli({
					command: command.command,
					args: command.generateArgs?.(invocation) ?? [],
					cwd: options.cwd,
					environment: env,
					input: invocation.prompt,
					signal: request.signal,
					timeoutMs: providerTimeoutMs,
					maxOutputBytes: Math.min(maxOutputBytes, request.maxOutputBytes),
					providerLabel: providerLabel(provider),
				}).then((stdout) => command.parseOutput?.(stdout) ?? stdout);
			if (request.withCredential === undefined) return run(environment);
			return request.withCredential((secret) => {
				const secretText = new TextDecoder().decode(secret);
				return run(
					withCredential(environment, credentialVariables[provider], secret),
				).then((output) => redactProviderOutput(output, secretText));
			});
		},
	});

	return {
		codex: createAdapter('codex'),
		'claude-code': createAdapter('claude-code'),
	};
}

async function discoverModels(
	provider: AiProvider,
	command: ProviderCliCommand,
	cwd: string,
	environment: ProviderEnvironment,
	credentialVariable: string,
	timeoutMs: number,
	maxOutputBytes: number,
	request: AiProviderModelRequest,
): Promise<readonly AiModel[]> {
	if (command.listArgs === undefined)
		throw new Error(
			`${providerLabel(provider)} model discovery is unavailable.`,
		);
	const run = (env: ProviderEnvironment) =>
		runCli({
			command: command.command,
			args: command.listArgs?.(provider) ?? [],
			cwd,
			environment: env,
			input: '',
			signal: request.signal,
			timeoutMs,
			maxOutputBytes: Math.min(maxOutputBytes, request.maxOutputBytes),
			providerLabel: providerLabel(provider),
		});
	const stdout = await (request.withCredential === undefined
		? run(environment)
		: request.withCredential((secret) => {
				const secretText = new TextDecoder().decode(secret);
				return run(
					withCredential(environment, credentialVariable, secret),
				).then((output) => redactProviderOutput(output, secretText));
			}));
	const models = command.parseModels?.(stdout) ?? parseJsonModels(stdout);
	return normalizeModels(
		models,
		Math.min(maxOutputBytes, request.maxOutputBytes),
	);
}

function defaultCodexCommand(
	environment: ProviderEnvironment,
	cwd: string,
): ProviderCliCommand {
	return {
		command: environment.TERMINAY_CODEX_COMMAND?.trim() || 'codex',
		listArgs: () => ['debug', 'models'],
		generateArgs: ({ model, prompt, target }) => [
			'exec',
			'--model',
			model,
			'--sandbox',
			'read-only',
			'--skip-git-repo-check',
			'--ephemeral',
			'--ignore-rules',
			'--color',
			'never',
			'--cd',
			cwd,
			`${target === 'title' ? 'Generate a concise terminal title.' : 'Generate a concise terminal note.'}\n${prompt}`,
		],
		parseModels: parseCodexModels,
	};
}

function defaultClaudeCodeCommand(
	environment: ProviderEnvironment,
): ProviderCliCommand {
	return {
		command: environment.TERMINAY_CLAUDE_CODE_COMMAND?.trim() || 'claude',
		generateArgs: ({ model }) => [
			'--print',
			'--verbose',
			'--model',
			model,
			'--output-format',
			'stream-json',
			'--include-partial-messages',
			'--no-session-persistence',
			'--permission-mode',
			'dontAsk',
		],
		parseOutput: parseClaudeStreamOutput,
	};
}

function buildPrompt(request: AiProviderGenerateRequest): string {
	const contextText = trimChars(
		trimUtf8(
			stripTerminalControls(request.context.text),
			DEFAULT_MAX_CONTEXT_BYTES,
		).text,
		DEFAULT_MAX_CONTEXT_CHARS,
	).text;
	const currentTitle = trimChars(
		stripTerminalControls(request.context.currentTitle),
		256,
	).text;
	const existingNote = trimChars(
		stripTerminalControls(request.context.existingNote),
		1_024,
	).text;
	return [
		'You are helping Terminay generate terminal metadata.',
		request.target === 'title'
			? 'Return only a short terminal title.'
			: 'Return only one concise terminal note.',
		`Current title: ${currentTitle || '(none)'}`,
		`Existing note: ${existingNote || '(none)'}`,
		'Recent terminal output:',
		contextText || '(no terminal output captured)',
	].join('\n');
}

function parseCodexModels(stdout: string): readonly AiModel[] {
	const value = parseJson(stdout);
	const models =
		value &&
		typeof value === 'object' &&
		Array.isArray((value as { models?: unknown }).models)
			? (value as { models: unknown[] }).models
			: [];
	return models
		.filter(
			(item): item is Record<string, unknown> =>
				typeof item === 'object' && item !== null,
		)
		.filter(
			(item) => typeof item.slug === 'string' && item.slug.trim().length > 0,
		)
		.filter(
			(item) =>
				typeof item.visibility !== 'string' || item.visibility === 'list',
		)
		.sort(
			(left, right) =>
				(typeof left.priority === 'number' ? left.priority : 999) -
				(typeof right.priority === 'number' ? right.priority : 999),
		)
		.map((item) => ({
			id: (item.slug as string).trim(),
			label:
				typeof item.display_name === 'string' && item.display_name.trim()
					? item.display_name.trim()
					: (item.slug as string).trim(),
		}));
}

function parseJsonModels(stdout: string): readonly AiModel[] {
	const value = parseJson(stdout);
	const models = Array.isArray(value)
		? value
		: value &&
				typeof value === 'object' &&
				Array.isArray((value as { models?: unknown }).models)
			? (value as { models: unknown[] }).models
			: [];
	return models.map((item) => {
		if (typeof item === 'string') return { id: item, label: item };
		if (typeof item === 'object' && item !== null) {
			const candidate = item as { id?: unknown; label?: unknown };
			return {
				id: typeof candidate.id === 'string' ? candidate.id : '',
				label:
					typeof candidate.label === 'string'
						? candidate.label
						: ((candidate.id as string) ?? ''),
			};
		}
		return { id: '', label: '' };
	});
}

function configuredModelsFromEnvironment(
	value: string | undefined,
	maxOutputBytes: number,
): readonly AiModel[] | undefined {
	if (value === undefined || value.trim().length === 0) return undefined;
	return normalizeModels(parseJsonModels(value), maxOutputBytes);
}

function parseClaudeStreamOutput(stdout: string): string {
	let text = '';
	for (const line of stdout.split(/\r?\n/)) {
		try {
			const value = JSON.parse(line) as {
				event?: { delta?: { type?: unknown; text?: unknown } };
				type?: unknown;
				message?: { content?: unknown };
			};
			if (
				value.event?.delta?.type === 'text_delta' &&
				typeof value.event.delta.text === 'string'
			)
				text += value.event.delta.text;
			if (value.type === 'assistant' && Array.isArray(value.message?.content)) {
				const content = value.message.content as Array<{
					type?: unknown;
					text?: unknown;
				}>;
				const next = content
					.filter(
						(item) => item.type === 'text' && typeof item.text === 'string',
					)
					.map((item) => item.text as string)
					.join('');
				if (next) text = next;
			}
		} catch {
			// Provider wrappers are ignored; only structured text crosses the boundary.
		}
	}
	return text;
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		throw new Error('provider returned malformed JSON model metadata.');
	}
}

function normalizeModels(
	models: readonly AiModel[],
	maxOutputBytes: number,
): AiModel[] {
	const normalized: AiModel[] = [];
	const seen = new Set<string>();
	for (const item of models) {
		if (normalized.length >= 256 || typeof item !== 'object' || item === null)
			break;
		const id = typeof item.id === 'string' ? item.id.trim() : '';
		if (!id || id.length > 256 || /[\0\r\n]/u.test(id) || seen.has(id))
			continue;
		const label =
			typeof item.label === 'string' && item.label.trim()
				? stripTerminalControls(item.label.trim()).slice(0, 256)
				: id;
		if (!label || /[\0\r\n]/u.test(id) || /[\0\r\n]/u.test(label)) continue;
		normalized.push({ id, label });
		seen.add(id);
	}
	if (utf8ByteLength(JSON.stringify(normalized)) > maxOutputBytes)
		throw new Error('provider model metadata exceeded the output limit.');
	if (normalized.length === 0)
		throw new Error('provider did not return any available models.');
	return normalized;
}

function assertProviderRequest(
	provider: AiProvider,
	requestedProvider: AiProvider,
	signal: AbortSignal,
	maxOutputBytes: number,
): void {
	if (requestedProvider !== provider)
		throw new AiServiceError(
			'invalid_request',
			'provider request does not match the selected adapter.',
		);
	if (!(signal instanceof AbortSignal))
		throw new AiServiceError(
			'invalid_request',
			'provider cancellation signal is required.',
		);
	if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0)
		throw new AiServiceError(
			'invalid_request',
			'provider output limit is invalid.',
		);
}

function normalizeModel(value: string): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.trim().length > 256 ||
		/[\0\r\n]/u.test(value)
	)
		throw new AiServiceError('invalid_request', 'provider model is invalid.');
	return value.trim();
}

function withCredential(
	environment: ProviderEnvironment,
	variable: string,
	secret: Uint8Array,
): ProviderEnvironment {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
		throw new Error('provider credential environment variable is invalid.');
	const value = new TextDecoder().decode(secret);
	assertEnvironmentEntry(variable, value);
	return createProviderEnvironment(environment, {
		additions: { [variable]: value },
	});
}

function runCli(options: {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd: string;
	readonly environment: ProviderEnvironment;
	readonly input: string;
	readonly signal: AbortSignal;
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly providerLabel: string;
}): Promise<string> {
	if (options.signal.aborted)
		return Promise.reject(providerCancelled(options.providerLabel));
	return new Promise((resolve, reject) => {
		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(options.command, options.args, {
				cwd: options.cwd,
				// ProviderEnvironment is deliberately stricter than Node's
				// ProcessEnv (all retained values are bounded strings). The
				// application ambient declaration adds required Vite keys to
				// ProcessEnv, but headless provider subprocesses neither need
				// nor synthesize those renderer-only variables.
				env: options.environment as unknown as NodeJS.ProcessEnv,
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true,
			}) as ChildProcessWithoutNullStreams;
		} catch {
			reject(
				new AiServiceError(
					'provider_unavailable',
					`${options.providerLabel} CLI is unavailable.`,
					true,
				),
			);
			return;
		}
		let stdout = '';
		let stderr = '';
		let outputBytes = 0;
		let tooLarge = false;
		let timedOut = false;
		let settled = false;
		let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
		const terminate = (): void => {
			if (settled) return;
			child.kill('SIGTERM');
			forceKillTimer ??= setTimeout(() => child.kill('SIGKILL'), 250);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			terminate();
		}, options.timeoutMs);
		const abort = (): void => terminate();
		const append = (current: string, chunk: Buffer | string): string => {
			const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
			outputBytes += utf8ByteLength(text);
			if (outputBytes > options.maxOutputBytes) {
				tooLarge = true;
				terminate();
				return current;
			}
			return current + text;
		};
		options.signal.addEventListener('abort', abort, { once: true });
		child.stdout.on('data', (chunk) => {
			stdout = append(stdout, chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr = append(stderr, chunk);
		});
		child.once('error', (error) => finish(error));
		child.once('close', (code, signal) => {
			if (tooLarge)
				finish(
					new AiServiceError(
						'provider_output_too_large',
						`${options.providerLabel} returned an oversized result.`,
					),
				);
			else if (timedOut)
				finish(
					new AiServiceError(
						'provider_timeout',
						`${options.providerLabel} timed out.`,
						true,
					),
				);
			else if (options.signal.aborted)
				finish(providerCancelled(options.providerLabel));
			else if (signal !== null || code !== 0)
				finish(
					new Error(
						stderr.trim() ||
							stdout.trim() ||
							`${options.command} exited without a result.`,
					),
				);
			else finish(undefined, stdout);
		});
		child.stdin.end(options.input);

		function finish(error?: Error, value?: string): void {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
			options.signal.removeEventListener('abort', abort);
			if (error === undefined) resolve(value ?? '');
			else if ((error as NodeJS.ErrnoException).code === 'ENOENT')
				reject(
					new AiServiceError(
						'provider_unavailable',
						`${options.providerLabel} CLI is unavailable.`,
						true,
					),
				);
			else reject(error);
		}
	});
}

function providerCancelled(providerLabel: string): AiServiceError {
	return new AiServiceError(
		'provider_cancelled',
		`${providerLabel} request was cancelled.`,
		true,
	);
}

function redactProviderOutput(output: string, secret: string): string {
	if (secret.length === 0) return output;
	return output.split(secret).join('[redacted]');
}

function validateCommand(
	command: ProviderCliCommand,
	providerLabel: string,
): void {
	if (
		!command ||
		typeof command.command !== 'string' ||
		command.command.trim().length === 0 ||
		command.command.includes('\0')
	)
		throw new TypeError(`${providerLabel} CLI command is invalid.`);
}

function assertEnvironmentEntry(key: string, value: string): void {
	if (
		typeof key !== 'string' ||
		!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
		typeof value !== 'string' ||
		value.includes('\0') ||
		value.includes('\r') ||
		value.includes('\n') ||
		utf8ByteLength(value) > MAX_ENV_VALUE_BYTES
	)
		throw new TypeError('provider environment entry is invalid or oversized.');
}

function assertPositive(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive integer.`);
}

function providerLabel(provider: AiProvider): string {
	return provider === 'claude-code' ? 'Claude Code' : 'Codex';
}
