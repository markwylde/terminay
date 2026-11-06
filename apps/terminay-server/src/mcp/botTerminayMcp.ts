import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createTerminayMcpSession, type TerminayMcpSession } from './stdio.js';

/** Most adapter connections one bot execution's relay carries at once. */
export const BOT_TERMINAY_MCP_MAX_CONNECTIONS = 8;
/** Most requests one adapter connection may have outstanding. */
export const BOT_TERMINAY_MCP_MAX_OUTSTANDING = 16;

/**
 * The host side of one bot execution's `terminay` relay (ADR-0100). Each relay
 * connection is its own MCP session over the Terminay tool surface, holding
 * the execution's capability token, which never leaves this process.
 */
export interface BotTerminayMcpRelay {
	/** A message from one adapter connection; `reply` sends back to it. */
	handle(
		connection: number,
		message: unknown,
		reply: (message: unknown) => void,
	): void;
	/** The adapter disconnected: end its session and its requests. */
	closeConnection(connection: number): void;
	/** End every session. */
	close(): void;
}

export interface BotTerminayMcpRelayOptions {
	readonly socketPath: string;
	readonly token: string;
	readonly version?: string;
}

interface Connection {
	readonly ready: Promise<TerminayMcpSession | undefined>;
	readonly transport: RelayTransport;
	readonly outstanding: Set<string | number>;
}

class RelayTransport implements Transport {
	onmessage?: (message: JSONRPCMessage) => void;
	onclose?: () => void;
	onerror?: (error: Error) => void;
	private closed = false;

	constructor(
		private readonly reply: (message: unknown) => void,
		private readonly answered: (id: string | number) => void,
	) {}

	async start(): Promise<void> {}

	async send(message: JSONRPCMessage): Promise<void> {
		if (this.closed) return;
		const value = message as { id?: unknown; method?: unknown };
		if (
			value.method === undefined &&
			(typeof value.id === 'string' || typeof value.id === 'number')
		)
			this.answered(value.id);
		this.reply(message);
	}

	deliver(message: JSONRPCMessage): void {
		if (!this.closed) this.onmessage?.(message);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.onclose?.();
	}
}

function isRequestId(value: unknown): value is string | number {
	return (
		(typeof value === 'string' && value.length <= 128) ||
		(typeof value === 'number' && Number.isSafeInteger(value))
	);
}

export function createBotTerminayMcpRelay(
	options: BotTerminayMcpRelayOptions,
): BotTerminayMcpRelay {
	const connections = new Map<number, Connection>();
	let closed = false;

	const end = (id: number): void => {
		const connection = connections.get(id);
		if (connection === undefined) return;
		connections.delete(id);
		// Closing the transport closes the session's control client, which
		// aborts that connection's in-flight requests and nothing else.
		void connection.transport.close();
		void connection.ready.then((session) => session?.close());
	};

	const open = (id: number, reply: (message: unknown) => void): Connection => {
		// The relay numbers connections in order. A container whose relay does
		// not report disconnects still has the oldest session evicted.
		while (connections.size >= BOT_TERMINAY_MCP_MAX_CONNECTIONS)
			end(connections.keys().next().value as number);
		const outstanding = new Set<string | number>();
		const transport = new RelayTransport(reply, (requestId) =>
			outstanding.delete(requestId),
		);
		const ready = createTerminayMcpSession({ ...options, transport }).catch(
			() => {
				end(id);
				return undefined;
			},
		);
		const connection = { ready, transport, outstanding };
		connections.set(id, connection);
		return connection;
	};

	return {
		handle(id, message, reply) {
			if (closed || !Number.isSafeInteger(id) || id < 1) return;
			if (typeof message !== 'object' || message === null) return;
			const value = message as { id?: unknown; method?: unknown };
			const connection = connections.get(id) ?? open(id, reply);
			const isRequest =
				typeof value.method === 'string' && value.id !== undefined;
			if (isRequest) {
				const refuse = (text: string) => {
					if (isRequestId(value.id))
						reply({
							jsonrpc: '2.0',
							id: value.id,
							error: { code: -32600, message: text },
						});
				};
				if (!isRequestId(value.id)) return;
				if (connection.outstanding.has(value.id))
					return refuse('Duplicate request id');
				if (connection.outstanding.size >= BOT_TERMINAY_MCP_MAX_OUTSTANDING)
					return refuse('Too many outstanding requests');
				connection.outstanding.add(value.id);
			}
			void connection.ready.then((session) => {
				if (session !== undefined && connections.get(id) === connection)
					connection.transport.deliver(message as JSONRPCMessage);
			});
		},
		closeConnection: end,
		close() {
			closed = true;
			for (const id of [...connections.keys()]) end(id);
		},
	};
}

/** What the host's bot seam needs from its capability store. */
export interface BotTerminayMcpCapabilities {
	isEnabled(): boolean;
	mintBot(botId: string, executionId: string): { readonly token: string };
	revokeBot(botId: string, executionId?: string): number;
}

/**
 * The host seam for bot executions (ADR-0100): mint one capability per
 * execution from the bot service's decision, and serve it over the relay.
 */
export function createBotTerminayMcpHost(options: {
	readonly capabilities: BotTerminayMcpCapabilities;
	/** The control socket, or undefined when it cannot be placed. */
	readonly socketPath: () => string | undefined;
	readonly version?: string;
}) {
	const { capabilities } = options;
	return {
		open(botId: string, executionId: string, isAllowed: () => boolean) {
			const socketPath = options.socketPath();
			if (socketPath === undefined || !capabilities.isEnabled() || !isAllowed())
				return undefined;
			const lease = capabilities.mintBot(botId, executionId);
			// A toggle-off may have landed while minting: it wins.
			if (!isAllowed()) {
				capabilities.revokeBot(botId, executionId);
				return undefined;
			}
			const relay = createBotTerminayMcpRelay({
				socketPath,
				token: lease.token,
				...(options.version === undefined ? {} : { version: options.version }),
			});
			return {
				handle: relay.handle,
				closeConnection: relay.closeConnection,
				close: () => {
					relay.close();
					capabilities.revokeBot(botId, executionId);
				},
			};
		},
		revokeBot(botId: string) {
			capabilities.revokeBot(botId);
		},
	};
}
