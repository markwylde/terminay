import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import { isIP } from 'node:net';

export const AGENT_HOOK_PATH = '/v1/agent-events';
export const AGENT_HOOK_TOKEN_HEADER = 'x-terminay-agent-hook-token';
export const AGENT_HOOK_SESSION_HEADER = 'x-terminay-session-id';
export const AGENT_HOOK_PROVIDER_HEADER = 'x-terminay-agent-provider';
export const DEFAULT_AGENT_HOOK_MAX_BODY_BYTES = 256 * 1024;

export interface AgentHookRequest {
	body: Record<string, unknown>;
	headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface AgentHookServerOptions {
	handleRequest: (request: AgentHookRequest) => Promise<void> | void;
	host?: string;
	maxBodyBytes?: number;
	token?: string;
}

export interface AgentHookServer {
	readonly endpoint: string;
	readonly token: string;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export class AgentHookRequestError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message: string) {
		super(message);
		this.name = 'AgentHookRequestError';
		this.statusCode = statusCode;
	}
}

export function isLoopbackAddress(address: string | undefined): boolean {
	if (!address) {
		return false;
	}

	const normalized = address.split('%', 1)[0]?.toLowerCase();
	if (normalized === '::1') {
		return true;
	}
	if (normalized?.startsWith('::ffff:')) {
		return isLoopbackAddress(normalized.slice('::ffff:'.length));
	}
	if (isIP(normalized) !== 4) {
		return false;
	}

	const firstOctet = Number.parseInt(normalized.split('.', 1)[0] ?? '', 10);
	return firstOctet === 127;
}

function createToken(): string {
	return randomBytes(32).toString('base64url');
}

function tokensEqual(actual: string | undefined, expected: string): boolean {
	if (!actual) {
		return false;
	}

	const actualBytes = Buffer.from(actual);
	const expectedBytes = Buffer.from(expected);
	return (
		actualBytes.length === expectedBytes.length &&
		timingSafeEqual(actualBytes, expectedBytes)
	);
}

function readPresentedToken(request: IncomingMessage): string | undefined {
	const headerToken = request.headers[AGENT_HOOK_TOKEN_HEADER];
	if (typeof headerToken === 'string') {
		return headerToken;
	}

	const authorization = request.headers.authorization;
	if (typeof authorization !== 'string') {
		return undefined;
	}

	const match = /^Bearer[ \t]+(.+)$/i.exec(authorization);
	return match?.[1];
}

function sendJson(
	response: ServerResponse,
	statusCode: number,
	body: Record<string, unknown>,
): void {
	if (response.headersSent || response.destroyed) {
		return;
	}

	const encoded = Buffer.from(JSON.stringify(body));
	response.writeHead(statusCode, {
		'cache-control': 'no-store',
		connection: 'close',
		'content-length': String(encoded.length),
		'content-type': 'application/json; charset=utf-8',
		'x-content-type-options': 'nosniff',
	});
	response.end(encoded);
}

async function readJsonBody(
	request: IncomingMessage,
	maxBodyBytes: number,
): Promise<Record<string, unknown>> {
	const declaredLength = request.headers['content-length'];
	if (declaredLength !== undefined) {
		const length = Number(declaredLength);
		if (!Number.isSafeInteger(length) || length < 0) {
			throw new AgentHookRequestError(400, 'Invalid Content-Length header.');
		}
		if (length > maxBodyBytes) {
			throw new AgentHookRequestError(413, 'Hook payload is too large.');
		}
	}

	const chunks: Buffer[] = [];
	let receivedBytes = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		receivedBytes += bytes.length;
		if (receivedBytes > maxBodyBytes) {
			throw new AgentHookRequestError(413, 'Hook payload is too large.');
		}
		chunks.push(bytes);
	}

	if (receivedBytes === 0) {
		throw new AgentHookRequestError(400, 'Hook payload is required.');
	}

	let value: unknown;
	try {
		value = JSON.parse(Buffer.concat(chunks, receivedBytes).toString('utf8'));
	} catch {
		throw new AgentHookRequestError(400, 'Hook payload must be valid JSON.');
	}

	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new AgentHookRequestError(400, 'Hook payload must be a JSON object.');
	}

	return value as Record<string, unknown>;
}

class NodeAgentHookServer implements AgentHookServer {
	readonly token: string;

	private readonly handleRequest: AgentHookServerOptions['handleRequest'];
	private readonly host: string;
	private readonly maxBodyBytes: number;
	private server: Server | null = null;
	private port: number | null = null;
	private preferredPort: number | null = null;
	private processing: Promise<void> = Promise.resolve();

	constructor(options: AgentHookServerOptions) {
		this.handleRequest = options.handleRequest;
		this.host = options.host ?? '127.0.0.1';
		this.maxBodyBytes =
			options.maxBodyBytes ?? DEFAULT_AGENT_HOOK_MAX_BODY_BYTES;
		this.token = options.token ?? createToken();

		if (!isLoopbackAddress(this.host)) {
			throw new Error('Agent hook receiver must bind to a loopback address.');
		}
		if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes < 1) {
			throw new Error(
				'Agent hook maximum body size must be a positive integer.',
			);
		}
		if (!this.token) {
			throw new Error('Agent hook token must not be empty.');
		}
	}

	get endpoint(): string {
		if (this.port === null) {
			throw new Error('Agent hook receiver has not started.');
		}
		const address = this.host.includes(':') ? `[${this.host}]` : this.host;
		return `http://${address}:${this.port}${AGENT_HOOK_PATH}`;
	}

	async start(): Promise<void> {
		if (this.server) {
			return;
		}

		const server = createServer((request, response) => {
			void this.receive(request, response);
		});
		server.on('clientError', (_error, socket) => {
			socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
		});

		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => {
				server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				resolve();
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen({
				host: this.host,
				port: this.preferredPort ?? 0,
				exclusive: true,
			});
		});

		const address = server.address();
		if (!address || typeof address === 'string') {
			server.close();
			throw new Error('Agent hook receiver did not acquire a TCP port.');
		}

		this.server = server;
		this.port = address.port;
		this.preferredPort = address.port;
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = null;
		this.port = null;
		if (!server) {
			return;
		}

		await new Promise<void>((resolve) => {
			server.close(() => resolve());
			server.closeAllConnections?.();
		});
		await this.processing.catch(() => undefined);
	}

	private async receive(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		try {
			if (!isLoopbackAddress(request.socket.remoteAddress)) {
				throw new AgentHookRequestError(
					403,
					'Hook requests are accepted only from loopback.',
				);
			}
			if (request.url !== AGENT_HOOK_PATH) {
				throw new AgentHookRequestError(404, 'Hook endpoint not found.');
			}
			if (request.method !== 'POST') {
				response.setHeader('allow', 'POST');
				throw new AgentHookRequestError(
					405,
					'Hook endpoint accepts POST only.',
				);
			}
			if (!tokensEqual(readPresentedToken(request), this.token)) {
				throw new AgentHookRequestError(401, 'Invalid hook token.');
			}

			const contentType = request.headers['content-type']
				?.split(';', 1)[0]
				?.trim()
				.toLowerCase();
			if (contentType !== 'application/json') {
				throw new AgentHookRequestError(
					415,
					'Hook payload must use application/json.',
				);
			}

			const body = await readJsonBody(request, this.maxBodyBytes);
			const work = this.processing.then(() =>
				this.handleRequest({
					body,
					headers: request.headers,
				}),
			);
			this.processing = work.catch(() => undefined);
			await work;
			sendJson(response, 202, { accepted: true });
		} catch (error) {
			const statusCode =
				error instanceof AgentHookRequestError ? error.statusCode : 500;
			const message =
				error instanceof AgentHookRequestError
					? error.message
					: 'The hook payload could not be processed.';
			sendJson(response, statusCode, { accepted: false, error: message });
		}
	}
}

export function createAgentHookServer(
	options: AgentHookServerOptions,
): AgentHookServer {
	return new NodeAgentHookServer(options);
}
