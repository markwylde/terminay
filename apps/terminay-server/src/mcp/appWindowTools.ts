import type {
	AppWindowCsp,
	MAX_AGENT_WINDOW_HTML_BYTES as ServerMaxHtmlBytes,
	MAX_APP_WINDOW_DATA_BYTES as ServerMaxDataBytes,
	MAX_APP_WINDOW_TITLE_CHARS as ServerMaxTitleChars,
} from '@terminay/server-core';
import type { JsonValue } from '@terminay/protocol';
import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The MCP tools that show app windows (ADR-0037): the agent's own HTML through
 * `show_window`, and the views of connected MCP servers' tools. Every window
 * is opened in the calling terminal, which the capability fixes; no parameter
 * names a terminal.
 */

// Type-only imports keep the stdio entry, which reaches this module through
// the dispatcher, free of server-core at runtime; `satisfies` pins the literal
// to its source. The binding to the window store lives in appWindowAdapter.ts.
export const MAX_WINDOW_TITLE_CHARS = 80 as const satisfies typeof ServerMaxTitleChars;
export const MAX_WINDOW_HTML_BYTES = (512 * 1024) as 524288 satisfies typeof ServerMaxHtmlBytes;
export const MAX_WINDOW_DATA_BYTES = (64 * 1024) as 65536 satisfies typeof ServerMaxDataBytes;

/** A connected server's result larger than this is replaced by an error. */
export const MAX_CONNECTED_TOOL_RESULT_BYTES = 1024 * 1024;
export const MCP_APP_RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

export interface ShowWindowParams {
	readonly title: string;
	readonly html: string;
	/** A JSON value the document reads as `window.terminay.data`. */
	readonly data?: JsonValue;
	/** Handle of an agent-authored window of this terminal to replace. */
	readonly window?: string;
}
export interface CloseWindowParams {
	readonly window: string;
}
export interface CallConnectedToolParams {
	readonly name: string;
	readonly arguments: Readonly<Record<string, JsonValue>>;
}

/** A connected server's tool as the agent sees it. */
export interface ConnectedTool {
	/** `<entry>__<tool>`. */
	readonly name: string;
	readonly description?: string;
	readonly inputSchema: JsonValue;
	readonly title?: string;
	readonly annotations?: JsonValue;
}

/** The UI a connected tool declares. */
export interface ConnectedToolUi {
	readonly entry: string;
	readonly tool: string;
	readonly resourceUri: string;
	readonly title: string;
	/** The upstream tool definition, given to the view as host context. */
	readonly definition: JsonValue;
}

export interface ConnectedUiResource {
	readonly html: string;
	readonly mimeType?: string;
	readonly csp?: AppWindowCsp;
	readonly permissions?: Readonly<Record<string, unknown>>;
}

/**
 * Terminay's client side of the user's connected MCP servers. Every method is
 * scoped to one project: a local server runs once per project, in its root.
 */
export interface ConnectedToolGateway {
	/** Model-visible tools of every connected entry, named `<entry>__<tool>`. */
	listTools(projectId: string, signal: AbortSignal): Promise<readonly ConnectedTool[]>;
	/** The UI a model-visible tool declares, if any. Throws for an unknown tool. */
	toolUi(
		projectId: string,
		name: string,
		signal: AbortSignal,
	): Promise<ConnectedToolUi | undefined>;
	callTool(
		projectId: string,
		name: string,
		args: Readonly<Record<string, JsonValue>>,
		signal: AbortSignal,
	): Promise<JsonValue>;
	readUiResource(
		projectId: string,
		ui: ConnectedToolUi,
		signal: AbortSignal,
	): Promise<ConnectedUiResource>;
	/** Changes whenever the set of tools offered to a project may have. */
	revision(projectId: string): string;
	onChanged(listener: () => void): () => void;
}

export function parseListConnectedTools(
	params: Record<string, unknown>,
): Parsed<{ readonly after?: string }> {
	if (params.after === undefined) return {};
	if (typeof params.after !== 'string' || params.after.length > 128)
		return badRequest('after must be a revision');
	return { after: params.after };
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;

type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the window tools; each method is already past the MCP
 * permission gate for its own group when it is called. */
export interface AppWindowControlAdapter {
	readonly showWindow: Handler<ShowWindowParams>;
	readonly closeWindow: Handler<CloseWindowParams>;
	readonly listWindows: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	/**
	 * With `after`, answers only once the offered set's revision differs from
	 * it: one held request per change, which is how the stdio adapter learns to
	 * tell its agent the tool list changed.
	 */
	readonly listConnectedTools: (
		context: ControlRequestContext,
		signal: AbortSignal,
		after?: string,
	) => unknown | Promise<unknown>;
	readonly callConnectedTool: (
		params: CallConnectedToolParams,
		context: ControlRequestContext,
		signal: AbortSignal,
		/** Whether App Windows permits a view for this call. May wait on a user. */
		mayShowWindow: () => Promise<boolean>,
	) => unknown | Promise<unknown>;
}

export function isAppWindowParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONNECTED_TOOL_NAME = /^[a-z0-9][a-z0-9-]{0,62}__[A-Za-z0-9_.-]{1,128}$/u;

export function parseShowWindow(
	params: Record<string, unknown>,
): Parsed<ShowWindowParams> {
	if (typeof params.title !== 'string' || params.title.trim().length === 0)
		return badRequest('title must be a non-empty string');
	if ([...params.title.trim()].length > MAX_WINDOW_TITLE_CHARS)
		return badRequest(
			`title must be at most ${MAX_WINDOW_TITLE_CHARS} characters`,
		);
	if (typeof params.html !== 'string' || params.html.length === 0)
		return badRequest('html must be a non-empty string');
	if (params.window !== undefined && !isHandle(params.window))
		return badRequest('window must be a window handle');
	if (params.data !== undefined && !fitsWindowData(params.data))
		return badRequest(
			`data must be a JSON value of at most ${MAX_WINDOW_DATA_BYTES / 1024} KiB`,
		);
	return {
		title: params.title,
		html: params.html,
		...(params.data === undefined ? {} : { data: params.data as JsonValue }),
		...(params.window === undefined ? {} : { window: params.window as string }),
	};
}

/** Whether a value serialises to JSON within the window-data bound. */
export function fitsWindowData(value: unknown): boolean {
	let serialised: string | undefined;
	try {
		serialised = JSON.stringify(value);
	} catch {
		return false;
	}
	return (
		serialised !== undefined &&
		Buffer.byteLength(serialised, 'utf8') <= MAX_WINDOW_DATA_BYTES
	);
}

export function parseCloseWindow(
	params: Record<string, unknown>,
): Parsed<CloseWindowParams> {
	if (!isHandle(params.window))
		return badRequest('window must be a window handle');
	return { window: params.window };
}

export function parseCallConnectedTool(
	params: Record<string, unknown>,
): Parsed<CallConnectedToolParams> {
	if (typeof params.name !== 'string' || !CONNECTED_TOOL_NAME.test(params.name))
		return badRequest('name must be a connected tool name');
	const args = params.arguments ?? {};
	if (typeof args !== 'object' || args === null || Array.isArray(args))
		return badRequest('arguments must be an object');
	return {
		name: params.name,
		arguments: args as Readonly<Record<string, JsonValue>>,
	};
}

export function appWindowFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return failure(code, message);
}

function isHandle(value: unknown): value is string {
	return typeof value === 'string' && HANDLE_PATTERN.test(value);
}

function badRequest(message: string): Failure {
	return failure('bad_request', message);
}

function failure(code: ControlError['code'], message: string): Failure {
	return { ok: false, error: { code, message } };
}
