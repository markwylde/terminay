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
	WINDOW_HANDLE_PATTERN,
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
import {
	MAX_NOTIFICATION_TOOL_BODY_CHARS,
	MAX_NOTIFICATION_TOOL_TITLE_CHARS,
} from './notificationTools.js';
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
	'out_of_scope',
	'busy',
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
				'Open exactly one new terminal. With split, the new terminal is placed in a new pane on that side of beside (a tab id or terminal handle; by default your own terminal) in the Terminay window you are talking from, and opens in that tab\'s project. With focus: true it is brought to the front there; without it, what the user is looking at does not change. From an automation terminal or a chat with no beside, it opens in the automation space unless project names a project handle from list_terminals or get_layout. The result reports placed and the window\'s layout afterwards; placed: false says why it could not be placed. Call once per terminal you want.',
			inputSchema: {
				name: name.optional(),
				cwd: cwd.optional(),
				split: direction.optional(),
				beside: terminal.optional(),
				focus: z.boolean().optional(),
				project: z.string().regex(PROJECT_HANDLE_PATTERN).optional(),
				shell_profile: z
					.string()
					.regex(ID_PATTERN)
					.optional()
					.describe(
						'A shell profile id from list_shell_profiles; the terminal launches with it. An unknown or unavailable profile fails and opens nothing.',
					),
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
			description:
				'Show a terminal in the Terminay window you are talking from: its project, its folder, and its tab in front. Other windows and devices are not changed. Returns the layout afterwards.',
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
		'update_terminal',
		{
			description:
				"Change a terminal tab as the tab editor does, on every device: icon (an emoji; empty clears it), color (a colour; empty follows the project's colour), note (text shown with the tab; null removes it), and activity_tracking (whether the tab shows activity). Give at least one.",
			inputSchema: {
				terminal,
				icon: z.string().max(64).optional(),
				color: z.string().max(128).optional(),
				note: z.string().max(1200).nullable().optional(),
				activity_tracking: z.boolean().optional(),
			},
		},
		async (params, extra) => call('update_terminal', params, extra.signal),
	);
	server.registerTool(
		'move_terminal_to_project',
		{
			description: `Move a running terminal to another project, as dragging its tab there does: it keeps its program, output and scrollback, and lands in that project's General folder at position. It then belongs to the target project, so agents in its old project can no longer address it. The result carries the terminal's handle. Terminals never move into or out of the automation space. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {
				terminal,
				project: z.string().regex(PROJECT_HANDLE_PATTERN),
				position: z.number().int().min(0).optional(),
			},
		},
		async (params, extra) =>
			call('move_terminal_to_project', params, extra.signal),
	);
	server.registerTool(
		'split_terminal',
		{
			description:
				'Open exactly ONE new terminal in a new pane on the given side of terminal, in the Terminay window you are talking from. To get four panes, call it three times (or open terminals and call arrange_tabs with grid). focus: true brings the new terminal to the front. Returns the new terminal handle, placed, and the window\'s layout afterwards; check it rather than assuming.',
			inputSchema: {
				terminal,
				direction,
				name: name.optional(),
				focus: z.boolean().optional(),
			},
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
	registerWorkspaceViewTools(server, call);
	registerAutomationTools(server, call);
	registerAppControlTools(server, call);
	registerSettingsTools(server, call);
	registerMacroTools(server, call);
	registerWindowTools(server, call);
	registerNotificationTools(server, call);
}

const VIEW_NOTE =
	'It acts on the Terminay window you are talking from (the one showing your terminal, or the one that sent this chat its last message) and on no other window or device. It fails with renderer_unavailable when no such window is open.';
const LAYOUT_NOTE =
	'The result carries layout: the window\'s view afterwards, as get_layout describes it.';

function registerWorkspaceViewTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const tab = boundedIdentifier();
	const id = boundedIdentifier();
	const project = z.string().regex(PROJECT_HANDLE_PATTERN);
	const fraction = z.number().min(0.05).max(0.95);
	const folderName = z.string().min(1).max(64);
	server.registerTool(
		'get_layout',
		{
			description: `Describe what the user sees: which project and folder is shown (visible), the project's folders, and its panes as a tree. A split node has split "row" (side by side) or "column" (stacked) and children with size fractions; a pane lists its tabs in order, each with its tab id, terminal handle for terminals, kind, title, and whether it is the pane's active tab; focused_tab is the tab with keyboard focus. Defaults to the shown project; project picks another (automation terminals and chats only), and projects lists them. Call it before and after changing the layout. ${VIEW_NOTE}`,
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
			inputSchema: { project: project.optional() },
		},
		async (params, extra) => call('get_layout', params, extra.signal),
	);
	server.registerTool(
		'focus_tab',
		{
			description: `Bring a tab to the front, switching to its project and folder. tab is a tab id from get_layout or a terminal handle. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { tab },
		},
		async (params, extra) => call('focus_tab', params, extra.signal),
	);
	server.registerTool(
		'move_tab',
		{
			description: `Move a tab into a new pane on one side (right, left, above, below) of the pane holding beside, or into that pane as another tab (center). Terminals keep running and keep their output. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: {
				tab,
				beside: tab,
				position: z.enum(['right', 'left', 'above', 'below', 'center']).default('right'),
			},
		},
		async (params, extra) => call('move_tab', params, extra.signal),
	);
	server.registerTool(
		'resize_pane',
		{
			description: `Resize the pane holding a tab: width and/or height as a fraction (0.05 to 0.95) of the workspace area. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { tab, width: fraction.optional(), height: fraction.optional() },
		},
		async (params, extra) => call('resize_pane', params, extra.signal),
	);
	server.registerTool(
		'arrange_tabs',
		{
			description: `Rearrange the shown folder's tabs, or just the listed tabs, into equal panes: grid (as square as possible, e.g. 4 tabs make 2x2), columns (side by side), rows (stacked), or tabs (one pane, all as tabs). Terminals keep running. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: {
				arrangement: z.enum(['grid', 'columns', 'rows', 'tabs']),
				tabs: z.array(tab).min(1).max(32).optional(),
				project: project.optional(),
			},
		},
		async (params, extra) => call('arrange_tabs', params, extra.signal),
	);
	server.registerTool(
		'focus_project',
		{
			description: `Switch the window to a project, by the project handle get_layout or list_terminals gives. Only automation terminals and chats reach other projects. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { project },
		},
		async (params, extra) => call('focus_project', params, extra.signal),
	);
	server.registerTool(
		'focus_home',
		{
			description: `Show Home in the window, with one of its sections in front: home (the overview), tabs (every tab on this server), or automations. The automation space's terminals are shown under Automations. ${WORKSPACE_REACH_NOTE} ${VIEW_NOTE}`,
			inputSchema: {
				section: z.enum(['home', 'tabs', 'automations']).optional(),
			},
		},
		async (params, extra) => call('focus_home', params, extra.signal),
	);
	server.registerTool(
		'select_folder',
		{
			description: `Show one of a project's folders (from get_layout's folders) in the window. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { folder: id },
		},
		async (params, extra) => call('select_folder', params, extra.signal),
	);
	server.registerTool(
		'create_folder',
		{
			description:
				'Create a folder (a named group of tabs) in your project, or in project. Every device sees it. Returns its folder id.',
			inputSchema: { name: folderName, project: project.optional() },
		},
		async (params, extra) => call('create_folder', params, extra.signal),
	);
	server.registerTool(
		'rename_folder',
		{
			description: 'Rename a folder you or the user made. Every device sees it.',
			inputSchema: { folder: id, name: folderName },
		},
		async (params, extra) => call('rename_folder', params, extra.signal),
	);
	server.registerTool(
		'delete_folder',
		{
			description:
				'Delete an empty folder you or the user made. It fails for the General folder, for a folder that still holds a tab (move or close them first), and for a folder that stands for a Git worktree. Every device sees it.',
			inputSchema: { folder: id },
			annotations: { destructiveHint: true },
		},
		async (params, extra) => call('delete_folder', params, extra.signal),
	);
	server.registerTool(
		'reorder_folders',
		{
			description:
				"Set the order of a project's folders: folders lists every one of that project's folder ids (from get_layout) once, in the new order. Every device sees it.",
			inputSchema: { folders: z.array(id).min(1).max(256) },
		},
		async (params, extra) => call('reorder_folders', params, extra.signal),
	);
	server.registerTool(
		'move_tab_to_folder',
		{
			description:
				'Move a terminal tab to another folder of its project. The terminal keeps running. Every device sees it.',
			inputSchema: { tab, folder: id },
		},
		async (params, extra) => call('move_tab_to_folder', params, extra.signal),
	);
	server.registerTool(
		'open_file',
		{
			description: `Open a file in a viewer tab for the user, by a path inside the project's folder (relative to it, or absolute). You do not receive its content; read files yourself if you need them. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { path: z.string().min(1).max(4096), project: project.optional() },
		},
		async (params, extra) => call('open_file', params, extra.signal),
	);
	server.registerTool(
		'close_tab',
		{
			description: `Close a tab as the user closing it would, including any prompt to keep a busy terminal or save a document; closed says whether it closed. To end a terminal without asking, use close_terminal. ${VIEW_NOTE} ${LAYOUT_NOTE}`,
			inputSchema: { tab },
		},
		async (params, extra) => call('close_tab', params, extra.signal),
	);
}

const WORKSPACE_REACH_NOTE =
	'Only an agent in a terminal under Home, or a chat such as Pixel, can use it; from a project terminal it fails with out_of_scope.';

/** Projects and workspace windows (ADR-0072). */
function registerAppControlTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const project = z.string().regex(PROJECT_HANDLE_PATTERN);
	const window = z.string().regex(WINDOW_HANDLE_PATTERN);
	const root = z
		.string()
		.min(1)
		.max(4096)
		.describe(
			'An absolute path, ~ for the home folder, or a path beginning ~/. It must be an existing folder on the server.',
		);
	const name = z.string().min(1).max(256);
	const presentation = z.string().max(128);
	server.registerTool(
		'list_projects',
		{
			description:
				'List projects with their opaque project handles, names, icons, colours, root folders (null when a project has none), default shell profiles, and the workspace window each is in with its position there. From a project terminal it lists only your own project; from a terminal under Home or a chat it lists every project and the automation space.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_projects', {}, extra.signal),
	);
	server.registerTool(
		'create_project',
		{
			description: `Create a project, started at once, and open its first terminal. root ~ starts it in the home folder with no root folder; any other root becomes its folder and, without a name, names it. It goes into window, or else the window you are talking from, and that window shows it (shown says whether it did). Returns its project handle and first terminal. Nothing here lists or browses folders. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {
				root,
				name: name.optional(),
				icon: presentation.optional(),
				color: presentation.optional(),
				window: window.optional(),
			},
		},
		async (params, extra) => call('create_project', params, extra.signal),
	);
	server.registerTool(
		'update_project',
		{
			description:
				'Change a project: its name, icon, or colour, and, from a terminal under Home or a chat, its root folder (an existing folder) or default shell profile (an id, or null to clear it). From a project terminal, project may be omitted and only your own project\'s name, icon, and colour can change.',
			inputSchema: {
				project: project.optional(),
				name: name.optional(),
				icon: presentation.optional(),
				color: presentation.optional(),
				root: root.optional(),
				shell_profile: z.string().regex(ID_PATTERN).nullable().optional(),
			},
		},
		async (params, extra) => call('update_project', params, extra.signal),
	);
	server.registerTool(
		'move_project',
		{
			description: `Move a project to position in its window, or into another workspace window. Its terminals keep running with their output. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {
				project,
				window: window.optional(),
				position: z.number().int().min(0).optional(),
			},
		},
		async (params, extra) => call('move_project', params, extra.signal),
	);
	server.registerTool(
		'close_project',
		{
			description: `Close a project on every device, ending its terminals. When any of its terminals is running a program it fails with busy and how many, unless force is true. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: { project, force: z.boolean().optional() },
			annotations: { destructiveHint: true },
		},
		async (params, extra) => call('close_project', params, extra.signal),
	);
	server.registerTool(
		'list_workspace_windows',
		{
			description: `List workspace windows: each window's opaque handle, its name, and its projects' handles in order. A workspace window is the server's group of projects, not an app window shown in a terminal. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_workspace_windows', {}, extra.signal),
	);
	server.registerTool(
		'open_workspace_window',
		{
			description: `Create a workspace window, optionally named and holding projects moved into it, and present it where you are talking from: a new window on Desktop, or the shown view in a browser. presented says whether it was. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {
				name: name.optional(),
				projects: z.array(project).max(32).optional(),
			},
		},
		async (params, extra) => call('open_workspace_window', params, extra.signal),
	);
	server.registerTool(
		'rename_workspace_window',
		{
			description: `Rename a workspace window. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: { window, name },
		},
		async (params, extra) =>
			call('rename_workspace_window', params, extra.signal),
	);
	server.registerTool(
		'close_workspace_window',
		{
			description: `Delete a workspace window. It must hold no projects (move or close them first) and must not be the last window. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: { window },
		},
		async (params, extra) =>
			call('close_workspace_window', params, extra.signal),
	);
}

/** Server settings and shell profiles (ADR-0072). */
function registerSettingsTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const profileId = z.string().regex(ID_PATTERN);
	const target = z.discriminatedUnion('kind', [
		z.object({ kind: z.literal('system') }),
		z.object({
			kind: z.literal('executable'),
			executable: z.string().min(1).max(4096),
		}),
		z.object({
			kind: z.literal('wsl'),
			distribution: z.string().min(1).max(256),
			shellPath: z.string().max(4096).optional(),
		}),
	]);
	server.registerTool(
		'get_settings',
		{
			description: `Read this server's settings, as Settings shows them, keyed as update_settings names them (e.g. scrollback, activityIndicators.greenDelaySeconds). Terminay MCP, Remote Access, recording, and shell settings are not included, nor is any credential; a device's own appearance settings (theme, font, shortcuts) are not server settings. ${WORKSPACE_REACH_NOTE}`,
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('get_settings', {}, extra.signal),
	);
	server.registerTool(
		'update_settings',
		{
			description: `Change server settings for every device and terminal, as a change in Settings does. settings maps each setting's dotted path from get_settings to its new value, e.g. { "scrollback": 10000 }. The request applies whole or not at all: a setting MCP cannot reach (Terminay MCP, Remote Access, recording, shell), an unknown one, or a value Settings would not accept fails naming it and changes nothing. ${WORKSPACE_REACH_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: {
				settings: z.record(z.string().min(1).max(256), z.unknown()),
			},
		},
		async (params, extra) => call('update_settings', params, extra.signal),
	);
	server.registerTool(
		'list_shell_profiles',
		{
			description:
				'List the shell profiles new terminals can use, as Settings > Shell shows them: each id, name, kind, target, availability, and whether it is read-only, plus the default profile. Environment values and arguments are never shown, only how many there are. Pass a profile id to open_terminal as shell_profile.',
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_shell_profiles', {}, extra.signal),
	);
	server.registerTool(
		'save_shell_profile',
		{
			description: `Create a shell profile, or with profile.id change one you or the user made, validated as Settings > Shell validates it. Fields you leave out of a change keep their values, including arguments and environment you cannot see; environment replaces the whole overlay when given (a value, or null to unset a variable). Never put a secret in a profile. ${WORKSPACE_REACH_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: {
				profile: z.object({
					id: profileId.optional(),
					name: z.string().min(1).max(128).optional(),
					target: target.optional(),
					args: z.array(z.string().max(4096)).max(64).optional(),
					startup_mode: z.enum(['default', 'login', 'non-login']).optional(),
					environment: z
						.record(z.string().min(1).max(256), z.string().max(16_384).nullable())
						.optional(),
					icon: z.string().max(64).optional(),
					color: z.string().max(128).optional(),
				}),
			},
		},
		async (params, extra) => call('save_shell_profile', params, extra.signal),
	);
	server.registerTool(
		'delete_shell_profile',
		{
			description: `Delete a shell profile you or the user made. It fails while it is the default, or a project's default; change those first. ${WORKSPACE_REACH_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: { profile_id: profileId },
			annotations: { destructiveHint: true },
		},
		async (params, extra) => call('delete_shell_profile', params, extra.signal),
	);
	server.registerTool(
		'reorder_shell_profiles',
		{
			description: `Set the order of the shell profiles you or the user made: profile_ids lists each once, in the new order. ${WORKSPACE_REACH_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: { profile_ids: z.array(profileId).max(64) },
		},
		async (params, extra) => call('reorder_shell_profiles', params, extra.signal),
	);
	server.registerTool(
		'set_default_shell_profile',
		{
			description: `Set the shell profile new terminals use by default: system, or one you or the user made. ${WORKSPACE_REACH_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: { profile_id: profileId },
		},
		async (params, extra) =>
			call('set_default_shell_profile', params, extra.signal),
	);
}

/** Running macros (ADR-0072); creating and editing them is not MCP's. */
function registerMacroTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	server.registerTool(
		'list_macros',
		{
			description:
				"List this server's macros: each id, name, category, and the fields it asks for (name, label, type, whether required, default, and a select field's options).",
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_macros', {}, extra.signal),
	);
	server.registerTool(
		'run_macro',
		{
			description:
				"Run a macro in a terminal you can address, with values for its fields by name; a field left out takes its default. Values are checked as the macro launch form checks them: required fields filled, numbers for number fields, booleans for checkboxes, and one of a select field's options. The server types the macro's steps into the terminal; the run continues until it finishes or is cancelled, whatever happens to you. Returns the run's id.",
			inputSchema: {
				macro_id: z.string().regex(ID_PATTERN),
				terminal: z.string().min(1).max(MAX_TERMINAL_REF_CHARS),
				values: z
					.record(z.string().min(1).max(256), z.union([z.string(), z.number(), z.boolean()]))
					.optional(),
			},
		},
		async (params, extra) => call('run_macro', params, extra.signal),
	);
	server.registerTool(
		'cancel_macro',
		{
			description:
				'Cancel a macro run that run_macro started, in a terminal you can address.',
			inputSchema: { run_id: z.string().regex(ID_PATTERN) },
		},
		async (params, extra) => call('cancel_macro', params, extra.signal),
	);
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
	server.registerTool(
		'remove_automation_run',
		{
			description: `Delete one finished run from an automation's history. A run in progress cannot be deleted; stop it first. ${APPROVAL_NOTE}`,
			inputSchema: { run_id: z.string().regex(ID_PATTERN) },
			annotations: { destructiveHint: true, openWorldHint: false },
		},
		async (params, extra) => call('remove_automation_run', params, extra.signal),
	);
	server.registerTool(
		'prune_automation_runs',
		{
			description: `Delete an automation's finished runs that started more than older_than_days whole days ago; 0 deletes every finished run. Runs in progress stay. ${APPROVAL_NOTE}`,
			inputSchema: {
				automation_id: automationId,
				older_than_days: z.number().int().min(0).max(3650),
			},
			annotations: { destructiveHint: true, openWorldHint: false },
		},
		async (params, extra) => call('prune_automation_runs', params, extra.signal),
	);
	server.registerTool(
		'dismiss_missed_runs',
		{
			description: `Clear the notice that an automation missed scheduled runs while Terminay was not running, for automation_id or, without it, for every automation. It runs nothing. ${APPROVAL_NOTE}`,
			inputSchema: { automation_id: automationId.optional() },
		},
		async (params, extra) => call('dismiss_missed_runs', params, extra.signal),
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

const NOTIFICATION_NOTE =
	'A notification is shown to the user only if it is still present after a short settle period of about five seconds. It is removed when the user interacts with this terminal by clicking or typing in it, including within that period, so do not rely on it to say something they must read.';

function registerNotificationTools(
	server: McpServer,
	call: (
		operation: ControlOperation,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	) => Promise<CallToolResult>,
): void {
	const handle = z.string().regex(ID_PATTERN);
	server.registerTool(
		'send_notification',
		{
			description: `Send the user a notification from the terminal you are running in: a short plain-text body with an optional title, listed with Terminay's other notifications against this terminal. Use it to say that work has finished or that you need the user while they are elsewhere. Pass the handle of a notification you sent to replace its title and body in place. This terminal may hold at most 8 notifications it sent. ${NOTIFICATION_NOTE} Returns the notification's handle. ${APPROVAL_NOTE}`,
			inputSchema: {
				body: z
					.string()
					.min(1)
					.max(MAX_NOTIFICATION_TOOL_BODY_CHARS)
					.refine((value) => value.trim().length > 0, 'body must not be blank'),
				title: z.string().max(MAX_NOTIFICATION_TOOL_TITLE_CHARS).optional(),
				notification: handle.optional(),
			},
		},
		async (params, extra) => call('send_notification', params, extra.signal),
	);
	server.registerTool(
		'list_notifications',
		{
			description:
				"List the notifications shown to the user for terminals you can address: each one's handle, kind (agent-finished, agent-waiting, agent-blocked, command-finished, attention, or message), title and body where it has them, and its terminal's handle. From a project terminal that is your own project's terminals; from a terminal under Home or a chat, every terminal on this server.",
			inputSchema: {},
			annotations: READ_ONLY_TOOL_ANNOTATIONS,
		},
		async (_params, extra) => call('list_notifications', {}, extra.signal),
	);
	server.registerTool(
		'dismiss_notification',
		{
			description: `Remove one notification by handle: one you sent from this terminal (send_notification's handle), or one list_notifications gave you. Dismissing a terminal's activity notification, such as an agent finishing, marks that terminal seen, as the user dismissing it does. A sent one dismissed before the settle period ends is never shown to the user. ${NOTIFICATION_NOTE} ${APPROVAL_NOTE}`,
			inputSchema: { notification: handle },
		},
		async (params, extra) => call('dismiss_notification', params, extra.signal),
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
