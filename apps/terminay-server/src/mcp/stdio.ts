import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
	CONTROL_MAX_FRAME_BYTES,
	CONTROL_MAX_RESPONSE_BYTES,
	CONTROL_PROTOCOL_VERSION,
	type ControlError,
	type ControlErrorCode,
	ControlFrameDecoder,
	type ControlOperation,
	type ControlResponse,
	encodeControlMessage,
} from './controlEndpoint.js';
import {
	DEFAULT_READ_MAX_BYTES,
	DEFAULT_SEARCH_CONTEXT_LINES,
	DEFAULT_SEARCH_MAX_BYTES,
	DEFAULT_SEARCH_MAX_MATCHES,
	MAX_READ_MAX_BYTES,
	MAX_SEARCH_CONTEXT_LINES,
	MAX_SEARCH_MAX_BYTES,
	MAX_SEARCH_MAX_MATCHES,
	MAX_SEARCH_QUERY_CHARS,
	PROJECT_HANDLE_PATTERN,
} from './dispatcher.js';
import {
	DEFAULT_AUTOMATION_RUNS_LIMIT,
	MAX_AUTOMATION_RUNS_LIMIT,
	MCP_AUTOMATION_EVENT_KINDS,
} from './automationTools.js';
import { SERVER_MCP_ENTRY } from './ownership.js';

export { SERVER_MCP_ENTRY } from './ownership.js';

const MAX_TEXT_BYTES = 64 * 1024;
const MAX_TERMINAL_REF_CHARS = 256;
const MAX_NAME_CHARS = 256;
const MAX_CWD_CHARS = 4096;
const MAX_WAIT_SECONDS = 60 * 60;
const MAX_IN_FLIGHT = 8;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_ERROR_CODES: ReadonlySet<ControlErrorCode> = new Set([
	'invalid_token',
	'not_in_terminay',
	'terminal_not_found',
	'ambiguous_terminal',
	'renderer_unavailable',
	'cancelled',
	'limit_exceeded',
	'timeout',
	'unsupported_op',
	'bad_request',
	'forbidden',
	'not_found',
	'conflict',
	'permission_denied',
	'permission_declined',
	'approval_queue_full',
	'internal',
]);
const READ_ONLY_TOOL_ANNOTATIONS = Object.freeze({
	readOnlyHint: true,
	destructiveHint: false,
	openWorldHint: false,
});

/** Stable, bounded error returned by the headless adapter for a control reply. */
export class ServerMcpControlError extends Error {
	readonly code: ControlErrorCode;
	readonly candidates: readonly string[] | undefined;

	constructor(error: ControlError) {
		super(boundedMessage(error.message));
		this.name = 'ServerMcpControlError';
		this.code = error.code;
		this.candidates = error.candidates
			?.filter(
				(candidate) =>
					typeof candidate === 'string' && ID_PATTERN.test(candidate),
			)
			.slice(0, 32);
	}
}

/** Alias retained for callers that refer to the MCP-facing error by its short name. */
export const McpControlError = ServerMcpControlError;

export interface ServerMcpStdioOptions {
	readonly socketPath: string;
	readonly token: string;
	readonly version?: string;
}

interface LocalControlClient {
	/** With a signal, the request gets its own connection, and aborting it
	 * closes that connection so the server cancels the operation (and
	 * withdraws any approval it is waiting on). */
	request(
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown>;
	close(): void;
}

/** Headless MCP adapter for the server-owned local control socket. This file
 * has no Electron/renderer imports; the token is accepted only from the
 * caller's inherited environment and is never sent through MCP payloads. */
export async function runServerMcpStdio(
	options: ServerMcpStdioOptions,
): Promise<void> {
	assertStdioOptions(options);
	const client = createLocalControlClient(options.socketPath, options.token);
	const server = new McpServer({
		name: 'terminay',
		version: options.version ?? SERVER_MCP_ENTRY.protocolVersion,
	});
	const call = async (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => {
		try {
			const result = await client.request(operation, params, signal);
			const text = boundedResultText(operation, result);
			return { content: [{ type: 'text' as const, text }] };
		} catch (error) {
			const typed = toMcpControlError(error);
			return {
				isError: true,
				content: [
					{ type: 'text' as const, text: `${typed.code}: ${typed.message}` },
				],
				structuredContent: {
					error: {
						code: typed.code,
						message: typed.message,
						...(typed.candidates === undefined
							? {}
							: { candidates: typed.candidates }),
					},
				},
			};
		}
	};
	registerTools(server, call);

	// The SDK transport does not observe stdin EOF itself. Close the local
	// capability socket when the MCP host closes stdin so pending waits cannot
	// keep a headless process alive indefinitely.
	const transport = new StdioServerTransport();
	const closeClient = (): void => client.close();
	transport.onclose = closeClient;
	process.stdin.once('end', closeClient);
	process.stdin.once('close', closeClient);
	try {
		await server.connect(transport);
	} catch (error) {
		client.close();
		throw error;
	}
}

function registerTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const terminal = boundedIdentifier();
	const text = boundedText();
	const name = boundedIdentifier(MAX_NAME_CHARS);
	const cwd = boundedIdentifier(MAX_CWD_CHARS);
	const direction = z.enum(['right', 'left', 'above', 'below']);
	const searchQuery = boundedSearchQuery();
	const readTerminal = z
		.object({
			terminal,
			format: z.enum(['text', 'ansi', 'raw']).default('text'),
			max_bytes: z
				.number()
				.int()
				.positive()
				.max(MAX_READ_MAX_BYTES)
				.default(DEFAULT_READ_MAX_BYTES),
			lines: z.number().int().positive().max(4096).optional(),
			after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
		})
		.superRefine((value, context) => {
			if (value.format !== 'text' && value.lines !== undefined) {
				context.addIssue({
					code: 'custom',
					path: ['lines'],
					message: 'lines is available only for text reads',
				});
			}
			if (value.format !== 'raw' && value.after !== undefined) {
				context.addIssue({
					code: 'custom',
					path: ['after'],
					message: 'after is available only for raw reads',
				});
			}
		});
	const timeout = z
		.number()
		.finite()
		.positive()
		.max(MAX_WAIT_SECONDS)
		.optional();
	server.registerTool(
		'get_mcp_capabilities',
		{
			description:
				'Report adapter-global MCP tool availability before calling an optional operation. Availability applies to the bound host, not to an individual terminal.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_args, extra) => call('get_mcp_capabilities', {}, extra.signal),
	);
	server.registerTool(
		'list_terminals',
		{
			description:
				'List sibling terminals in the calling project. From an automation terminal, list every terminal on this server, each with an opaque project handle and project title. A terminal cwd is its local launch directory and is not a remote filesystem path for an SSH session.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_args, extra) => call('list_terminals', {}, extra.signal),
	);
	server.registerTool(
		'read_terminal',
		{
			description:
				'Read bounded terminal output. format=text (the default) returns emulated visual rows as plain text without terminal control sequences. format=ansi returns an emulated ANSI presentation, including terminal control sequences needed to reproduce it. format=raw returns the retained PTY stream without emulation; only raw reads accept after, an exclusive raw output-byte cursor. lines applies only to text visual rows. max_bytes defaults to 16384 and is capped at 65536; reads truncate instead of failing for output size.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: readTerminal,
		},
		async (
			{ terminal: target, format, max_bytes: maxBytes, lines, after },
			extra,
		) =>
			call(
				'read_terminal',
				{
					terminal: target,
					format,
					max_bytes: maxBytes,
					...(lines === undefined ? {} : { lines }),
					...(after === undefined ? {} : { after }),
				},
				extra.signal,
			),
	);
	server.registerTool(
		'search_terminal',
		{
			description:
				'Search the current emulated text presentation using a bounded literal Unicode query, never a regular expression or raw PTY bytes. Results are snapshot-scoped visual rows with bounded surrounding context; returned row indexes are not cursors.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: {
				terminal,
				query: searchQuery,
				case_sensitive: z.boolean().default(true),
				context_lines: z
					.number()
					.int()
					.min(0)
					.max(MAX_SEARCH_CONTEXT_LINES)
					.default(DEFAULT_SEARCH_CONTEXT_LINES),
				max_matches: z
					.number()
					.int()
					.positive()
					.max(MAX_SEARCH_MAX_MATCHES)
					.default(DEFAULT_SEARCH_MAX_MATCHES),
				max_bytes: z
					.number()
					.int()
					.positive()
					.max(MAX_SEARCH_MAX_BYTES)
					.default(DEFAULT_SEARCH_MAX_BYTES),
			},
		},
		async (
			{
				terminal: target,
				query,
				case_sensitive: caseSensitive,
				context_lines: contextLines,
				max_matches: maxMatches,
				max_bytes: maxBytes,
			},
			extra,
		) =>
			call(
				'search_terminal',
				{
					terminal: target,
					query,
					case_sensitive: caseSensitive,
					context_lines: contextLines,
					max_matches: maxMatches,
					max_bytes: maxBytes,
				},
				extra.signal,
			),
	);
	server.registerTool(
		'get_terminal_status',
		{
			description: 'Read canonical terminal status.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal },
		},
		async ({ terminal: target }, extra) =>
			call('get_terminal_status', { terminal: target }, extra.signal),
	);
	server.registerTool(
		'open_terminal',
		{
			description:
				'Open a sibling terminal. From an automation terminal, the terminal opens in the automation space unless project names a project handle returned by list_terminals.',
			inputSchema: {
				name: name.optional(),
				cwd: cwd.optional(),
				split: direction.optional(),
				project: z.string().regex(PROJECT_HANDLE_PATTERN).optional(),
			},
		},
		async (params, extra) => call('open_terminal', params, extra.signal),
	);
	server.registerTool(
		'write_terminal',
		{
			description: 'Write exact text to a live sibling terminal.',
			inputSchema: { terminal, text, submit: z.boolean().optional() },
		},
		async (params, extra) => call('write_terminal', params, extra.signal),
	);
	server.registerTool(
		'run_command',
		{
			description:
				'Submit one bounded command as if pasted and followed by Enter. The command is wrapped in bracketed-paste markers only when the foreground program has enabled bracketed paste (DECSET 2004); otherwise it is sent as a plain paste, so each line break submits a line. The result reports terminal, command_id, from, submitted_bytes, and bracketed; from is the raw output cursor captured immediately before submission, submitted_bytes measures all UTF-8 bytes written to the PTY, including any bracketed-paste framing and the submission carriage return, never output bytes, and bracketed reports whether the markers were used. Typical workflow: run_command, optionally wait_for_command when get_mcp_capabilities says it is available, then read_terminal with format=raw and after=from. command_id identifies this MCP submission only; wait_for_command reports the next observed completion and does not attribute it to command_id.',
			inputSchema: { terminal, command: text },
		},
		async (params, extra) => call('run_command', params, extra.signal),
	);
	server.registerTool(
		'close_terminal',
		{ description: 'Close a sibling terminal.', inputSchema: { terminal } },
		async ({ terminal: target }, extra) =>
			call('close_terminal', { terminal: target }, extra.signal),
	);
	server.registerTool(
		'focus_terminal',
		{
			description: 'Mark a sibling terminal active in the logical workspace.',
			inputSchema: { terminal },
		},
		async ({ terminal: target }, extra) =>
			call('focus_terminal', { terminal: target }, extra.signal),
	);
	server.registerTool(
		'rename_terminal',
		{
			description: 'Rename a sibling terminal.',
			inputSchema: { terminal, name },
		},
		async (params, extra) => call('rename_terminal', params, extra.signal),
	);
	server.registerTool(
		'split_terminal',
		{
			description: 'Split beside a sibling terminal.',
			inputSchema: { terminal, direction },
		},
		async (params, extra) => call('split_terminal', params, extra.signal),
	);
	server.registerTool(
		'wait_for_idle',
		{
			description: 'Wait for canonical terminal inactivity.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: {
				terminal,
				seconds: z.number().finite().nonnegative().max(MAX_WAIT_SECONDS),
				timeout,
			},
		},
		async (params, extra) => call('wait_for_idle', params, extra.signal),
	);
	server.registerTool(
		'wait_for_command',
		{
			description:
				'Wait for the next observed structured command completion. Check get_mcp_capabilities before use: some adapters cannot observe command completion. This tool does not correlate a completion with a run_command command_id.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal, timeout },
		},
		async (params, extra) => call('wait_for_command', params, extra.signal),
	);
	server.registerTool(
		'wait_for_attention',
		{
			description: 'Wait for canonical terminal attention.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal, timeout },
		},
		async (params, extra) => call('wait_for_attention', params, extra.signal),
	);
	registerAutomationTools(server, call);
}

const APPROVAL_NOTE =
	'The user may require approval for this in Settings > AI > Terminay MCP; the call then waits until they answer an inline prompt in this terminal and fails with permission_declined if they decline, or permission_denied if the operation is set to Never Allow.';

function registerAutomationTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const automationId = z.string().regex(ID_PATTERN);
	const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
	const trigger = z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('schedule'),
			cron: z
				.string()
				.min(1)
				.max(256)
				.describe(
					'Five-field cron expression (minute hour day-of-month month day-of-week) in the server time zone, e.g. "0 9 * * 1-5".',
				),
		}),
		z.object({ kind: z.literal('event'), event: z.enum(MCP_AUTOMATION_EVENT_KINDS) }),
	]);
	const action = z.discriminatedUnion('kind', [
		z.object({
			kind: z.literal('runCommand'),
			command: z.string().min(1).max(16_384),
			shellProfileId: z.string().regex(ID_PATTERN).optional(),
			cwd: z
				.string()
				.max(4096)
				.optional()
				.describe('Working directory; defaults to the home directory.'),
			maxDurationSeconds: z.number().int().positive().max(604_800).optional(),
		}),
		z.object({
			kind: z.literal('runMacro'),
			macroId: z.string().regex(ID_PATTERN),
			fieldValues: z
				.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
				.optional(),
		}),
		z.object({
			kind: z.literal('writeText'),
			text: z.string().max(16_384),
			submit: z.boolean().optional(),
		}),
	]);
	const settings = z.object({
		keepTerminalAfterRun: z.boolean().optional(),
		recordSession: z.boolean().optional(),
		cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
	});
	const definition = {
		name: z.string().min(1).max(200),
		enabled: z.boolean().optional(),
		trigger,
		action,
		settings: settings.optional(),
	};
	server.registerTool(
		'list_automations',
		{
			description:
				'List every automation on this Terminay server, with its trigger in plain words, next scheduled run, last run outcome, and the revision to pass when changing one. Automations belong to the server, not to a project.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_args, extra) => call('list_automations', {}, extra.signal),
	);
	server.registerTool(
		'get_automation',
		{
			description: 'Read one automation\'s full definition and the current revision.',
			inputSchema: { automation_id: automationId },
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (params, extra) => call('get_automation', params, extra.signal),
	);
	server.registerTool(
		'list_automation_runs',
		{
			description:
				'List one automation\'s most recent runs, newest first, with outcome, exit code, and final output. Runs about another project\'s terminal omit the subject and output.',
			inputSchema: {
				automation_id: automationId,
				limit: z
					.number()
					.int()
					.positive()
					.max(MAX_AUTOMATION_RUNS_LIMIT)
					.default(DEFAULT_AUTOMATION_RUNS_LIMIT),
			},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (params, extra) => call('list_automation_runs', params, extra.signal),
	);
	server.registerTool(
		'create_automation',
		{
			description: `Create an automation: one trigger (a cron schedule or a Terminay event) and one action (run a command in a new terminal outside every project, or, for terminal events, run a Macro or write text into the subject terminal). ${APPROVAL_NOTE}`,
			inputSchema: definition,
		},
		async (params, extra) => call('create_automation', params, extra.signal),
	);
	server.registerTool(
		'update_automation',
		{
			description: `Change an automation. Fields you omit keep their current values. Pass the revision from list_automations or get_automation; a stale revision fails with conflict. ${APPROVAL_NOTE}`,
			inputSchema: {
				automation_id: automationId,
				revision,
				name: definition.name.optional(),
				enabled: definition.enabled,
				trigger: trigger.optional(),
				action: action.optional(),
				settings: definition.settings,
			},
		},
		async (params, extra) => call('update_automation', params, extra.signal),
	);
	server.registerTool(
		'delete_automation',
		{
			description: `Delete an automation. Runs already in progress keep running. ${APPROVAL_NOTE}`,
			inputSchema: { automation_id: automationId, revision: revision.optional() },
			annotations: { destructiveHint: true, openWorldHint: false },
		},
		async (params, extra) => call('delete_automation', params, extra.signal),
	);
	server.registerTool(
		'set_automation_enabled',
		{
			description: `Enable or disable an automation. ${APPROVAL_NOTE}`,
			inputSchema: {
				automation_id: automationId,
				enabled: z.boolean(),
				revision: revision.optional(),
			},
		},
		async (params, extra) => call('set_automation_enabled', params, extra.signal),
	);
	server.registerTool(
		'run_automation',
		{
			description: `Start one run of an automation now. A Macro or write-text automation needs terminal: a terminal handle from list_terminals. ${APPROVAL_NOTE}`,
			inputSchema: {
				automation_id: automationId,
				terminal: z.string().min(1).max(MAX_TERMINAL_REF_CHARS).optional(),
			},
		},
		async (params, extra) => call('run_automation', params, extra.signal),
	);
	server.registerTool(
		'stop_automation_run',
		{
			description: `Stop an automation run that is in progress. ${APPROVAL_NOTE}`,
			inputSchema: { run_id: z.string().regex(ID_PATTERN) },
		},
		async (params, extra) => call('stop_automation_run', params, extra.signal),
	);
}

function boundedIdentifier(maxChars = MAX_TERMINAL_REF_CHARS): z.ZodString {
	return z
		.string()
		.min(1)
		.max(maxChars)
		.refine((value) => value.trim().length > 0, 'value must not be blank')
		.refine((value) => !value.includes('\0'), 'NUL is not allowed');
}

function boundedText(): z.ZodString {
	return z
		.string()
		.max(MAX_TEXT_BYTES)
		.refine((value) => !value.includes('\0'), 'NUL is not allowed')
		.refine(
			(value) => Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES,
			'text exceeds the byte limit',
		);
}

function boundedSearchQuery(): z.ZodString {
	return z
		.string()
		.min(1)
		.max(MAX_SEARCH_QUERY_CHARS)
		.refine((value) => !value.includes('\0'), 'NUL is not allowed')
		.refine(
			(value) => Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES,
			'query exceeds the byte limit',
		);
}

function assertStdioOptions(options: ServerMcpStdioOptions): void {
	if (options === undefined || options === null || typeof options !== 'object')
		throw new TypeError('MCP options are required');
	if (typeof options.socketPath !== 'string' || options.socketPath.length === 0)
		throw new TypeError(
			'Terminay MCP requires an absolute local control socket',
		);
	if (
		!options.socketPath.startsWith('\\\\.\\pipe\\') &&
		(!isAbsolute(options.socketPath) ||
			/^(?:tcp|udp|http|https):\/\//i.test(options.socketPath))
	) {
		throw new TypeError(
			'Terminay MCP requires an absolute local control socket',
		);
	}
	if (
		typeof options.token !== 'string' ||
		options.token.length === 0 ||
		options.token.length > 512 ||
		/[\0\n\r]/u.test(options.token)
	) {
		throw new TypeError(
			'Terminay MCP requires an inherited terminal capability',
		);
	}
	if (
		options.version !== undefined &&
		(typeof options.version !== 'string' ||
			options.version.length === 0 ||
			options.version.length > 128)
	)
		throw new TypeError('MCP version is invalid');
}

function boundedResultText(
	operation: ControlOperation,
	result: unknown,
): string {
	let serialized: string;
	try {
		serialized = JSON.stringify(result) ?? 'null';
	} catch {
		throw new ServerMcpControlError({
			code: 'internal',
			message: 'The control result was not serializable.',
		});
	}
	if (Buffer.byteLength(serialized, 'utf8') > CONTROL_MAX_RESPONSE_BYTES) {
		throw new ServerMcpControlError({
			code: 'limit_exceeded',
			message: 'The control result exceeded its size limit.',
		});
	}
	return `${operation} ok\n${serialized}`;
}

function toMcpControlError(error: unknown): ServerMcpControlError {
	if (error instanceof ServerMcpControlError) return error;
	return new ServerMcpControlError({
		code: 'internal',
		message: 'The control operation failed.',
	});
}

function createLocalControlClient(
	socketPath: string,
	token: string,
): LocalControlClient {
	let socket: Socket | undefined;
	let closed = false;
	const pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	// Socket callbacks can arrive after a replacement connection has already
	// been created.  Only the socket that raised the failure may clear/reject
	// the active client state; otherwise a late close from a poisoned socket
	// could take down a later, healthy MCP request.
	const reject = (error: Error, source?: Socket): void => {
		if (source !== undefined && socket !== source) return;
		for (const waiter of pending.values()) waiter.reject(error);
		pending.clear();
		socket = undefined;
	};
	const ensure = (): Socket => {
		if (socket !== undefined) return socket;
		const decoder = new ControlFrameDecoder(CONTROL_MAX_RESPONSE_BYTES);
		const candidate = connect(socketPath);
		socket = candidate;
		candidate.on('data', (chunk: Buffer) => {
			let values: unknown[];
			try {
				values = decoder.push(chunk);
			} catch (error) {
				reject(
					new ServerMcpControlError({
						code: 'internal',
						message:
							error instanceof Error
								? error.message
								: 'Malformed control response',
					}),
					candidate,
				);
				candidate.destroy();
				return;
			}
			for (const value of values) {
				const response = parseControlResponse(value);
				if (response === null) {
					reject(
						new ServerMcpControlError({
							code: 'internal',
							message: 'Malformed control response.',
						}),
						candidate,
					);
					candidate.destroy();
					return;
				}
				const waiter = pending.get(response.id);
				if (waiter === undefined) continue;
				pending.delete(response.id);
				if (response.ok) waiter.resolve(response.result);
				else waiter.reject(new ServerMcpControlError(response.error));
			}
		});
		candidate.on('error', (error) => reject(error, candidate));
		candidate.on('close', () => {
			if (!closed)
				reject(new Error('Terminay control socket closed'), candidate);
		});
		return candidate;
	};
	const dedicated = new Set<Socket>();
	return {
		request(operation, params, signal) {
			if (closed)
				return Promise.reject(new Error('Terminay MCP client is closed'));
			if (signal !== undefined)
				return requestOnDedicatedSocket(operation, params, signal);
			if (pending.size >= MAX_IN_FLIGHT)
				return Promise.reject(
					new ServerMcpControlError({
						code: 'limit_exceeded',
						message: 'The MCP control concurrency limit was exceeded.',
					}),
				);
			const id = randomUUID();
			return new Promise((resolve, reject) => {
				pending.set(id, { resolve, reject });
				try {
					const encoded = encodeControlMessage({
						id,
						token,
						version: CONTROL_PROTOCOL_VERSION,
						op: operation,
						params,
					});
					if (Buffer.byteLength(encoded, 'utf8') > CONTROL_MAX_FRAME_BYTES)
						throw new ServerMcpControlError({
							code: 'limit_exceeded',
							message: 'The MCP control request exceeded its size limit.',
						});
					ensure().write(encoded);
				} catch (error) {
					pending.delete(id);
					reject(error instanceof Error ? error : new Error(String(error)));
				}
			});
		},
		close() {
			closed = true;
			socket?.destroy();
			socket = undefined;
			for (const candidate of dedicated) candidate.destroy();
			dedicated.clear();
			for (const waiter of pending.values())
				waiter.reject(new Error('Terminay MCP client closed'));
			pending.clear();
		},
	};

	/**
	 * One request on its own connection. The control protocol has no cancel
	 * frame; closing the connection is how a caller cancels, so an MCP
	 * cancellation reaches the operation and withdraws any pending approval.
	 */
	function requestOnDedicatedSocket(
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown> {
		if (signal.aborted)
			return Promise.reject(
				new ServerMcpControlError({
					code: 'cancelled',
					message: 'The MCP request was cancelled.',
				}),
			);
		if (dedicated.size + pending.size >= MAX_IN_FLIGHT)
			return Promise.reject(
				new ServerMcpControlError({
					code: 'limit_exceeded',
					message: 'The MCP control concurrency limit was exceeded.',
				}),
			);
		const id = randomUUID();
		let encoded: string;
		try {
			encoded = encodeControlMessage({
				id,
				token,
				version: CONTROL_PROTOCOL_VERSION,
				op: operation,
				params,
			});
		} catch (error) {
			return Promise.reject(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		if (Buffer.byteLength(encoded, 'utf8') > CONTROL_MAX_FRAME_BYTES)
			return Promise.reject(
				new ServerMcpControlError({
					code: 'limit_exceeded',
					message: 'The MCP control request exceeded its size limit.',
				}),
			);
		return new Promise((resolve, reject) => {
			const decoder = new ControlFrameDecoder(CONTROL_MAX_RESPONSE_BYTES);
			const connection = connect(socketPath);
			dedicated.add(connection);
			let settled = false;
			const settle = (outcome: () => void): void => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', onAbort);
				dedicated.delete(connection);
				connection.destroy();
				outcome();
			};
			const onAbort = (): void =>
				settle(() =>
					reject(
						new ServerMcpControlError({
							code: 'cancelled',
							message: 'The MCP request was cancelled.',
						}),
					),
				);
			signal.addEventListener('abort', onAbort, { once: true });
			connection.on('data', (chunk: Buffer) => {
				let values: unknown[];
				try {
					values = decoder.push(chunk);
				} catch (error) {
					settle(() =>
						reject(
							new ServerMcpControlError({
								code: 'internal',
								message:
									error instanceof Error
										? error.message
										: 'Malformed control response',
							}),
						),
					);
					return;
				}
				for (const value of values) {
					const response = parseControlResponse(value);
					if (response === null || response.id !== id) {
						settle(() =>
							reject(
								new ServerMcpControlError({
									code: 'internal',
									message: 'Malformed control response.',
								}),
							),
						);
						return;
					}
					settle(() =>
						response.ok
							? resolve(response.result)
							: reject(new ServerMcpControlError(response.error)),
					);
					return;
				}
			});
			connection.on('error', (error) => settle(() => reject(error)));
			connection.on('close', () =>
				settle(() => reject(new Error('Terminay control socket closed'))),
			);
			connection.write(encoded);
		});
	}
}

function parseControlResponse(value: unknown): ControlResponse | null {
	if (
		!isRecord(value) ||
		typeof value.id !== 'string' ||
		value.id.length === 0 ||
		value.id.length > 128 ||
		typeof value.ok !== 'boolean'
	)
		return null;
	if (value.ok === true)
		return { id: value.id, ok: true, result: value.result };
	if (
		!isRecord(value.error) ||
		!isControlErrorCode(value.error.code) ||
		typeof value.error.message !== 'string'
	)
		return null;
	const candidates = value.error.candidates;
	if (
		candidates !== undefined &&
		(!Array.isArray(candidates) ||
			candidates.length > 32 ||
			candidates.some(
				(candidate) =>
					typeof candidate !== 'string' ||
					candidate.length === 0 ||
					candidate.length > 128,
			))
	)
		return null;
	const error: ControlError = {
		code: value.error.code,
		message: boundedMessage(value.error.message),
		...(candidates === undefined ? {} : { candidates: candidates as string[] }),
	};
	return { id: value.id, ok: false, error };
}

function boundedMessage(value: string): string {
	let message = value.slice(0, 4096);
	while (Buffer.byteLength(message, 'utf8') > 4096)
		message = message.slice(0, -1);
	return message;
}

function isControlErrorCode(value: unknown): value is ControlErrorCode {
	return (
		typeof value === 'string' &&
		CONTROL_ERROR_CODES.has(value as ControlErrorCode)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}
