import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { isAbsolute } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	type CallToolResult,
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
	CONTROL_LARGE_FRAME_OPERATIONS,
	CONTROL_MAX_FRAME_BYTES,
	CONTROL_MAX_LARGE_FRAME_BYTES,
	CONTROL_MAX_LARGE_RESPONSE_BYTES,
	CONTROL_MAX_RESPONSE_BYTES,
	CONTROL_PROTOCOL_VERSION,
	type ControlError,
	type ControlErrorCode,
	ControlFrameDecoder,
	type ControlOperation,
	type ControlResponse,
	encodeControlMessage,
	MAX_MODEL_CONTEXT_BYTES,
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
import {
	fitsWindowData,
	MAX_WINDOW_HTML_BYTES,
	MAX_WINDOW_TITLE_CHARS,
} from './appWindowTools.js';
import { readWindowDocument } from './windowDocument.js';
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
	): Promise<ControlReply>;
	close(): void;
}

/** A successful control response: its result, and any text a window in the
 * calling terminal left for the model. */
interface ControlReply {
	readonly result: unknown;
	readonly modelContext?: string;
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
			const reply = await client.request(operation, params, signal);
			const text = boundedResultText(operation, reply.result);
			return {
				content: [{ type: 'text' as const, text }, ...contextBlocks(reply)],
			};
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
	const stopWatchingConnectedTools = serveConnectedTools(server, client);

	// The SDK transport does not observe stdin EOF itself. Close the local
	// capability socket when the MCP host closes stdin so pending waits cannot
	// keep a headless process alive indefinitely.
	const transport = new StdioServerTransport();
	const closeClient = (): void => {
		stopWatchingConnectedTools();
		client.close();
	};
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
	registerWindowTools(server, call);
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
			kind: z.literal('promptAgent'),
			command: z
				.string()
				.min(1)
				.max(16_384)
				.describe(
					'The command line that receives the prompt, written in full, e.g. `my-agent "$PROMPT"`. Nothing is added to it.',
				),
			prompt: z
				.string()
				.min(1)
				.max(32_768)
				.describe(
					'Free multi-line text passed to the command verbatim as the PROMPT environment variable. It needs no shell escaping.',
				),
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

function registerWindowTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const handle = z.string().regex(ID_PATTERN);
	server.registerTool(
		'show_window',
		{
			description: `Show the user an interactive window in the terminal you are running in, built from your own HTML. Use it when a picture, a form, a table, or a small tool communicates better than text: a chart, a diff viewer, a picker, a preview. The document is a complete HTML page, given either inline as html or as html_file, the absolute path of an HTML file on this machine; give exactly one. To reuse one design, save it as a file and pass html_file with data, any JSON value up to 64 KiB, which the page reads as window.terminay.data before its own scripts run (undefined when none was given): that avoids writing the document out again. The file's contents are shown to the user and are not returned to you. Inline <script> and <style> work, and the page may load scripts, styles, images, and fonts from, and fetch, any https origin. It runs sandboxed: it has no access to the terminal, the filesystem, or cookies, and cannot keep data between runs, so put everything it needs in the document or in data. The window sizes itself to the content up to 60% of the terminal's height. Pass the handle of a window you opened to replace its content and data in place. To hear back from the user, call window.terminay.sendMessage("text") from a button the user presses: the text is typed into this terminal as the user's next message. It works only as the result of a click or key press in the window, once each time the window is open (sending minimises it), and the text must be plain text. The user can attach files to that message: pass the File objects they picked, from an <input type="file">, as window.terminay.sendMessage("text", { files }), up to 16; each is saved on this machine and its path is added to the message on its own "Attached: <path>" line for you to open. The page is never told the path. window.terminay.attachments is false where files cannot be sent. window.terminay.updateContext("text") quietly attaches text to your next tool result, window.terminay.openLink(url) opens an http(s) link in the user's browser when they click, and window.terminay.close() closes the window. Ordinary links work: one to "#id" scrolls, and one to a web page opens in the browser. The page cannot navigate itself or call document.write after it has loaded; a window that does is stopped. Returns the window's handle. ${APPROVAL_NOTE}`,
			inputSchema: {
				title: z
					.string()
					.min(1)
					.max(MAX_WINDOW_TITLE_CHARS)
					.refine((value) => value.trim().length > 0, 'title must not be blank'),
				html: z
					.string()
					.min(1)
					.refine(
						(value) => Buffer.byteLength(value, 'utf8') <= MAX_WINDOW_HTML_BYTES,
						'html must be at most 512 KiB',
					)
					.optional(),
				html_file: z.string().min(1).max(MAX_CWD_CHARS).optional(),
				data: z
					.unknown()
					.refine(
						(value) => value === undefined || fitsWindowData(value),
						'data must be a JSON value of at most 64 KiB',
					)
					.optional(),
				window: handle.optional(),
			},
		},
		async ({ html_file: htmlFile, ...params }, extra) => {
			if ((params.html === undefined) === (htmlFile === undefined))
				return toolFailure('bad_request', 'give exactly one of html and html_file');
			if (htmlFile === undefined)
				return call('show_window', params, extra.signal);
			// Read here, in the agent's own process tree: the server is sent the
			// document and never the path (ADR-0045).
			const document = await readWindowDocument(htmlFile, MAX_WINDOW_HTML_BYTES);
			return document.ok
				? call('show_window', { ...params, html: document.html }, extra.signal)
				: toolFailure(document.code, document.message);
		},
	);
	server.registerTool(
		'close_window',
		{
			description: `Close one window in the terminal you are running in, by the handle show_window or list_windows returned. ${APPROVAL_NOTE}`,
			inputSchema: { window: handle },
		},
		async (params, extra) => call('close_window', params, extra.signal),
	);
	server.registerTool(
		'list_windows',
		{
			description:
				'List the windows in the terminal you are running in, each with its handle, title, source, and whether it is open or minimised.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_windows', {}, extra.signal),
	);
}

type ToolsListHandler = (
	request: unknown,
	extra: unknown,
) => Promise<{ tools: unknown[] }>;
type ToolsCallHandler = (
	request: { params: { name: string; arguments?: Record<string, unknown> } },
	extra: { signal?: AbortSignal },
) => Promise<CallToolResult>;

/**
 * Carry the tools of the user's connected MCP servers (ADR-0037). Terminay's
 * own tools stay registered with McpServer; its list and call handlers are
 * wrapped so a connected tool, named `<entry>__<tool>`, is listed after them
 * and forwarded through the control socket. A failure to reach connected
 * servers never hides Terminay's own tools.
 *
 * Returns a function that stops watching for tool-list changes.
 */
function serveConnectedTools(
	server: McpServer,
	client: LocalControlClient,
): () => void {
	const handlers = (
		server.server as unknown as {
			_requestHandlers: Map<string, unknown>;
		}
	)._requestHandlers;
	const ownList = handlers.get('tools/list') as ToolsListHandler | undefined;
	const ownCall = handlers.get('tools/call') as ToolsCallHandler | undefined;
	if (ownList === undefined || ownCall === undefined)
		throw new Error('Terminay MCP tool handlers are not registered');
	let revision = '';

	const listConnected = async (
		signal?: AbortSignal,
		after?: string,
	): Promise<unknown[]> => {
		const reply = await client.request(
			'list_connected_tools',
			after === undefined ? {} : { after },
			signal,
		);
		const result = isRecord(reply.result) ? reply.result : {};
		const tools = Array.isArray(result.tools) ? result.tools : [];
		const valid = tools.filter(
			(tool): tool is Record<string, unknown> =>
				isRecord(tool) &&
				typeof tool.name === 'string' &&
				CONNECTED_TOOL_NAME.test(tool.name) &&
				isRecord(tool.inputSchema),
		);
		if (typeof result.revision === 'string') revision = result.revision;
		return valid;
	};

	server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
		const own = await ownList(request, extra);
		let extraTools: unknown[] = [];
		try {
			extraTools = await listConnected();
		} catch {
			// Terminay's own tools are still offered.
		}
		return { ...own, tools: [...own.tools, ...extraTools] } as never;
	});
	server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const name = request.params.name;
		if (!CONNECTED_TOOL_NAME.test(name))
			return (await ownCall(request as never, extra)) as never;
		try {
			const reply = await client.request(
				'call_connected_tool',
				{ name, arguments: request.params.arguments ?? {} },
				extra.signal,
			);
			const result = isRecord(reply.result) ? reply.result : {};
			const content = Array.isArray(result.content) ? result.content : [];
			return {
				...result,
				content: [...content, ...contextBlocks(reply)],
			} as never;
		} catch (error) {
			const typed = toMcpControlError(error);
			return {
				isError: true,
				content: [{ type: 'text', text: `${typed.code}: ${typed.message}` }],
			} as never;
		}
	});

	// One held request per change: the server answers only once the offered
	// set differs from `revision`. This is a watch, not a poll, and it stops
	// for good when the socket or the feature is gone.
	const watch = new AbortController();
	void (async () => {
		try {
			// Learn the current revision first, so only a later change notifies.
			await listConnected(watch.signal);
			while (!watch.signal.aborted) {
				// A host that reports no revision, or answers a held request
				// without one changing, cannot be watched; never spin on it.
				if (revision === '') return;
				const before = revision;
				await listConnected(watch.signal, before);
				if (watch.signal.aborted || revision === before) return;
				await server.server.sendToolListChanged().catch(() => {});
			}
		} catch {
			// The socket closed or this host has no such operation.
		}
	})();
	return () => watch.abort();
}

const CONNECTED_TOOL_NAME = /^[a-z0-9][a-z0-9-]{0,62}__[A-Za-z0-9_.-]{1,128}$/u;

function frameLimit(operation: ControlOperation): number {
	return CONTROL_LARGE_FRAME_OPERATIONS.has(operation)
		? CONTROL_MAX_LARGE_FRAME_BYTES
		: CONTROL_MAX_FRAME_BYTES;
}

function replyOf(response: ControlResponse & { ok: true }): ControlReply {
	return {
		result: response.result,
		...(response.modelContext === undefined
			? {}
			: { modelContext: response.modelContext }),
	};
}

/** A refusal the adapter makes itself, in the shape a refused control request takes. */
function toolFailure(code: ControlErrorCode, message: string): CallToolResult {
	return {
		isError: true,
		content: [{ type: 'text', text: `${code}: ${message}` }],
		structuredContent: { error: { code, message } },
	};
}

function contextBlocks(
	reply: ControlReply,
): { type: 'text'; text: string }[] {
	return reply.modelContext === undefined
		? []
		: [{ type: 'text', text: reply.modelContext }];
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
		{ resolve: (value: ControlReply) => void; reject: (error: Error) => void }
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
		const decoder = new ControlFrameDecoder(CONTROL_MAX_LARGE_RESPONSE_BYTES);
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
				if (response.ok) waiter.resolve(replyOf(response));
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
					if (Buffer.byteLength(encoded, 'utf8') > frameLimit(operation))
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
	): Promise<ControlReply> {
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
		if (Buffer.byteLength(encoded, 'utf8') > frameLimit(operation))
			return Promise.reject(
				new ServerMcpControlError({
					code: 'limit_exceeded',
					message: 'The MCP control request exceeded its size limit.',
				}),
			);
		return new Promise((resolve, reject) => {
			const decoder = new ControlFrameDecoder(CONTROL_MAX_LARGE_RESPONSE_BYTES);
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
							? resolve(replyOf(response))
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
		return {
			id: value.id,
			ok: true,
			result: value.result,
			...(typeof value.modelContext === 'string' &&
			Buffer.byteLength(value.modelContext, 'utf8') <= MAX_MODEL_CONTEXT_BYTES
				? { modelContext: value.modelContext }
				: {}),
		};
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
