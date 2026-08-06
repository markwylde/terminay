import { createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { RemoteReconnectGrantRecord } from '@terminay/server-core';
import {
	createLocalUiServer,
	type LocalUiServer,
	type LocalUiServerOptions,
} from '../../apps/terminay-server/src/localUiServer';
import type {
	ServerPairingHandoff,
	ServerRemoteExposure,
} from '../../apps/terminay-server/src/remote/serverExposure';
import type { RemoteAccessSettings } from '../../src/types/settings';
import { readRemoteAccessConfig, resolveRemoteAccessConfig } from './config';
import { assertPairingPin } from './pinGuard';
import { ensureTlsMaterial } from './tls';

type StartInput = Readonly<{
	exposure: ServerRemoteExposure;
	handoff: ServerPairingHandoff;
	sessionOrigin: string;
}>;

export interface EmbeddedLanExposureOptions {
	/** Electron composes server-core from workspace source while the standalone
	 * package's declaration graph resolves its built package identity. Runtime
	 * behavior is the same framed ServerCore contract; keep the cast at this one
	 * privileged composition seam rather than leaking it through callers. */
	readonly core: unknown;
	readonly getSettings: () => RemoteAccessSettings;
	readonly remoteDirectory: string;
	/** Exact verified browser workspace bundle shipped by this embedded server. */
	readonly uiBundleDirectory: string;
	readonly serverId: string;
	readonly serverVersion: string;
	readonly onReconnectRecordsChanged?: (
		records: readonly RemoteReconnectGrantRecord[],
	) => void;
	readonly onConnectionError?: (error: unknown) => void;
}

/**
 * Explicit network listener for the embedded Local authority. This adapter
 * owns sockets and TLS only; all application frames are accepted by the same
 * ServerCore instance used by the Local renderer.
 */
export class EmbeddedLanExposure {
	private listener: LocalUiServer | undefined;
	private readonly pendingPairings = new Map<
		string,
		Readonly<{
			deviceName: string;
			expiresAt: number;
			publicKeyPem: string;
		}>
	>();

	constructor(private readonly options: EmbeddedLanExposureOptions) {}

	async start(input: StartInput): Promise<void> {
		await this.stop();
		this.pendingPairings.clear();
		const settings = this.options.getSettings();
		const configuredOrigin = new URL(input.sessionOrigin);
		const loopbackHttp =
			configuredOrigin.protocol === 'http:' &&
			['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname);
		if (configuredOrigin.protocol !== 'https:' && !loopbackHttp) {
			throw new Error(
				'Local Network exposure requires HTTPS; loopback HTTP is allowed only for development.',
			);
		}
		const port = configuredOrigin.port
			? Number.parseInt(configuredOrigin.port, 10)
			: configuredOrigin.protocol === 'https:'
				? 443
				: 80;
		if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
			throw new Error('Local Network exposure origin has an invalid port.');

		let tls: Readonly<{ cert: Buffer; key: Buffer }> | undefined;
		if (configuredOrigin.protocol === 'https:') {
			const config = resolveRemoteAccessConfig(
				readRemoteAccessConfig(settings),
			);
			if (config.origin !== input.sessionOrigin)
				throw new Error(
					'Local Network exposure origin changed during startup.',
				);
			await mkdir(this.options.remoteDirectory, {
				recursive: true,
				mode: 0o700,
			});
			const material = await ensureTlsMaterial(
				config,
				this.options.remoteDirectory,
			);
			tls = { cert: material.cert, key: material.key };
		}

		const credentials = createProtocolCredentials();
		const listener = createLocalUiServer({
			serverId: this.options.serverId,
			serverVersion: this.options.serverVersion,
			authToken: input.handoff.pairingToken,
			authTokenExpiresAt: input.handoff.expiresAt,
			authTokenAvailable: () =>
				input.exposure.pairing.metadata(input.handoff.roomId)?.state ===
				'active',
			acceptCredential: credentials.accept,
			rootDirectory: this.options.uiBundleDirectory,
			allowedWebOrigins: [input.sessionOrigin],
			host: settings.bindAddress.trim() || '0.0.0.0',
			port,
			onConnectionError: this.options.onConnectionError,
			protocolCore: this.options.core as NonNullable<
				LocalUiServerOptions['protocolCore']
			>,
			pairing: {
				start: (request) => {
					const expiresAt = Date.parse(request.pairingExpiresAt);
					if (
						request.pairingSessionId !== input.handoff.pairingSessionId ||
						request.pairingToken !== input.handoff.pairingToken ||
						expiresAt !== input.handoff.expiresAt ||
						!Number.isFinite(expiresAt) ||
						expiresAt <= Date.now()
					)
						throw new Error('This pairing code is no longer valid.');
					assertPairingPin(settings, request.pairingPin, {
						contextKey: `embedded-lan:${input.sessionOrigin}:${request.pairingSessionId}`,
						failureLimit: settings.pinFailureLimit,
						requireConfigured: true,
					});
					const deviceName = request.deviceName.trim();
					if (deviceName.length === 0 || deviceName.length > 256)
						throw new Error('Pairing device name is invalid.');
					if (request.publicKeyPem.length > 16_384)
						throw new Error('Pairing public key is invalid.');
					try {
						createPublicKey(request.publicKeyPem);
					} catch {
						throw new Error('Pairing public key is invalid.');
					}
					for (const [id, pending] of this.pendingPairings)
						if (pending.expiresAt <= Date.now())
							this.pendingPairings.delete(id);
					if (this.pendingPairings.size >= 32)
						throw new Error('Too many pending pairing attempts.');
					const provisionalDeviceId = randomUUID();
					this.pendingPairings.set(provisionalDeviceId, {
						deviceName,
						expiresAt,
						publicKeyPem: request.publicKeyPem,
					});
					return { provisionalDeviceId };
				},
				complete: ({ provisionalDeviceId }) => {
					const pending = this.pendingPairings.get(provisionalDeviceId);
					this.pendingPairings.delete(provisionalDeviceId);
					if (pending === undefined || pending.expiresAt <= Date.now())
						throw new Error('This pairing attempt is no longer active.');
					input.exposure.controller.consumePairing({
						roomId: input.handoff.roomId,
						secret: input.handoff.secret,
						serverId: this.options.serverId,
						sessionOrigin: input.sessionOrigin,
					});
					const deviceId = `device-${randomUUID()}`;
					const issued = input.exposure.issueReconnectGrant({
						deviceId,
						lifetime: settings.reconnectGrantLifetime,
					});
					this.publishReconnectRecords(input.exposure);
					return {
						deviceId,
						deviceName: pending.deviceName,
						reconnectGrant: {
							expiresAt:
								issued.expiresAt === null
									? null
									: new Date(issued.expiresAt).toISOString(),
							grant: issued.grant,
							handle: issued.handle,
							issuedAt: new Date(issued.issuedAt).toISOString(),
							origin: issued.sessionOrigin,
							protocolVersion: 'v1' as const,
							sessionId: issued.sessionOrigin,
						},
					};
				},
			},
			reconnect: {
				enroll: ({ clientId }) => {
					const issued = input.exposure.issueReconnectGrant({
						deviceId: clientId,
						lifetime: settings.reconnectGrantLifetime,
					});
					this.publishReconnectRecords(input.exposure);
					return {
						grant: issued.grant,
						handle: issued.handle,
						signingOrigin: issued.sessionOrigin,
					};
				},
				challenge: ({ handle, clientNonce }) => {
					const pending = input.exposure.createReconnectChallenge({
						handle,
						origin: input.sessionOrigin,
						clientNonce,
					});
					return {
						attemptId: pending.challenge.attemptId,
						clientNonce: pending.challenge.clientNonce,
						handle: pending.challenge.handle,
						signingInput: pending.signingInput,
					};
				},
				complete: ({ attemptId, handle, clientNonce, proof }) => {
					input.exposure.verifyReconnectProof({
						attemptId,
						handle,
						origin: input.sessionOrigin,
						clientNonce,
						proof,
					});
					this.publishReconnectRecords(input.exposure);
					return credentials.issue();
				},
			},
			...(tls === undefined ? {} : { tls }),
		});

		try {
			const address = await listener.start();
			if (address.port !== port)
				throw new Error(
					'Local Network listener did not bind the configured exposure port.',
				);
			this.listener = listener;
		} catch (error) {
			await listener.stop().catch(() => undefined);
			throw error;
		}
	}

	async stop(): Promise<void> {
		const listener = this.listener;
		this.listener = undefined;
		await listener?.stop();
		this.pendingPairings.clear();
	}

	private publishReconnectRecords(exposure: ServerRemoteExposure): void {
		this.options.onReconnectRecordsChanged?.(exposure.reconnect.list());
	}
}

function createProtocolCredentials(): Readonly<{
	accept(token: string): boolean;
	issue(): Readonly<{ ticket: string; expiresAt: number }>;
}> {
	const tickets = new Map<string, number>();
	const prune = (now: number) => {
		for (const [ticket, expiresAt] of tickets)
			if (expiresAt <= now) tickets.delete(ticket);
	};
	return {
		accept(token) {
			const now = Date.now();
			prune(now);
			return (tickets.get(token) ?? 0) > now;
		},
		issue() {
			const now = Date.now();
			prune(now);
			const ticket = randomBytes(32).toString('base64url');
			const expiresAt = now + 15 * 60 * 1000;
			tickets.set(ticket, expiresAt);
			return Object.freeze({ ticket, expiresAt });
		},
	};
}
