import {
	type AppWindowError,
	type AppWindowService,
	type AppWindowView,
	MAX_APP_WINDOW_TITLE_CHARS,
	MAX_MCP_APP_RESOURCE_BYTES,
} from '@terminay/server-core';
import type { JsonValue } from '@terminay/protocol';
import {
	type AppWindowControlAdapter,
	appWindowFailure as failure,
	type CallConnectedToolParams,
	type ConnectedToolGateway,
	type ConnectedToolUi,
	MAX_CONNECTED_TOOL_RESULT_BYTES,
	MCP_APP_RESOURCE_MIME_TYPE,
} from './appWindowTools.js';
import type { ControlRequestContext } from './controlEndpoint.js';

/** The revision reported while no connected-server gateway is bound. */
const NO_GATEWAY_REVISION = 'none';

/**
 * Binds the window tools to the server-owned window store and the gateway.
 * Kept apart from appWindowTools.ts because it loads server-core.
 */

export interface AppWindowControlAdapterOptions {
	/** Structural, so a host may compose the store from source or from dist. */
	readonly windows: Pick<
		AppWindowService,
		| 'open'
		| 'replace'
		| 'close'
		| 'list'
		| 'setToolResult'
		| 'setToolCancelled'
	>;
	/** Absent when no host binding for connected servers exists. */
	readonly gateway?: ConnectedToolGateway;
}

/** Bind the window tools to the server-owned window store and the gateway. */
export function createAppWindowControlAdapter(
	options: AppWindowControlAdapterOptions,
): AppWindowControlAdapter {
	const { windows, gateway } = options;
	return {
		showWindow: (params, context) => {
			try {
				const window =
					params.window === undefined
						? windows.open({
								terminalSessionId: context.terminalSessionId,
								projectId: context.projectId,
								title: params.title,
								source: { kind: 'agent' },
								html: params.html,
								...(params.data === undefined ? {} : { data: params.data }),
							})
						: windows.replace(context.terminalSessionId, params.window, {
								title: params.title,
								html: params.html,
								...(params.data === undefined ? {} : { data: params.data }),
							});
				return {
					window: window.id,
					title: window.title,
					state: window.state,
					shown:
						'The window is open in the terminal you are running in. The user can see and use it.',
				};
			} catch (error) {
				return windowFailure(error);
			}
		},
		closeWindow: (params, context) =>
			windows.close(context.terminalSessionId, params.window)
				? { window: params.window, closed: true }
				: failure('not_found', 'This terminal has no window with that handle.'),
		listWindows: (context) => ({
			windows: windows.list(context.terminalSessionId).map(describeWindow),
		}),
		listConnectedTools: async (context, signal, after) => {
			const revision = (): string =>
				gateway?.revision(context.projectId) ?? NO_GATEWAY_REVISION;
			if (after !== undefined && after === revision()) {
				// Nothing has changed since the caller last looked. Wait for a
				// change rather than for the request timer.
				const resume = context.holdDeadline?.();
				try {
					await changed(signal, revision, after);
				} finally {
					resume?.();
				}
			}
			return {
				tools:
					gateway === undefined
						? []
						: await gateway.listTools(context.projectId, signal),
				revision: revision(),
			};
		},
		callConnectedTool: async (params, context, signal, mayShowWindow) => {
			if (gateway === undefined)
				return failure('unsupported_op', 'No MCP servers are connected.');
			const ui = await gateway.toolUi(context.projectId, params.name, signal);
			const window =
				ui === undefined
					? undefined
					: await openToolWindow(ui, params, context, signal, mayShowWindow);
			let result: JsonValue;
			try {
				result = await gateway.callTool(
					context.projectId,
					params.name,
					params.arguments,
					signal,
				);
			} catch (error) {
				if (window !== undefined)
					windows.setToolCancelled(
						window.id,
						error instanceof Error ? error.message : 'The tool call failed.',
					);
				throw error;
			}
			// Nothing over the limit reaches the agent or the view.
			if (
				Buffer.byteLength(JSON.stringify(result), 'utf8') >
				MAX_CONNECTED_TOOL_RESULT_BYTES
			) {
				const message = `The result of ${params.name} is larger than 1 MiB.`;
				if (window !== undefined) windows.setToolCancelled(window.id, message);
				return failure('limit_exceeded', message);
			}
			if (window !== undefined) windows.setToolResult(window.id, result);
			return window === undefined
				? result
				: withViewNotice(result, window.title);
		},
	};

	function changed(
		signal: AbortSignal,
		revision: () => string,
		after: string,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const stop = gateway?.onChanged(() => {
				if (revision() === after) return;
				finish();
				resolve();
			});
			const onAbort = (): void => {
				finish();
				reject(
					Object.assign(new Error('The control operation was cancelled.'), {
						code: 'cancelled',
					}),
				);
			};
			const finish = (): void => {
				stop?.();
				signal.removeEventListener('abort', onAbort);
			};
			if (signal.aborted) onAbort();
			else signal.addEventListener('abort', onAbort, { once: true });
		});
	}

	async function openToolWindow(
		ui: ConnectedToolUi,
		params: CallConnectedToolParams,
		context: ControlRequestContext,
		signal: AbortSignal,
		mayShowWindow: () => Promise<boolean>,
	): Promise<AppWindowView | undefined> {
		if (gateway === undefined || !(await mayShowWindow())) return undefined;
		try {
			const resource = await gateway.readUiResource(
				context.projectId,
				ui,
				signal,
			);
			// Only a resource that says it is an MCP App view is shown as one.
			// Compared as a media type, not as a string: case and the space after
			// the semicolon are not part of it.
			if (
				resource.mimeType?.toLowerCase().replace(/\s+/gu, '') !==
				MCP_APP_RESOURCE_MIME_TYPE
			)
				return undefined;
			if (
				Buffer.byteLength(resource.html, 'utf8') > MAX_MCP_APP_RESOURCE_BYTES
			)
				return undefined;
			return windows.open({
				terminalSessionId: context.terminalSessionId,
				projectId: context.projectId,
				title: ui.title.trim().slice(0, MAX_APP_WINDOW_TITLE_CHARS) || ui.tool,
				source: {
					kind: 'mcp-app',
					server: ui.entry,
					tool: ui.tool,
					resourceUri: ui.resourceUri,
				},
				html: resource.html,
				...(resource.csp === undefined ? {} : { csp: resource.csp }),
				...(resource.permissions === undefined
					? {}
					: { permissions: resource.permissions }),
				tool: ui.definition,
				toolInput: params.arguments as JsonValue,
			});
		} catch {
			// A view is an enhancement: when it cannot be shown the tool still
			// runs and the agent receives its ordinary result.
			return undefined;
		}
	}
}

function describeWindow(window: AppWindowView): Record<string, unknown> {
	return {
		window: window.id,
		title: window.title,
		source:
			window.source.kind === 'agent'
				? 'agent'
				: `${window.source.server}__${window.source.tool}`,
		state: window.state,
	};
}

/** Tell the model a person is looking at an interactive view of this result. */
function withViewNotice(result: JsonValue, title: string): JsonValue {
	const notice = {
		type: 'text',
		text: `"${title}" is open as an interactive view in the user's terminal. They can see and use it, so do not restate its contents.`,
	};
	if (typeof result !== 'object' || result === null || Array.isArray(result))
		return { content: [notice] };
	const content = Array.isArray(result.content) ? result.content : [];
	return { ...result, content: [notice, ...content] };
}

function windowFailure(error: unknown): ReturnType<typeof failure> {
	// Matched by shape, not by class: a host may compose the window store from
	// a different copy of server-core than this adapter was built against, and
	// `instanceof` would then miss every one of its errors.
	if (!isAppWindowError(error)) throw error;
	switch (error.code) {
		case 'window_not_found':
			return failure('not_found', error.message);
		case 'window_limit':
		case 'window_too_large':
			return failure('limit_exceeded', error.message);
		default:
			return failure('bad_request', error.message);
	}
}

function isAppWindowError(error: unknown): error is AppWindowError {
	return (
		error instanceof Error &&
		error.name === 'AppWindowError' &&
		typeof (error as { code?: unknown }).code === 'string'
	);
}
