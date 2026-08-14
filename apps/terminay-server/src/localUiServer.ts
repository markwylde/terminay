import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from 'node:http';
import {
	createServer as createHttpsServer,
	type ServerOptions as HttpsServerOptions,
} from 'node:https';
import type { Socket } from 'node:net';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Duplex } from 'node:stream';
import {
	DEFAULT_PROTOCOL_LIMITS,
	type ProtocolLimits,
} from '@terminay/protocol';
import {
	DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
	type UiBundleManifest,
	type UiBundleStore,
	type VerifiedUiBundle,
	verifyUiBundle,
} from '@terminay/server-core/ui-bundle';
import type {
	AuthenticatedClient,
	ServerCore,
} from '@terminay/server-core';
import { type WebSocket, WebSocketServer } from 'ws';
import { ServerWebSocketByteTransport } from './webSocketByteTransport.js';

export interface LocalUiServerOptions {
	/** Optional verified UI bundle root. Protocol-only listeners do not need one. */
	readonly rootDirectory?: string;
	/** Optional committed bundle store. When present, the current pointer is the launch source. */
	readonly bundleStore?: UiBundleStore;
	readonly serverId: string;
	readonly serverVersion: string;
	readonly authToken: string;
	readonly authTokenExpiresAt?: number;
	/** Optional server-owned one-time-room state check. Digest equality alone is
	 * insufficient after a pairing room has been consumed or rotated. */
	readonly authTokenAvailable?: () => boolean;
	readonly host?: string;
	readonly port?: number;
	/** TLS is mandatory for non-loopback network exposure. Loopback development
	 * may omit it and use the existing HTTP exception. */
	readonly tls?: Pick<HttpsServerOptions, 'cert' | 'key'>;
	/** Exact browser origins permitted to call authenticated protocol endpoints. */
	readonly allowedWebOrigins?: readonly string[];
	readonly protocolVersion?: number;
	readonly capabilities?: readonly string[];
	readonly limits?: ProtocolLimits;
	readonly maxAssetBytes?: number;
	/** Canonical framed protocol core used by remote stream transports. */
	readonly protocolCore?: ServerCore;
	/** Resolves the authority already established by the accepted WebSocket
	 * credential. Production hosts must supply this instead of trusting hello. */
	readonly protocolAuthenticatedClientForCredential?: (
		token: string,
		credentialClientId: string,
	) => AuthenticatedClient;
	/** Host-owned bounded diagnostics for a protocol connection that failed
	 * after its WebSocket upgrade completed. */
	readonly onConnectionError?: (error: unknown) => void;
	/** Accepts a short-lived protocol ticket in addition to the bootstrap
	 * credential.  The ticket authority stays at the server boundary. */
	readonly acceptCredential?: (token: string) => boolean | Promise<boolean>;
	/** Optional pairing-to-reconnect boundary. These endpoints deliberately
	 * return only an opaque handle and a proof result; grants never become
	 * protocol bearer credentials. */
	readonly reconnect?: {
		readonly enroll: (input: {
			readonly token: string;
			readonly clientId: string;
		}) =>
			| {
					readonly handle: string;
					readonly grant: string;
					readonly signingOrigin: string;
			  }
			| Promise<{
					readonly handle: string;
					readonly grant: string;
					readonly signingOrigin: string;
			  }>;
		readonly challenge: (input: {
			readonly handle: string;
			readonly clientNonce: string;
		}) =>
			| {
					readonly attemptId: string;
					readonly handle: string;
					readonly clientNonce: string;
					readonly signingInput: string;
			  }
			| Promise<{
					readonly attemptId: string;
					readonly handle: string;
					readonly clientNonce: string;
					readonly signingInput: string;
			  }>;
		readonly complete: (input: {
			readonly attemptId: string;
			readonly handle: string;
			readonly clientNonce: string;
			readonly proof: string;
		}) =>
			| { readonly ticket: string; readonly expiresAt: number }
			| Promise<{ readonly ticket: string; readonly expiresAt: number }>;
	};
	/** Optional one-time PIN/device enrollment boundary. Pairing credentials are
	 * accepted only in bounded POST bodies and are never interpreted by the
	 * transport listener itself. */
	readonly pairing?: {
		readonly start: (input: {
			readonly deviceName: string;
			readonly pairingExpiresAt: string;
			readonly pairingPin: string;
			readonly pairingSessionId: string;
			readonly pairingToken: string;
			readonly publicKeyPem: string;
		}) =>
			| { readonly provisionalDeviceId: string }
			| Promise<{ readonly provisionalDeviceId: string }>;
		readonly complete: (input: {
			readonly provisionalDeviceId: string;
		}) => unknown | Promise<unknown>;
	};
}

export interface LocalUiServerAddress {
	readonly host: string;
	readonly port: number;
	readonly origin: string;
}

const DEFAULT_MAX_ASSET_BYTES = 16 * 1024 * 1024;
const MAX_HANDSHAKE_BYTES = 64 * 1024;
const REMOTE_STREAM_PATH = '/protocol/stream';
const REMOTE_STREAM_PROTOCOL = 'terminay.v1';
const REMOTE_STREAM_AUTH_PREFIX = 'terminay.auth.';
const TOKEN_DIGEST_BYTES = 32;
const forbiddenQueryKeys = new Set([
	'token',
	'access_token',
	'bootstrap_credential',
	'credential',
]);
const UI_SECURITY_HEADERS = Object.freeze({
	'Content-Security-Policy': DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
	'Permissions-Policy':
		'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff',
	// Keep the UI unembeddable for older engines that do not enforce the
	// manifest CSP's frame-ancestors directive.
	'X-Frame-Options': 'DENY',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Resource-Policy': 'same-origin',
});

/**
 * Authenticated local origin for the server-bundled UI and remote protocol
 * stream. It intentionally serves files only from an injected bundle root;
 * it does not resolve arbitrary filesystem paths or accept credentials in URL
 * query strings. Application traffic uses the same framed protocol stream as
 * Electron/local; HTTP remains only for assets, reconnect, and stream bootstrap.
 */
export class LocalUiServer {
	private readonly options: Required<
		Pick<
			LocalUiServerOptions,
			| 'host'
			| 'port'
			| 'protocolVersion'
			| 'capabilities'
			| 'limits'
			| 'maxAssetBytes'
		>
	> &
		LocalUiServerOptions;
	private readonly rootDirectory: string | undefined;
	private readonly tokenDigest: Buffer;
	private bundleValue: VerifiedUiBundle | undefined;
	private server: Server | undefined;
	private addressValue: LocalUiServerAddress | undefined;
	private readonly connections = new Set<Socket>();
	private readonly allowedWebOrigins: ReadonlySet<string>;
	private readonly wsServer: WebSocketServer;

	constructor(options: LocalUiServerOptions) {
		if (!isSafeId(options.serverId) || !isSafeVersion(options.serverVersion))
			throw new TypeError('server identity is invalid');
		if (
			options.rootDirectory !== undefined &&
			(options.rootDirectory.length === 0 ||
				options.rootDirectory.length > 4096 ||
				!isAbsolute(options.rootDirectory))
		)
			throw new TypeError('bundle root must be absolute');
		if (
			typeof options.authToken !== 'string' ||
			options.authToken.length < 16 ||
			options.authToken.length > 512 ||
			hasLineBreak(options.authToken)
		)
			throw new TypeError('local UI credential is invalid');
		if (
			options.authTokenExpiresAt !== undefined &&
			(!Number.isSafeInteger(options.authTokenExpiresAt) ||
				options.authTokenExpiresAt <= 0)
		)
			throw new TypeError('local UI credential expiry is invalid');
		const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
		if (
			!Number.isSafeInteger(maxAssetBytes) ||
			maxAssetBytes <= 0 ||
			maxAssetBytes > DEFAULT_MAX_ASSET_BYTES
		)
			throw new RangeError('maxAssetBytes is invalid');
		const port = options.port ?? 0;
		if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
			throw new RangeError('port is invalid');
		const capabilities = Object.freeze([...(options.capabilities ?? [])]);
		const limits = Object.freeze({
			...(options.limits ?? DEFAULT_PROTOCOL_LIMITS),
		});
		this.allowedWebOrigins = new Set(
			(options.allowedWebOrigins ?? []).flatMap(expandAllowedWebOriginAliases),
		);
		this.options = {
			...options,
			host: options.host ?? '127.0.0.1',
			port,
			protocolVersion: options.protocolVersion ?? 1,
			capabilities,
			limits,
			maxAssetBytes,
		};
		this.rootDirectory =
			options.rootDirectory === undefined
				? undefined
				: resolve(options.rootDirectory);
		this.tokenDigest = createHash('sha256')
			.update(options.authToken, 'utf8')
			.digest();
		this.wsServer = new WebSocketServer({
			noServer: true,
			maxPayload: limits.maxFrameBytes,
			handleProtocols: (protocols) =>
				protocols.has(REMOTE_STREAM_PROTOCOL) ? REMOTE_STREAM_PROTOCOL : false,
		});
	}

	get listening(): boolean {
		return this.server?.listening === true;
	}
	get address(): LocalUiServerAddress | undefined {
		return this.addressValue;
	}

	async start(): Promise<LocalUiServerAddress> {
		if (this.server !== undefined && this.addressValue !== undefined)
			return this.addressValue;
		await this.loadBundle();
		const requestHandler = (
			request: IncomingMessage,
			response: ServerResponse,
		) => {
			void this.handle(request, response);
		};
		const server =
			this.options.tls === undefined
				? createServer(requestHandler)
				: createHttpsServer(this.options.tls, requestHandler);
		server.on('upgrade', (request, socket, head) => {
			void this.handleUpgrade(request, socket, head);
		});
		server.on('connection', (socket) => {
			this.connections.add(socket);
			socket.once('close', () => this.connections.delete(socket));
		});
		this.server = server;
		try {
			await new Promise<void>((resolveStart, reject) => {
				const onError = (error: Error): void => {
					server.off('listening', onListening);
					reject(error);
				};
				const onListening = (): void => {
					server.off('error', onError);
					resolveStart();
				};
				server.once('error', onError);
				server.once('listening', onListening);
				server.listen(this.options.port, this.options.host);
			});
			const address = server.address();
			if (address === null || typeof address === 'string')
				throw new Error('local UI server did not expose a TCP address');
			this.addressValue = Object.freeze({
				host: address.address,
				port: address.port,
				origin: `${this.options.tls === undefined ? 'http' : 'https'}://${formatHost(address.address)}:${address.port}`,
			});
			return this.addressValue;
		} catch (error) {
			this.server = undefined;
			for (const socket of this.connections) socket.destroy();
			this.connections.clear();
			await closeServer(server);
			throw error;
		}
	}

	async stop(): Promise<void> {
		const server = this.server;
		this.server = undefined;
		this.addressValue = undefined;
		this.bundleValue = undefined;
		this.wsServer.close();
		for (const socket of this.connections) socket.destroy();
		this.connections.clear();
		if (server !== undefined) await closeServer(server);
	}

	private async handleUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): Promise<void> {
		try {
			const url = new URL(request.url ?? '/', 'http://terminay.local');
			if (url.pathname !== REMOTE_STREAM_PATH) {
				rejectUpgrade(socket, 404, 'not found');
				return;
			}
			const corsOrigin = this.protocolCorsOrigin(
				request.headers.origin,
				url.pathname,
				request.headers.host,
			);
			if (request.headers.origin !== undefined && corsOrigin === undefined) {
				rejectUpgrade(socket, 403, 'browser origin is not permitted');
				return;
			}
			for (const key of url.searchParams.keys()) {
				if (forbiddenQueryKeys.has(key.toLowerCase())) {
					rejectUpgrade(socket, 400, 'credentials must not be placed in a URL');
					return;
				}
			}
			const token = streamProtocolToken(
				request.headers['sec-websocket-protocol'],
			);
			if (token === null || !(await this.matchesToken(token))) {
				rejectUpgrade(socket, 401, 'local UI authorization required');
				return;
			}
			this.wsServer.handleUpgrade(request, socket, head, (websocket) => {
				this.handleStreamConnection(websocket, token);
			});
		} catch {
			rejectUpgrade(socket, 500, 'local UI stream failed');
		}
	}

	private handleStreamConnection(socket: WebSocket, token: string): void {
		const core = this.options.protocolCore;
		if (core === undefined) {
			socket.close(1013, 'protocol stream is unavailable');
			return;
		}
		const transport = new ServerWebSocketByteTransport(
			socket,
			this.options.limits.maxFrameBytes,
		);
		const authenticatedClient =
			this.options.protocolAuthenticatedClientForCredential?.(
				token,
				protocolConnectionId(token, 'client'),
			);
		const connection = core.accept(transport, {
			connectionId: protocolConnectionId(
				token,
				`stream-${Date.now().toString(36)}`,
			),
			...(authenticatedClient === undefined ? {} : { authenticatedClient }),
		});
		void connection.start().catch((error) => {
			try {
				this.options.onConnectionError?.(error);
			} catch {
				// Diagnostics must not turn a contained client failure into a host failure.
			}
		});
	}

	private async handle(
		request: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		try {
			const method = request.method ?? '';
			const url = new URL(request.url ?? '/', 'http://terminay.local');
			const corsOrigin = this.protocolCorsOrigin(
				request.headers.origin,
				url.pathname,
				request.headers.host,
			);
			if (
				request.headers.origin !== undefined &&
				isProtocolPath(url.pathname) &&
				corsOrigin === undefined
			) {
				sendText(response, 403, 'browser origin is not permitted');
				return;
			}
			if (corsOrigin !== undefined) {
				response.setHeader('Access-Control-Allow-Origin', corsOrigin);
				response.setHeader(
					'Access-Control-Allow-Headers',
					'authorization, content-type, x-terminay-client-id',
				);
				response.setHeader(
					'Access-Control-Allow-Methods',
					'GET, POST, OPTIONS',
				);
				response.setHeader('Vary', 'Origin');
			}
			if (method === 'OPTIONS' && isProtocolPath(url.pathname)) {
				response.writeHead(corsOrigin === undefined ? 403 : 204, {
					...UI_SECURITY_HEADERS,
					...response.getHeaders(),
					'Cache-Control': 'no-store',
				});
				response.end();
				return;
			}
			if (
				method !== 'GET' &&
				method !== 'HEAD' &&
				!(
					method === 'POST' &&
					(request.url?.startsWith('/protocol/reconnect/') ||
						request.url?.startsWith('/api/pairing/'))
				)
			) {
				sendText(response, 405, 'method not allowed');
				return;
			}
			for (const key of url.searchParams.keys())
				if (forbiddenQueryKeys.has(key.toLowerCase())) {
					sendText(response, 400, 'credentials must not be placed in a URL');
					return;
				}
				if (url.pathname === '/host-bootstrap.json') {
					sendJson(
						response,
						200,
						{
							schemaVersion: 1,
							serverId: this.options.serverId,
							manifestPath: '/manifest.json',
							streamPath: REMOTE_STREAM_PATH,
						},
						method === 'HEAD',
					);
					return;
				}
			if (
				url.pathname === '/api/pairing/start' ||
				url.pathname === '/api/pairing/complete'
			) {
				if (method !== 'POST') {
					sendText(response, 405, 'method not allowed');
					return;
				}
				await this.handlePairing(
					request,
					response,
					url.pathname === '/api/pairing/start' ? 'start' : 'complete',
				);
				return;
			}
			if (
				url.pathname === '/protocol/reconnect/challenge' ||
				url.pathname === '/protocol/reconnect/complete'
			) {
				if (method !== 'POST') {
					sendText(response, 405, 'method not allowed');
					return;
				}
				await this.handleReconnect(
					request,
					response,
					url.pathname === '/protocol/reconnect/challenge'
						? 'challenge'
						: 'complete',
				);
				return;
			}
			// The verified, immutable UI bundle is public bootstrap material. A
			// browser navigation cannot attach a Bearer header, and URL fragments are
			// intentionally never sent to HTTP. Keep application streams and
			// reconnect enrollment credential-gated, while allowing the matching UI
			// to boot and consume the one-time fragment in renderer memory.
			if (
				(method === 'GET' || method === 'HEAD') &&
				!isProtocolPath(url.pathname)
			) {
				await this.handleAsset(url.pathname, response, method === 'HEAD');
				return;
			}
			const token = bearerToken(request.headers.authorization);
			if (token === null || !(await this.matchesToken(token))) {
				sendText(response, 401, 'local UI authorization required', {
					'WWW-Authenticate': 'Bearer',
				});
				return;
			}
			if (url.pathname === '/protocol/reconnect/enroll') {
				if (method !== 'POST') {
					sendText(response, 405, 'method not allowed');
					return;
				}
				await this.handleReconnectEnrollment(request, response, token);
				return;
			}
			if (method === 'POST') {
				sendText(response, 404, 'not found');
				return;
			}
			await this.handleAsset(url.pathname, response, method === 'HEAD');
		} catch {
			if (!response.headersSent)
				sendText(response, 500, 'local UI request failed');
		}
	}

	private async handlePairing(
		request: IncomingMessage,
		response: ServerResponse,
		kind: 'start' | 'complete',
	): Promise<void> {
		const pairing = this.options.pairing;
		if (pairing === undefined) {
			sendText(response, 404, 'pairing is unavailable');
			return;
		}
		const value = await readReconnectBody(request, response);
		if (value === undefined) return;
		try {
			if (kind === 'complete') {
				if (
					Object.keys(value).length !== 1 ||
					typeof value.provisionalDeviceId !== 'string'
				)
					throw new TypeError('pairing completion is invalid');
				sendJson(
					response,
					200,
					await pairing.complete({
						provisionalDeviceId: value.provisionalDeviceId,
					}),
				);
				return;
			}
			const allowed = new Set([
				'deviceName',
				'pairingExpiresAt',
				'pairingPin',
				'pairingSessionId',
				'pairingToken',
				'publicKeyPem',
			]);
			if (
				Object.keys(value).length !== allowed.size ||
				Object.keys(value).some((key) => !allowed.has(key)) ||
				[...allowed].some((key) => typeof value[key] !== 'string')
			)
				throw new TypeError('pairing request is invalid');
			const result = await pairing.start(
				value as {
					deviceName: string;
					pairingExpiresAt: string;
					pairingPin: string;
					pairingSessionId: string;
					pairingToken: string;
					publicKeyPem: string;
				},
			);
			if (
				typeof result.provisionalDeviceId !== 'string' ||
				result.provisionalDeviceId.length === 0 ||
				result.provisionalDeviceId.length > 512
			)
				throw new TypeError('pairing result is invalid');
			sendJson(response, 200, result);
		} catch (error) {
			sendJson(response, 403, {
				error:
					error instanceof Error ? error.message : 'Device pairing failed.',
			});
		}
	}

	private protocolCorsOrigin(
		origin: string | undefined,
		pathname: string,
		host: string | undefined,
	): string | undefined {
		if (origin === undefined || !isProtocolPath(pathname)) return undefined;
		// Canonical Desktop documents are loaded from a private `file:` bundle and
		// Chromium serializes that opaque origin as `null`.  Protocol endpoints
		// still require their bearer/subprotocol capability below; allowing this
		// exact opaque origin is what lets a user paste an authenticated pairing
		// URL into Desktop without weakening the token boundary or falling back to
		// a renderer-local server implementation.
		if (origin === 'null' || origin === 'file://') return origin;
		const normalizedOrigin = normalizeRequestOrigin(origin);
		if (normalizedOrigin === null) return undefined;
		if (sameOriginHost(normalizedOrigin, host)) return origin;
		return this.allowedWebOrigins.has(normalizedOrigin.origin)
			? origin
			: undefined;
	}

	private async handleReconnectEnrollment(
		request: IncomingMessage,
		response: ServerResponse,
		token: string,
	): Promise<void> {
		const reconnect = this.options.reconnect;
		if (reconnect === undefined) {
			sendText(response, 404, 'reconnect is unavailable');
			return;
		}
		const value = await readReconnectBody(request, response);
		if (value === undefined) return;
		const clientId = stringRecordField(value, 'clientId');
		if (clientId === undefined || !isSafeId(clientId)) {
			sendText(response, 400, 'reconnect client identity is invalid');
			return;
		}
		try {
			const enrollment = await reconnect.enroll({ token, clientId });
			if (
				!isReconnectHandle(enrollment.handle) ||
				!isReconnectGrant(enrollment.grant) ||
				!isReconnectSigningOrigin(enrollment.signingOrigin)
			)
				throw new TypeError('invalid reconnect enrollment');
			sendJson(response, 200, enrollment);
		} catch {
			sendText(response, 403, 'reconnect enrollment denied');
		}
	}

	private async handleReconnect(
		request: IncomingMessage,
		response: ServerResponse,
		kind: 'challenge' | 'complete',
	): Promise<void> {
		const reconnect = this.options.reconnect;
		if (reconnect === undefined) {
			sendText(response, 404, 'reconnect is unavailable');
			return;
		}
		const value = await readReconnectBody(request, response);
		if (value === undefined) return;
		const handle = stringRecordField(value, 'handle');
		const clientNonce = stringRecordField(value, 'clientNonce');
		if (!isReconnectHandle(handle) || !isReconnectNonce(clientNonce)) {
			sendText(response, 400, 'reconnect request is invalid');
			return;
		}
		try {
			if (kind === 'challenge') {
				const challenge = await reconnect.challenge({ handle, clientNonce });
				if (
					!isSafeId(challenge.attemptId) ||
					challenge.handle !== handle ||
					challenge.clientNonce !== clientNonce ||
					!isSigningInput(challenge.signingInput)
				)
					throw new TypeError('invalid reconnect challenge');
				sendJson(response, 200, challenge);
				return;
			}
			const attemptId = stringRecordField(value, 'attemptId');
			const proof = stringRecordField(value, 'proof');
			if (
				attemptId === undefined ||
				!isSafeId(attemptId) ||
				!isReconnectProof(proof)
			) {
				sendText(response, 400, 'reconnect proof is invalid');
				return;
			}
			const complete = await reconnect.complete({
				attemptId,
				handle,
				clientNonce,
				proof,
			});
			if (
				!isReconnectGrant(complete.ticket) ||
				!Number.isSafeInteger(complete.expiresAt) ||
				complete.expiresAt <= Date.now()
			)
				throw new TypeError('invalid reconnect ticket');
			sendJson(response, 200, complete);
		} catch {
			sendText(response, 403, 'reconnect denied');
		}
	}

	private async handleAsset(
		pathname: string,
		response: ServerResponse,
		headOnly: boolean,
	): Promise<void> {
		const bundle = this.bundleValue;
		if (bundle === undefined) {
			sendText(response, 503, 'UI bundle is unavailable');
			return;
		}
		if (pathname === '/manifest.json') {
			sendJson(response, 200, bundle.manifest, headOnly);
			return;
		}
		let assetPath: string;
		try {
			const decodedPath = decodeURIComponent(pathname);
			if (decodedPath === '/') {
				assetPath = bundle.manifest.entryPath;
			} else if (
				decodedPath.startsWith(`/remote-app/${bundle.manifest.bundleId}/`)
			) {
				assetPath = decodedPath;
			} else {
				// Vite emits root-relative application assets. Keep the public request
				// shape while resolving only to an asset already present in this
				// verified, content-addressed bundle.
				assetPath = `/remote-app/${bundle.manifest.bundleId}${decodedPath}`;
			}
		} catch {
			sendText(response, 400, 'invalid bundle path');
			return;
		}
		const asset = bundle.manifest.assets.find(
			(candidate) => candidate.path === assetPath,
		);
		if (asset === undefined) {
			sendText(response, 404, 'not found');
			return;
		}
		const content = Buffer.from(bundle.read(asset.path));
		response.writeHead(200, {
			...UI_SECURITY_HEADERS,
			'Content-Type': asset.contentType || 'application/octet-stream',
			'Content-Length': String(content.byteLength),
			'Cache-Control': 'public, max-age=31536000, immutable',
		});
		if (!headOnly) response.end(content);
		else response.end();
	}

	private async matchesToken(token: string | null): Promise<boolean> {
		if (token === null) return false;
		const digest = createHash('sha256').update(token, 'utf8').digest();
		if (
			digest.byteLength === TOKEN_DIGEST_BYTES &&
			timingSafeEqual(digest, this.tokenDigest)
		)
			return (
				(this.options.authTokenAvailable?.() ?? true) &&
				(this.options.authTokenExpiresAt === undefined ||
					this.options.authTokenExpiresAt > Date.now())
			);
		return this.options.acceptCredential === undefined
			? false
			: await this.options.acceptCredential(token);
	}

	private async loadBundle(): Promise<void> {
		const rootDirectory = this.rootDirectory;
		if (rootDirectory === undefined) {
			this.bundleValue = undefined;
			return;
		}
		if (this.options.bundleStore !== undefined) {
			const committed = await this.options.bundleStore.open();
			if (committed === undefined)
				throw new TypeError('no committed UI bundle is available');
			if (
				committed.manifest.serverVersion !== this.options.serverVersion ||
				committed.manifest.protocolVersion !==
					String(this.options.protocolVersion)
			)
				throw new TypeError('UI manifest version mismatch');
			this.bundleValue = committed;
			return;
		}
		const manifestPath = safeChild(rootDirectory, 'manifest.json');
		if (manifestPath === null)
			throw new TypeError('UI manifest path is invalid');
		const raw = JSON.parse(
			(await readFile(manifestPath)).toString('utf8'),
		) as unknown;
		if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
			throw new TypeError('UI manifest is invalid');
		const candidate = raw as Partial<UiBundleManifest>;
		if (
			candidate.serverVersion !== this.options.serverVersion ||
			candidate.protocolVersion !== String(this.options.protocolVersion)
		)
			throw new TypeError('UI manifest version mismatch');
		this.bundleValue = await verifyUiBundle(
			raw,
			{
				read: async (assetPath) => {
					const prefix =
						typeof candidate.bundleId === 'string'
							? `/remote-app/${candidate.bundleId}/`
							: '';
					if (!assetPath.startsWith(prefix))
						throw new TypeError('UI bundle asset namespace is invalid');
					const filePath = safeChild(
						rootDirectory,
						assetPath.slice(prefix.length),
					);
					if (filePath === null)
						throw new TypeError('UI bundle asset path is invalid');
					return readFile(filePath);
				},
			},
			{ maxAssetBytes: this.options.maxAssetBytes },
		);
	}
}

export function createLocalUiServer(
	options: LocalUiServerOptions,
): LocalUiServer {
	return new LocalUiServer(options);
}

/**
 * Construct the Local UI listener with an OS-assigned port. Binding the
 * socket itself (rather than probing a port and racing another process) makes
 * concurrent Desktop/standalone launches collision-safe. The returned origin
 * is available after `start()` through `LocalUiServer.address`.
 */
export function createLoopbackUiServer(
	options: Omit<LocalUiServerOptions, 'host' | 'port'>,
): LocalUiServer {
	return new LocalUiServer({ ...options, host: '127.0.0.1', port: 0 });
}

function safeChild(root: string, child: string): string | null {
	if (
		child.length === 0 ||
		child.includes('\0') ||
		child.startsWith('/') ||
		isAbsolute(child)
	)
		return null;
	const candidate = resolve(root, child);
	const escaped = relative(root, candidate);
	return escaped.length === 0 ||
		(!escaped.startsWith(`..${sep}`) &&
			escaped !== '..' &&
			!isAbsolute(escaped))
		? candidate
		: null;
}

function bearerToken(value: string | string[] | undefined): string | null {
	if (typeof value !== 'string' || !value.startsWith('Bearer ')) return null;
	const token = value.slice(7);
	return token.length === 0 || token.length > 512 || hasLineBreak(token)
		? null
		: token;
}

async function readReconnectBody(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<Record<string, unknown> | undefined> {
	let body: Buffer;
	try {
		body = await readBoundedBody(request, MAX_HANDSHAKE_BYTES);
	} catch {
		sendText(response, 413, 'reconnect body exceeds limit');
		return undefined;
	}
	try {
		const value: unknown = JSON.parse(new TextDecoder().decode(body));
		if (value === null || typeof value !== 'object' || Array.isArray(value))
			throw new TypeError('not an object');
		return value as Record<string, unknown>;
	} catch {
		sendText(response, 400, 'invalid reconnect JSON');
		return undefined;
	}
}

function stringRecordField(
	value: Record<string, unknown>,
	key: string,
): string | undefined {
	const field = value[key];
	return typeof field === 'string' ? field : undefined;
}

function isReconnectHandle(value: string | undefined): value is string {
	return (
		value !== undefined &&
		value.length >= 32 &&
		value.length <= 512 &&
		/^[A-Za-z0-9_-]+$/u.test(value)
	);
}

function isReconnectGrant(value: string | undefined): value is string {
	return (
		value !== undefined &&
		value.length >= 16 &&
		value.length <= 512 &&
		/^[A-Za-z0-9_-]+$/u.test(value)
	);
}

function isReconnectNonce(value: string | undefined): value is string {
	return (
		value !== undefined &&
		value.length >= 16 &&
		value.length <= 512 &&
		/^[A-Za-z0-9._:-]+$/u.test(value)
	);
}

function isReconnectProof(value: string | undefined): value is string {
	return (
		value !== undefined &&
		value.length >= 32 &&
		value.length <= 512 &&
		/^[A-Za-z0-9_-]+$/u.test(value)
	);
}

function isReconnectSigningOrigin(value: string | undefined): value is string {
	if (value === undefined || value.length > 4096 || /[\0\r\n]/u.test(value))
		return false;
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
			parsed.username === '' &&
			parsed.password === '' &&
			parsed.pathname === '/' &&
			parsed.search === '' &&
			parsed.hash === ''
		);
	} catch {
		return false;
	}
}

function isSigningInput(value: string): boolean {
	// The canonical reconnect signing domain uses NUL separators. Newlines are
	// forbidden, but NUL is an expected protocol byte here.
	return value.length >= 32 && value.length <= 4096 && !/[\r\n]/u.test(value);
}

function tokenDigestKey(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}
function protocolConnectionId(token: string, clientId: string): string {
	return `http-${tokenDigestKey(`${token}:${clientId}`).slice(0, 32)}`;
}

async function readBoundedBody(
	request: IncomingMessage,
	maxBytes: number,
): Promise<Buffer> {
	const declared = request.headers['content-length'];
	if (
		declared !== undefined &&
		(!/^\d+$/u.test(declared) || Number(declared) > maxBytes)
	)
		throw new RangeError('request body exceeds limit');
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += bytes.byteLength;
		if (total > maxBytes) throw new RangeError('request body exceeds limit');
		chunks.push(bytes);
	}
	return Buffer.concat(chunks, total);
}

function sendJson(
	response: ServerResponse,
	status: number,
	value: unknown,
	headOnly = false,
): void {
	const body = Buffer.from(JSON.stringify(value), 'utf8');
	response.writeHead(status, {
		...UI_SECURITY_HEADERS,
		...response.getHeaders(),
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': String(body.byteLength),
		'Cache-Control': 'no-store',
	});
	if (headOnly) response.end();
	else response.end(body);
}

function sendText(
	response: ServerResponse,
	status: number,
	text: string,
	headers: Record<string, string> = {},
): void {
	const body = Buffer.from(text, 'utf8');
	response.writeHead(status, {
		...UI_SECURITY_HEADERS,
		...response.getHeaders(),
		'Content-Type': 'text/plain; charset=utf-8',
		'Content-Length': String(body.byteLength),
		'Cache-Control': 'no-store',
		...headers,
	});
	response.end(body);
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
	socket.write(
		`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`,
	);
	socket.destroy();
}

function streamProtocolToken(
	value: string | string[] | undefined,
): string | null {
	const header = Array.isArray(value) ? value.join(',') : value;
	if (typeof header !== 'string') return null;
	const protocols = header
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (!protocols.includes(REMOTE_STREAM_PROTOCOL)) return null;
	const auth = protocols.find((entry) =>
		entry.startsWith(REMOTE_STREAM_AUTH_PREFIX),
	);
	const token = decodeStreamToken(
		auth?.slice(REMOTE_STREAM_AUTH_PREFIX.length) ?? '',
	);
	return token.length === 0 || token.length > 512 || hasLineBreak(token)
		? null
		: token;
}

function decodeStreamToken(value: string): string {
	if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) return '';
	const padding = '='.repeat((4 - (value.length % 4)) % 4);
	try {
		return Buffer.from(
			value.replace(/-/gu, '+').replace(/_/gu, '/') + padding,
			'base64',
		).toString('utf8');
	} catch {
		return '';
	}
}

function formatHost(host: string): string {
	return host.includes(':') ? `[${host}]` : host;
}
function isProtocolPath(pathname: string): boolean {
	return (
		pathname === REMOTE_STREAM_PATH ||
		pathname.startsWith('/protocol/reconnect/')
	);
}
function expandAllowedWebOriginAliases(value: string): readonly string[] {
	const origin = normalizeAllowedWebOrigin(value);
	const parsed = new URL(origin);
	if (parsed.protocol !== 'http:' || !isLoopbackHostname(parsed.hostname))
		return [origin];
	const suffix = parsed.port === '' ? '' : `:${parsed.port}`;
	return [
		`http://localhost${suffix}`,
		`http://127.0.0.1${suffix}`,
		`http://[::1]${suffix}`,
	];
}
function normalizeAllowedWebOrigin(value: string): string {
	let origin: URL;
	try {
		origin = new URL(value);
	} catch {
		throw new TypeError('allowed web origin is invalid');
	}
	const loopback =
		origin.protocol === 'http:' && isLoopbackHostname(origin.hostname);
	if (!loopback && origin.protocol !== 'https:')
		throw new TypeError('allowed web origin must use HTTPS or loopback HTTP');
	if (
		origin.username ||
		origin.password ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash
	)
		throw new TypeError('allowed web origin must be exact');
	return origin.origin;
}
function normalizeRequestOrigin(value: string): URL | null {
	try {
		return new URL(normalizeAllowedWebOrigin(value));
	} catch {
		return null;
	}
}
function sameOriginHost(origin: URL, host: string | undefined): boolean {
	if (host === undefined || host.length === 0 || /[\0\r\n]/u.test(host))
		return false;
	return (
		origin.protocol === 'http:' &&
		normalizeHostHeader(host) === origin.host.toLowerCase()
	);
}
function normalizeHostHeader(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/u, '');
}
function isLoopbackHostname(hostname: string): boolean {
	return (
		hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
	);
}
function isSafeId(value: string): boolean {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}
function isSafeVersion(value: string): boolean {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 128 &&
		!hasLineBreak(value)
	);
}
function hasLineBreak(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0 || code === 10 || code === 13) return true;
	}
	return false;
}
function closeServer(server: Server): Promise<void> {
	return new Promise((resolveClose) => {
		if (!server.listening) {
			resolveClose();
			return;
		}
		server.close(() => resolveClose());
	});
}
