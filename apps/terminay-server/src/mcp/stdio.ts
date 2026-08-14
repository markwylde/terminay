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
	request(
		operation: ControlOperation,
		params: Record<string, unknown>,
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
	) => {
		try {
			const result = await client.request(operation, params);
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
	) => Promise<CallToolResult>,
): void {
	const terminal = boundedIdentifier();
	const text = boundedText();
	const name = boundedIdentifier(MAX_NAME_CHARS);
	const cwd = boundedIdentifier(MAX_CWD_CHARS);
	const direction = z.enum(['right', 'left', 'above', 'below']);
	const timeout = z
		.number()
		.finite()
		.positive()
		.max(MAX_WAIT_SECONDS)
		.optional();
	server.registerTool(
		'list_terminals',
		{
			description: 'List sibling terminals in the calling project.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async () => call('list_terminals', {}),
	);
	server.registerTool(
		'read_terminal',
		{
			description: 'Read bounded terminal output.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: {
				terminal,
				lines: z.number().int().positive().max(4096).optional(),
			},
		},
		async ({ terminal: target, lines }) =>
			call('read_terminal', {
				terminal: target,
				...(lines === undefined ? {} : { lines }),
			}),
	);
	server.registerTool(
		'get_terminal_status',
		{
			description: 'Read canonical terminal status.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal },
		},
		async ({ terminal: target }) =>
			call('get_terminal_status', { terminal: target }),
	);
	server.registerTool(
		'open_terminal',
		{
			description: 'Open a sibling terminal.',
			inputSchema: {
				name: name.optional(),
				cwd: cwd.optional(),
				split: direction.optional(),
			},
		},
		async (params) => call('open_terminal', params),
	);
	server.registerTool(
		'write_terminal',
		{
			description: 'Write exact text to a live sibling terminal.',
			inputSchema: { terminal, text, submit: z.boolean().optional() },
		},
		async (params) => call('write_terminal', params),
	);
	server.registerTool(
		'run_command',
		{
			description: 'Submit one bounded command.',
			inputSchema: { terminal, command: text },
		},
		async (params) => call('run_command', params),
	);
	server.registerTool(
		'close_terminal',
		{ description: 'Close a sibling terminal.', inputSchema: { terminal } },
		async ({ terminal: target }) =>
			call('close_terminal', { terminal: target }),
	);
	server.registerTool(
		'focus_terminal',
		{
			description: 'Mark a sibling terminal active in the logical workspace.',
			inputSchema: { terminal },
		},
		async ({ terminal: target }) =>
			call('focus_terminal', { terminal: target }),
	);
	server.registerTool(
		'rename_terminal',
		{
			description: 'Rename a sibling terminal.',
			inputSchema: { terminal, name },
		},
		async (params) => call('rename_terminal', params),
	);
	server.registerTool(
		'split_terminal',
		{
			description: 'Split beside a sibling terminal.',
			inputSchema: { terminal, direction },
		},
		async (params) => call('split_terminal', params),
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
		async (params) => call('wait_for_idle', params),
	);
	server.registerTool(
		'wait_for_command',
		{
			description: 'Wait for the next command completion.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal, timeout },
		},
		async (params) => call('wait_for_command', params),
	);
	server.registerTool(
		'wait_for_attention',
		{
			description: 'Wait for canonical terminal attention.',
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { terminal, timeout },
		},
		async (params) => call('wait_for_attention', params),
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
	return {
		request(operation, params) {
			if (closed)
				return Promise.reject(new Error('Terminay MCP client is closed'));
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
			for (const waiter of pending.values())
				waiter.reject(new Error('Terminay MCP client closed'));
			pending.clear();
		},
	};
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
