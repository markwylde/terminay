import { EXTENSION_LIMITS } from './constants.js';
import type {
	Disposable,
	ExtensionPlatform,
	McpServerCommand,
} from './types.js';

/**
 * Chat providers run the turns of chats the host owns. The host keeps the
 * conversation, mints MCP capabilities, and shows approvals; a provider starts
 * the user's agent confined to the MCP server the host hands it, sends it what
 * the user typed, and reports what comes back.
 */

/** Declarative metadata for one chat provider. */
export interface AgentChatProviderContribution {
	/** Namespaced: `<extensionId>/<local-id>`. */
	id: string;
	/** The agent's name as Terminay shows it, e.g. `Claude Code`. */
	displayName: string;
	description?: string;
	platforms?: ExtensionPlatform[];
}

export type AgentChatUnavailableReason =
	| 'not_installed'
	| 'not_signed_in'
	| 'unsupported_platform';

export type AgentChatAvailability =
	| { available: true; detail?: string }
	| { available: false; reason: AgentChatUnavailableReason; detail?: string };

/** The host-supplied MCP server a session may use, and the only one. */
export interface AgentChatMcpServer extends McpServerCommand {
	/** The name the agent must register it under, e.g. `terminay_chat`. */
	name: string;
}

export interface AgentChatSessionRequest {
	/** Opaque, host-issued; one per provider session. */
	sessionId: string;
	/** An empty, private directory the host created for this session. */
	workingDirectory: string;
	/** Text the creating server feature asks the agent to follow. */
	instruction?: string;
	/** `null` when the chat has no MCP reach: the agent can only converse. */
	mcpServer: AgentChatMcpServer | null;
}

export type AgentChatToolState = 'running' | 'completed' | 'failed';

/**
 * A tool call the agent made. Only names cross to the host, never arguments
 * or results.
 */
export interface AgentChatToolEvent {
	/** Stable within the session, e.g. the agent's tool-use id. */
	callId: string;
	/** The MCP server name for an MCP tool; absent for a built-in tool. */
	server?: string;
	/** The tool name, or a kind such as `command` for a built-in tool. */
	name: string;
	state: AgentChatToolState;
}

export type AgentChatFailureReason =
	| 'not_installed'
	| 'not_signed_in'
	| 'crashed'
	| 'failed';

export interface AgentChatFailure {
	reason: AgentChatFailureReason;
	/** Bounded, plain words, e.g. the agent's own error message. */
	detail?: string;
}

export interface AgentChatExit {
	code: number | null;
	signal: string | null;
}

/** Where a session reports what happens. Calls after `exit` are ignored. */
export interface AgentChatEvents {
	/** Reply text as it arrives. */
	text(delta: string): void;
	tool(event: AgentChatToolEvent): void;
	/** The current turn, or the session, failed. */
	failure(failure: AgentChatFailure): void;
	/** The agent process ended. The session cannot be used afterwards. */
	exit(exit: AgentChatExit): void;
}

export interface AgentChatSession {
	/**
	 * Runs one turn. Resolves when the agent finishes replying, or when
	 * `cancel` stopped it; rejects (after reporting a failure) when it fails.
	 */
	prompt(text: string, signal: AbortSignal): Promise<void>;
	/** Stops the turn in progress, keeping the session. */
	cancel(): void | Promise<void>;
	/** Ends the session and its agent process. */
	close(): void | Promise<void>;
}

export interface AgentChatProviderRuntime {
	/** Whether this server account can run the agent right now. */
	availability(signal: AbortSignal): Promise<AgentChatAvailability>;
	/**
	 * Starts one session confined to `request.mcpServer`. The agent's built-in
	 * tools stay off where it allows that, no other MCP server is loaded, every
	 * request for another tool is declined, and nothing is written to the
	 * agent's own configuration.
	 */
	openSession(
		request: AgentChatSessionRequest,
		events: AgentChatEvents,
		signal: AbortSignal,
	): Promise<AgentChatSession>;
}

export interface AgentChatProviderRegistration extends Disposable {
	readonly providerId: string;
}

export interface AgentChatProviderRegistry {
	/**
	 * Registers a chat provider this manifest contributed. An undeclared id,
	 * a second registration of the same id, or a registration after
	 * deactivation is refused.
	 */
	registerChatProvider(
		providerId: string,
		runtime: AgentChatProviderRuntime,
	): AgentChatProviderRegistration;
}

export function defineChatProvider(
	runtime: AgentChatProviderRuntime,
): AgentChatProviderRuntime {
	return runtime;
}

const unavailableReasons: readonly string[] = [
	'not_installed',
	'not_signed_in',
	'unsupported_platform',
];
const failureReasons: readonly string[] = [
	'not_installed',
	'not_signed_in',
	'crashed',
	'failed',
];
const toolStates: readonly string[] = ['running', 'completed', 'failed'];

export type AgentChatValidation<T> =
	| { ok: true; value: T }
	| { ok: false; reason: string };

/** Bounds a provider's availability report before it reaches the host. */
export function validateAgentChatAvailability(
	value: unknown,
): AgentChatValidation<AgentChatAvailability> {
	if (!isRecord(value)) return invalid('availability must be an object');
	const detail = optionalDetail(value.detail);
	if (value.available === true)
		return { ok: true, value: { available: true, ...detail } };
	if (value.available !== false) return invalid('available must be a boolean');
	if (!unavailableReasons.includes(value.reason as string))
		return invalid('reason is invalid');
	return {
		ok: true,
		value: {
			available: false,
			reason: value.reason as AgentChatUnavailableReason,
			...detail,
		},
	};
}

export type AgentChatEvent =
	| { type: 'text'; delta: string }
	| { type: 'tool'; tool: AgentChatToolEvent }
	| { type: 'failure'; failure: AgentChatFailure }
	| { type: 'exit'; exit: AgentChatExit };

/**
 * Validates one session event before it crosses into Terminay. The result
 * holds only known fields; overlong text is refused rather than cut so a
 * provider cannot smuggle data past the bound by splitting it.
 */
export function validateAgentChatEvent(
	value: unknown,
): AgentChatValidation<AgentChatEvent> {
	if (!isRecord(value)) return invalid('event must be an object');
	switch (value.type) {
		case 'text':
			if (
				typeof value.delta !== 'string' ||
				value.delta.length === 0 ||
				value.delta.length > EXTENSION_LIMITS.chatTextDeltaLength
			)
				return invalid('text delta is invalid');
			return { ok: true, value: { type: 'text', delta: value.delta } };
		case 'tool': {
			const tool = value.tool;
			if (!isRecord(tool)) return invalid('tool must be an object');
			if (!boundedText(tool.callId, EXTENSION_LIMITS.chatToolCallIdLength))
				return invalid('tool callId is invalid');
			if (!boundedText(tool.name, EXTENSION_LIMITS.chatToolNameLength))
				return invalid('tool name is invalid');
			if (
				tool.server !== undefined &&
				!boundedText(tool.server, EXTENSION_LIMITS.chatToolNameLength)
			)
				return invalid('tool server is invalid');
			if (!toolStates.includes(tool.state as string))
				return invalid('tool state is invalid');
			return {
				ok: true,
				value: {
					type: 'tool',
					tool: {
						callId: tool.callId as string,
						name: tool.name as string,
						state: tool.state as AgentChatToolState,
						...(tool.server === undefined
							? {}
							: { server: tool.server as string }),
					},
				},
			};
		}
		case 'failure': {
			const failure = value.failure;
			if (!isRecord(failure)) return invalid('failure must be an object');
			if (!failureReasons.includes(failure.reason as string))
				return invalid('failure reason is invalid');
			return {
				ok: true,
				value: {
					type: 'failure',
					failure: {
						reason: failure.reason as AgentChatFailureReason,
						...optionalDetail(failure.detail),
					},
				},
			};
		}
		case 'exit': {
			const exit = value.exit;
			if (!isRecord(exit)) return invalid('exit must be an object');
			const code =
				Number.isSafeInteger(exit.code) && (exit.code as number) >= -1
					? (exit.code as number)
					: null;
			const signal =
				typeof exit.signal === 'string' &&
				/^SIG[A-Z0-9]{1,16}$/.test(exit.signal)
					? exit.signal
					: null;
			return { ok: true, value: { type: 'exit', exit: { code, signal } } };
		}
		default:
			return invalid('unknown event type');
	}
}

/** A session request as the host builds it, checked again in the child. */
export function validateAgentChatSessionRequest(
	value: unknown,
): AgentChatValidation<AgentChatSessionRequest> {
	if (!isRecord(value)) return invalid('request must be an object');
	if (!boundedText(value.sessionId, EXTENSION_LIMITS.chatSessionIdLength))
		return invalid('sessionId is invalid');
	if (
		!boundedText(value.workingDirectory, EXTENSION_LIMITS.agentPathLength) ||
		!(value.workingDirectory as string).startsWith('/')
	)
		return invalid('workingDirectory must be an absolute path');
	if (
		value.instruction !== undefined &&
		(typeof value.instruction !== 'string' ||
			value.instruction.length > EXTENSION_LIMITS.chatInstructionLength)
	)
		return invalid('instruction is invalid');
	let mcpServer: AgentChatMcpServer | null = null;
	if (value.mcpServer !== null) {
		const server = value.mcpServer;
		if (!isRecord(server))
			return invalid('mcpServer must be an object or null');
		if (
			typeof server.name !== 'string' ||
			!/^[a-z][a-z0-9_]{0,63}$/.test(server.name)
		)
			return invalid('mcpServer.name is invalid');
		if (!boundedText(server.command, EXTENSION_LIMITS.mcpCommandLength))
			return invalid('mcpServer.command is invalid');
		if (
			!Array.isArray(server.args) ||
			server.args.length > EXTENSION_LIMITS.mcpCommandArgs ||
			!server.args.every(
				(arg) =>
					typeof arg === 'string' &&
					arg.length <= EXTENSION_LIMITS.mcpCommandLength,
			)
		)
			return invalid('mcpServer.args is invalid');
		let env: Record<string, string> | undefined;
		if (server.env !== undefined) {
			if (!isRecord(server.env)) return invalid('mcpServer.env is invalid');
			const entries = Object.entries(server.env);
			if (
				entries.length > EXTENSION_LIMITS.mcpCommandEnvEntries ||
				!entries.every(
					([key, entry]) =>
						/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) &&
						typeof entry === 'string' &&
						entry.length <= EXTENSION_LIMITS.mcpCommandLength,
				)
			)
				return invalid('mcpServer.env is invalid');
			env = Object.fromEntries(entries) as Record<string, string>;
		}
		mcpServer = {
			name: server.name,
			command: server.command as string,
			args: [...(server.args as string[])],
			...(env === undefined ? {} : { env }),
		};
	}
	return {
		ok: true,
		value: {
			sessionId: value.sessionId as string,
			workingDirectory: value.workingDirectory as string,
			...(value.instruction === undefined
				? {}
				: { instruction: value.instruction as string }),
			mcpServer,
		},
	};
}

function optionalDetail(value: unknown): { detail?: string } {
	if (typeof value !== 'string') return {};
	const trimmed = value.replace(/\0/g, '').trim();
	if (trimmed.length === 0) return {};
	return {
		detail:
			trimmed.length > EXTENSION_LIMITS.chatDetailLength
				? `${trimmed.slice(0, EXTENSION_LIMITS.chatDetailLength - 1)}…`
				: trimmed,
	};
}

function boundedText(value: unknown, maximum: number): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= maximum &&
		!value.includes('\0')
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: string): { ok: false; reason: string } {
	return { ok: false, reason };
}
