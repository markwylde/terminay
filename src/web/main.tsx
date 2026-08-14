import type { ConnectionProfile } from '@terminay/client-core';
import {
	ConnectionProfileStore,
	ServerHealthClient,
	TerminayClient,
	TerminayClientFacade,
	WebSocketByteTransport,
} from '@terminay/client-core';
import type { ByteTransport, TerminayHostContext } from '@terminay/protocol';
import {
	commitPairedWebConnection,
	consumeLegacyManagerMigration,
	IndexedDbWebReconnectVault,
	WEB_MANAGER_ORIGIN,
	WEB_PROFILE_STORAGE_KEY,
	WebConnectionHost,
	type WebReconnectVault,
} from '@terminay/web';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import { pairDesktopConnection } from '../host/nativeActions';
import type { AppCommand } from '../types/terminay';
import {
	type RendererConnectionAttempt,
	RendererConnectionController,
	type RendererConnectionState,
} from '../shared/rendererConnectionController';
import { createConnectedServerClientContext } from '../shared/rendererServerClient';
import {
	SharedConnectionsRouteBody,
	type SharedConnectionsRouteBodyProps,
} from '../shared/SharedConnectionsRouteBody';
import '../shared/SharedProductionRoutes.css';
import {
	generateDeviceKeyPair,
	removePairing,
	removeReconnectGrant,
	saveEstablishedPairingReversibly,
} from '../remote/services/deviceKeys';
import { establishDevicePairing } from '../remote/services/devicePairingFlow';
import { parsePairingBootstrap } from '../remote/services/pairing';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import {
	acquireDesktopServerBootstrap,
	type DesktopHostBridge,
} from './desktopByteTransport';
import { enrollBrowserDevice } from './deviceEnrollment';
import { PairingIntentController, type PairingIntent } from './pairingIntent';
import { runBoundedBrowserRecoveryStep } from './reconnectAttempt';
import {
	isAutoRestorableProfile,
	isBrowserReconnectOrigin,
	reconnectNeedsFreshPairing,
} from './reconnectPolicy';
import {
	acquireHostedApplicationTransport,
	getSessionTransportHost,
} from './sessionTransportHost';
import { createWebClientId } from './webClientIdentity';
import { classifyWebConnectionFailure } from './webConnectionFailure';
import './index.css';

function openWindow(url: string, target: '_self' | '_blank'): void {
	if (target === '_blank') {
		window.open(url, target, 'noopener,noreferrer');
		return;
	}
	window.location.assign(url);
}

function createHost(): WebConnectionHost {
	const host = new WebConnectionHost({
		managerOrigin: WEB_MANAGER_ORIGIN,
		openWindow,
	});
	const migration = consumeLegacyManagerMigration({ window, host });
	if (migration.status === 'recovery') {
		(
			window as Window & { __terminayLegacyMigrationError?: string }
		).__terminayLegacyMigrationError = migration.message;
	}
	return host;
}

function createProfileId(hostname: string): string {
	const suffix =
		typeof crypto.randomUUID === 'function'
			? crypto.randomUUID().slice(0, 12)
			: Math.random().toString(36).slice(2, 14);
	return `web-${hostname.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-${suffix}`;
}

function recordReconnectDiagnostic(
	phase: 'started' | 'succeeded' | 'failed' | 'stale-close-ignored',
	attempt: number,
): void {
	const diagnostic = (
		globalThis as typeof globalThis & {
			__terminayReconnectDiagnostic?: (
				value: Readonly<{
					phase: typeof phase;
					attempt: number;
				}>,
			) => void;
		}
	).__terminayReconnectDiagnostic;
	try {
		diagnostic?.(Object.freeze({ phase, attempt }));
	} catch {
		// A metadata-only diagnostic sink cannot affect reconnect lifecycle.
	}
}

type ParsedServerUrl = Readonly<{
	displayOrigin: string;
	isLoopbackHttp: boolean;
	transportOrigin: string;
	token?: string;
}>;

type ActiveTerminalConnection = Readonly<{
	profileId: string;
	label: string;
	origin: string;
	client: TerminayClient;
	serverId: string;
	clientId: string;
	context: Omit<TerminalPanelClientContextValue, 'projectId'>;
	dispose: () => void | Promise<void>;
}>;

type WebRecoveryContext = {
	profile: ConnectionProfile;
	client: TerminayClient;
	clientId: string;
	hello: Awaited<ReturnType<TerminayClient['connect']>>;
	context?: Omit<TerminalPanelClientContextValue, 'projectId'>;
	candidate?: ActiveTerminalConnection;
	dispose: () => Promise<void>;
	terminalHydrated: Promise<void>;
};

function managedWebCandidate(
	profile: ConnectionProfile,
	client: TerminayClient,
	clientId: string,
	hello: Awaited<ReturnType<TerminayClient['connect']>>,
	candidate: ActiveTerminalConnection,
	terminalHydrated: Promise<void> = Promise.resolve(),
): WebRecoveryContext {
	return {
		profile,
		client,
		clientId,
		hello,
		candidate,
		terminalHydrated,
		context: candidate.context,
		dispose: async () => {
			await candidate.dispose();
			await client.close().catch(() => undefined);
		},
	};
}

type ReconnectEnrollment = Readonly<{
	handle: string;
	grant: string;
	signingOrigin: string;
}>;

type ReconnectChallenge = Readonly<{
	attemptId: string;
	handle: string;
	clientNonce: string;
	signingInput: string;
}>;

type ReconnectCompletion = Readonly<{
	ticket: string;
	expiresAt: number;
}>;

const UNREACHABLE_AUTO_RESTORE_DELAY_MS = 1_250;

function parseServerUrl(rawValue: string): ParsedServerUrl {
	let parsed: URL;
	try {
		parsed = new URL(rawValue.trim());
	} catch {
		throw new Error('Enter a Terminay server URL.');
	}

	const isLoopbackHttp =
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' ||
			parsed.hostname.endsWith('.localhost') ||
			parsed.hostname === '127.0.0.1' ||
			parsed.hostname === '[::1]');
	if (parsed.protocol !== 'https:' && !isLoopbackHttp) {
		throw new Error('Use HTTPS, or loopback HTTP for local development.');
	}
	if (parsed.username || parsed.password || parsed.search) {
		throw new Error(
			'Server URLs cannot contain usernames, passwords, or query data.',
		);
	}

	const token =
		parsed.hash.length === 0
			? undefined
			: parsePairingToken(parsed.hash.slice(1));
	parsed.hash = '';
	const displayOrigin = parsed.origin;
	const transportOrigin = shouldUseComposeProxy(parsed)
		? window.location.origin
		: displayOrigin;

	return Object.freeze({
		displayOrigin,
		isLoopbackHttp,
		transportOrigin,
		...(token === undefined ? {} : { token }),
	});
}

function parsePairingToken(fragment: string): string {
	let decoded = fragment;
	try {
		decoded = decodeURIComponent(fragment);
	} catch {
		throw new Error('That pairing URL fragment is invalid.');
	}

	const params = new URLSearchParams(decoded);
	const structuredToken = params.get('pairingToken')?.trim() ?? '';
	const token = structuredToken || decoded.trim();
	if (token.length < 16 || token.length > 512 || /[\r\n]/u.test(token)) {
		throw new Error('That pairing URL does not contain a valid token.');
	}
	return token;
}

function shouldUseComposeProxy(url: URL): boolean {
	if (url.protocol !== 'http:') return false;
	const targetIsLoopback =
		url.hostname === 'localhost' ||
		url.hostname === '127.0.0.1' ||
		url.hostname === '[::1]';
	const appIsLoopback =
		window.location.protocol === 'http:' &&
		(window.location.hostname === 'localhost' ||
			window.location.hostname === '127.0.0.1' ||
			window.location.hostname === '[::1]');
	if (!targetIsLoopback || !appIsLoopback) return false;
	const appPort = window.location.port;
	return url.port === '4317' || (appPort.length > 0 && url.port === appPort);
}

function transportOriginForProfile(origin: string): string {
	const parsed = new URL(origin);
	return shouldUseComposeProxy(parsed) ? window.location.origin : parsed.origin;
}

function shouldLaunchOnSessionOrigin(origin: string): boolean {
	return (
		window.location.origin === WEB_MANAGER_ORIGIN &&
		new URL(origin).origin !== window.location.origin
	);
}

function launchPairingOnSessionOrigin(rawUrl: string, origin: string): boolean {
	if (!shouldLaunchOnSessionOrigin(origin)) return false;
	openWindow(rawUrl, '_self');
	return true;
}

function reconnectNonce(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

async function reconnectRequest<T>(
	endpoint: string,
	path: string,
	body: unknown,
	token?: string,
	signal?: AbortSignal,
): Promise<T> {
	const response = await fetch(`${endpoint}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
		},
		body: JSON.stringify(body),
		signal,
	});
	if (!response.ok)
		throw new Error(
			path.endsWith('/complete')
				? 'Saved reconnect credentials were rejected. Paste a fresh pairing URL.'
				: `Server reconnect request failed (${response.status}).`,
		);
	return response.json() as Promise<T>;
}

function throwIfRecoveryAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: new DOMException('Connection recovery was cancelled.', 'AbortError');
}

export default function WebManagerApp() {
	const hasDesktopServerBootstrap =
		window.terminayHost !== undefined || window.terminayBytes !== undefined;
	const [host, setHost] = useState(createHost);
	const connectModalRef = useRef<HTMLElement | null>(null);
	const initialPairingUrlRef = useRef<string | null>(null);
	const pairingIntents = useRef(new PairingIntentController());
	// A browser reconnect has several asynchronous protocol steps. Keep the
	// most recent user intent so forgetting a profile (or choosing another one)
	// cannot let an older attempt revive a discarded server afterwards.
	const [, rerender] = useState(0);
	const [serverUrl, setServerUrl] = useState(() => {
		if (window.location.hash.length <= 1) return '';
		const pairingUrl = window.location.href;
		initialPairingUrlRef.current = pairingUrl;
		const visible = new URL(pairingUrl);
		visible.hash = '';
		window.history.replaceState(null, '', visible);
		return pairingUrl;
	});
	const [error, setError] = useState<string | null>(
		() =>
			(window as Window & { __terminayLegacyMigrationError?: string })
				.__terminayLegacyMigrationError ?? null,
	);
	const [status, setStatus] = useState<string | null>(null);
	const [isConnecting, setIsConnecting] = useState(false);
	const [pairingRequest, setPairingRequest] = useState<{
		intent: PairingIntent;
		deviceName: string;
		mode: 'direct' | 'webrtc';
		origin: string;
		pairingUrl: string;
	} | null>(null);
	const [pairingPin, setPairingPin] = useState('');
	const [activeConnection, setActiveConnection] =
		useState<ActiveTerminalConnection | null>(null);
	const [desktopHostContext, setDesktopHostContext] =
		useState<TerminayHostContext | undefined>();
	const [desktopConnectionGeneration, setDesktopConnectionGeneration] =
		useState(0);
	const recoveryWatermarks = useRef(
		new Map<string, Readonly<{ revision: number; cursor: string }>>(),
	);
	// A protocol reconnect is the same browser device, not a new presentation.
	// Keeping this identity stable lets the server restore that device's terminal
	// controller lease after a transient transport loss instead of demoting it to
	// read-only behind the prior connection's lease.
	const clientIdsByProfile = useRef(new Map<string, string>());
	const autoRestoreAttemptedProfileId = useRef<string | null>(null);
	const [reconnectVault] = useState<WebReconnectVault>(
		() => new IndexedDbWebReconnectVault(),
	);
	const hostRef = useRef(host);
	hostRef.current = host;
	const reconnectVaultRef = useRef(reconnectVault);
	reconnectVaultRef.current = reconnectVault;
	const connectionController = useRef<
		RendererConnectionController<WebRecoveryContext> | undefined
	>(undefined);
	if (connectionController.current === undefined) {
		connectionController.current = new RendererConnectionController({
			classifyFailure: classifyWebConnectionFailure,
			initialRetryMs: 750,
			maxRetryMs: 10_000,
			dispose: async (recovery) => {
				await recovery.dispose();
			},
			onActivated: async (recovery) => {
				if (recovery.candidate === undefined)
					throw new Error('Recovered browser connection was not hydrated.');
				setActiveConnection(recovery.candidate);
				hostRef.current.markStatus(recovery.profile.id, 'connected');
				recordReconnectDiagnostic(
					'succeeded',
					connectionController.current?.state.attempt ?? 0,
				);
				setError(null);
				setStatus(null);
				refresh();
			},
			onCandidate: (recovery) => {
				if (recovery.candidate !== undefined) setActiveConnection(recovery.candidate);
			},
			onStateChange: (recoveryState) =>
				publishBrowserRecoveryState(recoveryState),
		});
	}
	const snapshot = host.snapshot();
	const sharedConnectionProfiles = useMemo(() => {
		const store = new ConnectionProfileStore({ local: false });
		for (const profile of snapshot.profiles.profiles) store.import(profile);
		if (
			snapshot.current?.id !== undefined &&
			snapshot.current.status === 'connected'
		)
			store.select(snapshot.current.id);
		return store;
	}, [host, snapshot.profiles.revision, snapshot.current?.id]);

	useEffect(() => {
		const synchronizeProfiles = (event: StorageEvent) => {
			if (event.key === WEB_PROFILE_STORAGE_KEY) {
				setHost(createHost());
			}
		};
		window.addEventListener('storage', synchronizeProfiles);
		return () => window.removeEventListener('storage', synchronizeProfiles);
	}, []);

	useEffect(() => {
		if (!hasDesktopServerBootstrap) return;
		let cancelled = false;
		let client: TerminayClient | undefined;
		setIsConnecting(true);
		void acquireDesktopServerBootstrap(
			window.terminayHost as DesktopHostBridge | undefined,
			window.terminayBytes,
			{ replaceEndpoint: desktopConnectionGeneration > 0 },
		)
			.then(async (bootstrap) => {
				if (bootstrap === undefined) return;
				setDesktopHostContext(bootstrap.context);
				// Replacing a Desktop byte endpoint keeps the same selected profile and
				// browser-side workspace. Reuse its protocol identity so the server
				// resumes the existing terminal presentation rather than treating the
				// replacement lane as another client with a competing control lease.
				const clientId =
					clientIdsByProfile.current.get(bootstrap.context.profileId) ??
					createWebClientId('desktop');
				clientIdsByProfile.current.set(bootstrap.context.profileId, clientId);
				client = new TerminayClient({
					transport: bootstrap.transport,
					clientId,
					clientVersion: '0.0.0',
					capabilities: [
						'server.health',
						'terminal',
						'workspace',
						'files',
						'agents',
					],
				});
				const hello = await client.connect();
				if (hello.serverId !== bootstrap.context.serverId)
					throw new Error('Desktop connected to the wrong Terminay Server.');
				const connectedContext = await createConnectedServerClientContext(client, hello, {
					onTransportClosed: () => {
						if (!cancelled) {
							setError('Connection lost. Reconnecting…');
							setDesktopConnectionGeneration((generation) => generation + 1);
						}
					},
				});
				if (cancelled) {
					await connectedContext.dispose?.();
					await client.close().catch(() => undefined);
					return;
				}
				const label =
					bootstrap.context.profile?.label ??
					(bootstrap.context.profileId === 'local:embedded'
						? 'Local'
						: bootstrap.context.profileId);
				const labelledContext = Object.freeze({
					...connectedContext,
					connectionLabel: label,
				});
				setActiveConnection({
					profileId: bootstrap.context.profileId,
					label,
					origin: window.location.origin,
					client,
					serverId: hello.serverId,
					clientId,
					context: labelledContext,
					dispose: () => labelledContext.dispose?.(),
				});
				setError(null);
			})
			.catch((cause) => {
				if (!cancelled)
					setError(
						cause instanceof Error
							? cause.message
							: 'Unable to connect to the Desktop server.',
					);
			})
			.finally(() => {
				if (!cancelled) setIsConnecting(false);
			});
		return () => {
			cancelled = true;
			setDesktopHostContext(undefined);
			void client?.close().catch(() => undefined);
		};
	}, [hasDesktopServerBootstrap, desktopConnectionGeneration]);

	useEffect(() => {
		const url = new URL(window.location.href);
		if (
			hasDesktopServerBootstrap ||
			initialPairingUrlRef.current !== null ||
			getSessionTransportHost() === undefined ||
			new URLSearchParams(url.hash.slice(1)).has('pairingToken')
		)
			return;
		const origin = `${url.origin}#transport=webrtc:${url.origin}`;
		setIsConnecting(true);
		void connectPairedWebRtcBrowser(origin)
			.catch((cause) =>
				setError(
					cause instanceof Error
						? cause.message
						: 'Unable to reconnect this browser.',
				),
			)
			.finally(() => setIsConnecting(false));
	}, [hasDesktopServerBootstrap]);

	useEffect(() => {
		if (hasDesktopServerBootstrap) return;
		if (getSessionTransportHost() !== undefined) return;
		if (activeConnection !== null || isConnecting) return;
		if (new URLSearchParams(window.location.hash.slice(1)).has('pairingToken'))
			return;
		const currentProfile =
			snapshot.current !== undefined &&
			isAutoRestorableProfile(snapshot.current)
				? snapshot.current
				: undefined;
		const latestProfile = snapshot.profiles.profiles.reduce<
			(typeof snapshot.profiles.profiles)[number] | undefined
		>((latest, candidate) => {
			if (!isAutoRestorableProfile(candidate)) return latest;
			if (latest === undefined) return candidate;
			const candidateTime = candidate.lastConnectedAt ?? candidate.createdAt;
			const latestTime = latest.lastConnectedAt ?? latest.createdAt;
			return candidateTime > latestTime ? candidate : latest;
		}, undefined);
		const profile = currentProfile ?? latestProfile;
		if (profile === undefined) return;
		if (autoRestoreAttemptedProfileId.current === profile.id) return;
		autoRestoreAttemptedProfileId.current = profile.id;
		const timeout =
			profile.status === 'unreachable'
				? window.setTimeout(
						() =>
							void openConnection(profile.id, false, true).catch(() => {
								if (autoRestoreAttemptedProfileId.current === profile.id) {
									autoRestoreAttemptedProfileId.current = null;
								}
							}),
						UNREACHABLE_AUTO_RESTORE_DELAY_MS,
					)
				: null;
		if (timeout === null) {
			void openConnection(profile.id, false, true).catch(() => {
				if (autoRestoreAttemptedProfileId.current === profile.id) {
					autoRestoreAttemptedProfileId.current = null;
				}
			});
		}
		return () => {
			if (timeout !== null) window.clearTimeout(timeout);
		};
	}, [
		activeConnection,
		hasDesktopServerBootstrap,
		isConnecting,
		snapshot.current?.id,
		snapshot.current?.status,
		snapshot.profiles.revision,
	]);

	// The disconnected shell is deliberately visible behind the required
	// connection dialog. Keep its decorative controls out of the keyboard path
	// until a server has been selected.
	useEffect(() => {
		const modal = connectModalRef.current;
		if (modal === null) return;

		const selector = [
			'button:not([disabled])',
			'input:not([disabled])',
			'select:not([disabled])',
			'textarea:not([disabled])',
			'[href]',
			'[tabindex]:not([tabindex="-1"])',
		].join(', ');
		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== 'Tab') return;
			const focusable = Array.from(
				modal.querySelectorAll<HTMLElement>(selector),
			).filter((element) => !element.hasAttribute('hidden'));
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			const active = document.activeElement;
			if (event.shiftKey && (active === first || !modal.contains(active))) {
				event.preventDefault();
				last.focus();
			} else if (
				!event.shiftKey &&
				(active === last || !modal.contains(active))
			) {
				event.preventDefault();
				first.focus();
			}
		};

		modal.addEventListener('keydown', handleKeyDown);
		return () => modal.removeEventListener('keydown', handleKeyDown);
	}, []);

	function refresh(): void {
		rerender((value) => value + 1);
	}

	function beginPairingIntent(): PairingIntent {
		return pairingIntents.current.begin();
	}

	function isCurrentPairingIntent(intent: PairingIntent): boolean {
		return pairingIntents.current.isCurrent(intent);
	}

	function cancelPairingIntent(): void {
		pairingIntents.current.cancel();
	}

	function beginConnectionAttempt(profileId: string): RendererConnectionAttempt {
		return connectionController.current!.begin(profileId);
	}

	function isCurrentConnectionAttempt(
		profile: ConnectionProfile,
		attempt: RendererConnectionAttempt,
	): boolean {
		const stored = host.profiles.get(profile.id);
		return (
			connectionController.current?.isCurrent(attempt) === true &&
			stored?.origin === profile.origin &&
			stored.archived !== true
		);
	}

	function invalidateConnectionAttempt(profileId: string): void {
		void connectionController.current?.stop(profileId);
	}

	async function connectServer(
		event?: Pick<React.FormEvent<HTMLFormElement>, 'preventDefault'>,
		rawServerUrl = serverUrl,
		throwOnFailure = false,
	): Promise<void> {
		event?.preventDefault();
		setError(null);
		setStatus(null);
		setIsConnecting(true);
		let explicitWebRtcUrl: URL | null = null;
		let explicitDirectDeviceUrl: URL | null = null;
		try {
			const pairingUrl = new URL(rawServerUrl);
			const sessionHost = getSessionTransportHost();
			const isHostedSessionPairing =
				sessionHost !== undefined &&
				pairingUrl.origin === sessionHost.origin &&
				new URLSearchParams(pairingUrl.hash.slice(1)).has('pairingToken');
			if (
				pairingUrl.searchParams.get('transport') === 'webrtc' ||
				isHostedSessionPairing
			)
				explicitWebRtcUrl = pairingUrl;
			if (
				new URLSearchParams(pairingUrl.hash.slice(1)).get('pairingFlow') ===
				'device'
			)
				explicitDirectDeviceUrl = pairingUrl;
		} catch {
			// The generic parser below owns ordinary invalid URL diagnostics.
		}
		if (explicitWebRtcUrl !== null || explicitDirectDeviceUrl !== null) {
			try {
				// Validate the complete one-time bootstrap before presenting a PIN
				// form. Generic token parsing must not weaken this transaction.
				parsePairingBootstrap(rawServerUrl);
				const pairingUrl = explicitWebRtcUrl ?? explicitDirectDeviceUrl!;
				if (launchPairingOnSessionOrigin(rawServerUrl, pairingUrl.origin))
					return;
				const intent = beginPairingIntent();
				setPairingRequest({
					intent,
					deviceName: 'Terminay Remote Browser',
					mode: explicitWebRtcUrl === null ? 'direct' : 'webrtc',
					origin:
						explicitWebRtcUrl === null
							? pairingUrl.origin
							: `${pairingUrl.origin}#transport=webrtc:${pairingUrl.origin}`,
					pairingUrl: rawServerUrl,
				});
				setPairingPin('');
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: 'That pairing URL is invalid.',
				);
				if (throwOnFailure) {
					setIsConnecting(false);
					throw cause;
				}
			}
			setIsConnecting(false);
			return;
		}
		let parsed: ParsedServerUrl;
		let profile: ConnectionProfile | undefined;
		let pendingProfile:
			| Readonly<{
					id: string;
					label: string;
					origin: string;
					serverId: string;
			  }>
			| undefined;
		let attempt: RendererConnectionAttempt | undefined;
		let rendererAttempt:
			| ReturnType<
					RendererConnectionController<WebRecoveryContext>['begin']
			  >
			| undefined;
		try {
			parsed = parseServerUrl(rawServerUrl);
			if (parsed.isLoopbackHttp && parsed.token === undefined) {
				throw new Error(
					'This local server requires a pairing URL. Paste the full URL with its #pairingToken fragment.',
				);
			}
			if (parsed.token === undefined) {
				throw new Error(
					'This server needs a pairing URL before it can be connected and saved.',
				);
			}
			if (launchPairingOnSessionOrigin(rawServerUrl, parsed.displayOrigin))
				return;
			const displayUrl = new URL(parsed.displayOrigin);
			const existing = host.profiles
				.snapshot()
				.profiles.find((candidate) => candidate.origin === displayUrl.origin);
			pendingProfile = {
				id: existing?.id ?? createProfileId(displayUrl.hostname),
				serverId: existing?.serverId ?? displayUrl.hostname,
				label: existing?.label ?? displayUrl.host,
				origin: parsed.displayOrigin,
			};
			// A connection attempt has one controller generation.  Beginning it twice
			// makes the first generation stale before its handshake completes, so a
			// valid pairing silently disposes its client instead of selecting the
			// newly paired server.
			rendererAttempt = beginConnectionAttempt(pendingProfile.id);
			attempt = rendererAttempt;
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : 'Unable to add that server.',
			);
			setIsConnecting(false);
			if (throwOnFailure) throw cause;
			return;
		}

		const clientId =
			clientIdsByProfile.current.get(pendingProfile.id) ??
			createWebClientId();
		clientIdsByProfile.current.set(pendingProfile.id, clientId);
		const client = new TerminayClient({
			transport: new WebSocketByteTransport({
				origin: parsed.transportOrigin,
				authToken: parsed.token,
			}),
			clientId,
			clientVersion: '0.0.0',
			// This connected surface immediately loads the canonical workspace,
			// terminal, file, and agent projections. Negotiate those capabilities
			// up front so an older server fails at connection time rather than
			// rendering a misleading empty workspace after `workspace.snapshot`.
			capabilities: [
				'server.health',
				'terminal',
				'workspace',
				'files',
				'agents',
			],
		});
		let keepClient = false;
		try {
			const hello = await client.connect();
			const health = await new ServerHealthClient(
				new TerminayClientFacade(client),
			).snapshot();
			const ready = health.ready;
			const enrollment = await reconnectRequest<ReconnectEnrollment>(
				parsed.transportOrigin,
				'/protocol/reconnect/enroll',
				{ clientId },
				parsed.token,
			);
			const connectedProfile = await commitPairedWebConnection({
				vault: reconnectVault,
				enrollment: {
					origin: pendingProfile.origin,
					handle: enrollment.handle,
					grant: enrollment.grant,
					signingOrigin: enrollment.signingOrigin,
				},
				persistProfile: () => {
					if (!connectionController.current?.isCurrent(attempt) === true)
						throw new Error('This pairing attempt is no longer active.');
					return host.addConnection({
						...pendingProfile,
						serverId: hello.serverId,
						status: 'connected',
					});
				},
			});
			profile = connectedProfile;
			host.markStatus(connectedProfile.id, 'connected');
			const context = await createConnectedServerClientContext(client, hello, {
					onTransportClosed: () => {
						if (rendererAttempt !== undefined)
							handleTransportClosed(connectedProfile.id, rendererAttempt, client);
					},
			});
			if (!isCurrentConnectionAttempt(connectedProfile, attempt)) {
				await context.dispose?.();
				return;
			}
			const labelledContext = Object.freeze({
				...context,
				connectionLabel: connectedProfile.label,
				retryConnection: connectionController.current?.retry,
				canRetryConnection: () => connectionController.current?.state.phase === 'retry-wait',
			});
			const candidate = {
				profileId: connectedProfile.id,
				label: connectedProfile.label,
				origin: connectedProfile.origin,
				client,
				serverId: hello.serverId,
				clientId,
				context: labelledContext,
				dispose: () => labelledContext.dispose?.(),
			};
			if (rendererAttempt === undefined) return;
			if (
				!(await connectionController.current!.activate(
					rendererAttempt,
					managedWebCandidate(connectedProfile, client, clientId, hello, candidate),
				))
			)
				return;
			setActiveConnection(candidate);
			connectionController.current!.setRecoveryPipeline(connectedProfile.id, browserRecoveryPipeline());
			keepClient = true;
			setStatus(
				`${hello.serverId} connected${ready ? ' and ready' : ''}. This browser can reconnect without the pairing link.`,
			);
			setServerUrl('');
			refresh();
		} catch (cause) {
			if (
				attempt === undefined ||
				!connectionController.current?.isCurrent(attempt) === true
			)
				return;
			invalidateConnectionAttempt(attempt.profileId);
			if (profile !== undefined) {
				host.markStatus(profile.id, 'unreachable');
				refresh();
			}
			setError(
				cause instanceof Error
					? cause.message
					: 'Unable to connect to that server.',
			);
			if (throwOnFailure) throw cause;
		} finally {
			if (!keepClient) await client.close().catch(() => undefined);
			setIsConnecting(false);
		}
	}

	useEffect(() => {
		if (initialPairingUrlRef.current === null) return;
		initialPairingUrlRef.current = null;
		void connectServer();
		// The initial fragment is a one-shot bootstrap captured before first render.
		// State changes from the connection attempt must never replay it.
	}, []);

	async function submitBrowserEnrollment(
		event: React.FormEvent<HTMLFormElement>,
	): Promise<void> {
		event.preventDefault();
		if (pairingRequest === null) return;
		setError(null);
		if (!/^\d{6}$/u.test(pairingPin)) {
			setError('Pairing PIN must be exactly 6 digits.');
			return;
		}
		setIsConnecting(true);
		try {
			if (pairingRequest.mode === 'direct') {
				const origin = new URL(pairingRequest.origin).origin;
				let profile: ConnectionProfile | undefined;
				let rollbackDevicePairing: (() => Promise<void>) | undefined;
				let rollbackReconnect: (() => Promise<void>) | undefined;
				try {
					await establishDevicePairing({
					api: {
						async postJson<TResponse>(pathname: string, body: unknown) {
							const response = await fetch(new URL(pathname, origin), {
								body: JSON.stringify(body),
								headers: { 'content-type': 'application/json' },
								method: 'POST',
							});
							const payload = (await response.json().catch(() => ({}))) as {
								error?: string;
							} & TResponse;
							if (!response.ok)
								throw new Error(payload.error ?? 'Device pairing failed.');
							return payload;
						},
					},
					bootstrap: parsePairingBootstrap(pairingRequest.pairingUrl),
						credentials: {
							saveEstablishedPairing: async ({ pairing, reconnectGrant }) => {
								if (reconnectGrant === undefined)
									throw new Error(
										'This server did not issue reconnect credentials.',
									);
								const device = await saveEstablishedPairingReversibly(
									pairing,
									reconnectGrant,
								);
								rollbackDevicePairing = device.rollback;
								try {
									const reconnect = await reconnectVault.enrollReversibly({
										origin,
										handle: reconnectGrant.handle,
										grant: reconnectGrant.grant,
										signingOrigin: reconnectGrant.origin,
									});
									rollbackReconnect = reconnect.rollback;
								} catch (cause) {
									await device.rollback();
									throw cause;
								}
							},
						},
					deviceName: pairingRequest.deviceName,
					generateKeyPair: generateDeviceKeyPair,
					origin,
					pairingPin,
					});
					if (!isCurrentPairingIntent(pairingRequest.intent))
						throw new Error('This pairing attempt is no longer active.');
					profile = host.profiles
						.snapshot()
						.profiles.find((candidate) => candidate.origin === origin);
					profile ??= host.addConnection({
						id: createProfileId(new URL(origin).hostname),
						serverId: new URL(origin).hostname,
						label: new URL(origin).host,
						origin,
						status: 'connecting',
					});
				} catch (cause) {
					await Promise.allSettled([
						rollbackReconnect?.() ?? Promise.resolve(),
						rollbackDevicePairing?.() ?? Promise.resolve(),
					]);
					throw cause;
				}
				setPairingPin('');
				setPairingRequest(null);
				refresh();
				await openConnection(profile.id);
				return;
			}
			await enrollBrowserDevice({
				deviceName: pairingRequest.deviceName,
				isCurrent: () => isCurrentPairingIntent(pairingRequest.intent),
				origin: pairingRequest.origin,
				pairingPin,
				pairingUrl: pairingRequest.pairingUrl,
			});
			if (!isCurrentPairingIntent(pairingRequest.intent))
				throw new Error('This pairing attempt is no longer active.');
			setPairingPin('');
			await connectPairedWebRtcBrowser(pairingRequest.origin, pairingPin);
			setPairingRequest(null);
		} catch (cause) {
			setPairingPin('');
			setError(
				cause instanceof Error ? cause.message : 'Unable to pair this browser.',
			);
		} finally {
			setIsConnecting(false);
		}
	}

	async function connectPairedWebRtcBrowser(
		origin: string,
		pairingPin?: string,
	): Promise<void> {
		const sessionHost = getSessionTransportHost();
		if (sessionHost === undefined)
			throw new Error('Browser device enrollment is unavailable.');
		const transport = await sessionHost.connect({
			origin,
			pairingPin,
			onStateChange: () => {},
		});
		const displayOrigin = origin.split('#', 1)[0] ?? origin;
		const parsed = new URL(displayOrigin);
		const stableProfileId = createProfileId(parsed.hostname);
		// A session-host connection has no HTTP reconnect handshake to recover its
		// renderer identity for us. Keep the same identity for the profile across
		// initial pairing and a replacement lane so the server replaces this
		// browser's terminal attachment instead of leaving it as a stale observer.
		const existingProfile = host.profiles
			.snapshot()
			.profiles.find((profile) => profile.origin === parsed.origin);
		const profileId = existingProfile?.id ?? stableProfileId;
		const clientId =
			clientIdsByProfile.current.get(profileId) ??
			createWebClientId('web-webrtc');
		clientIdsByProfile.current.set(profileId, clientId);
		const client = new TerminayClient({
			transport,
			clientId,
			clientVersion: '0.0.0',
			capabilities: [
				'server.health',
				'terminal',
				'workspace',
				'files',
				'agents',
			],
		});
		try {
			const hello = await client.connect();
			const profile =
				existingProfile ??
					host.addConnection({
					id: stableProfileId,
					serverId: hello.serverId,
					label: parsed.host,
					origin: parsed.origin,
					status: 'connected',
				});
			const rendererAttempt = connectionController.current!.begin(profile.id);
			const context = await createConnectedServerClientContext(client, hello, {
				onTransportClosed: () =>
					handleTransportClosed(profile.id, rendererAttempt, client),
			});
			host.markStatus(profile.id, 'connected');
			const labelledContext = Object.freeze({
				...context,
				connectionLabel: profile.label,
				retryConnection: connectionController.current?.retry,
				canRetryConnection: () => connectionController.current?.state.phase === 'retry-wait',
			});
			const candidate = {
				profileId: profile.id,
				label: profile.label,
				origin: profile.origin,
				client,
				serverId: hello.serverId,
				clientId,
				context: labelledContext,
				dispose: () => labelledContext.dispose?.(),
			};
			if (
				!(await connectionController.current!.activate(
					rendererAttempt,
					managedWebCandidate(profile, client, clientId, hello, candidate),
				))
			)
				return;
			setActiveConnection(candidate);
			connectionController.current!.setRecoveryPipeline(profile.id, browserRecoveryPipeline());
			refresh();
		} catch (error) {
			await client.close().catch(() => undefined);
			throw error;
		}
	}

	async function connectSavedBrowserProfile(
		recoveryAttempt: Readonly<{ profileId: string; signal: AbortSignal }>,
	): Promise<WebRecoveryContext> {
		const profile = hostRef.current.profiles.get(recoveryAttempt.profileId);
		if (profile === undefined || profile.archived === true)
			throw new Error('That server is no longer saved in this browser.');
		const sessionHost = getSessionTransportHost();
		let transport: ByteTransport;
		if (sessionHost !== undefined) {
			transport = await runBoundedBrowserRecoveryStep({
				label: 'Reconnect session transport',
				signal: recoveryAttempt.signal,
				operation: () => sessionHost.connect({
					onStateChange: () => {},
					origin: profile.origin,
				}),
			});
		} else {
		const credential = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect credential lookup',
			signal: recoveryAttempt.signal,
			operation: () => reconnectVaultRef.current.credential(profile.origin),
		});
		throwIfRecoveryAborted(recoveryAttempt.signal);
		if (credential === undefined)
			throw new Error(
				'This server needs a fresh pairing URL because this browser has no saved reconnect credential.',
			);

		const endpoint = transportOriginForProfile(profile.origin);
		const clientNonce = reconnectNonce();
		const challenge = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect challenge',
			signal: recoveryAttempt.signal,
			operation: (signal) =>
				reconnectRequest<ReconnectChallenge>(
					endpoint,
					'/protocol/reconnect/challenge',
					{ handle: credential.handle, clientNonce },
					undefined,
					signal,
				),
		});
		throwIfRecoveryAborted(recoveryAttempt.signal);
		const proof = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect credential signing',
			signal: recoveryAttempt.signal,
			operation: () =>
				reconnectVaultRef.current.sign({
					origin: profile.origin,
					handle: credential.handle,
					signingInput: challenge.signingInput,
				}),
		});
		throwIfRecoveryAborted(recoveryAttempt.signal);
		const completion = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect ticket',
			signal: recoveryAttempt.signal,
			operation: (signal) =>
				reconnectRequest<ReconnectCompletion>(
					endpoint,
					'/protocol/reconnect/complete',
					{
						attemptId: challenge.attemptId,
						handle: credential.handle,
						clientNonce,
						proof,
					},
					undefined,
					signal,
				),
		});
		throwIfRecoveryAborted(recoveryAttempt.signal);

		transport = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect transport',
			signal: recoveryAttempt.signal,
			operation: async () => {
				const hosted = await acquireHostedApplicationTransport(completion.ticket);
				return hosted ?? new WebSocketByteTransport({
							origin: endpoint,
							authToken: completion.ticket,
						});
			},
		});
		}
		const clientId =
			clientIdsByProfile.current.get(profile.id) ?? createWebClientId();
		clientIdsByProfile.current.set(profile.id, clientId);
		const initialWatermark = recoveryWatermarks.current.get(profile.id);
		const client = new TerminayClient({
			transport,
			...(initialWatermark === undefined ? {} : { initialWatermark }),
			clientId,
			clientVersion: '0.0.0',
			capabilities: [
				'server.health',
				'terminal',
				'workspace',
				'files',
				'agents',
			],
		});
		try {
			throwIfRecoveryAborted(recoveryAttempt.signal);
			const hello = await runBoundedBrowserRecoveryStep({
				label: 'Reconnect handshake',
				signal: recoveryAttempt.signal,
				operation: (signal) => client.connect(signal),
			});
			throwIfRecoveryAborted(recoveryAttempt.signal);
			const currentProfile = hostRef.current.profiles.get(profile.id);
			if (
				currentProfile?.origin !== profile.origin ||
				currentProfile.archived === true
			)
				throw new Error('That server is no longer saved in this browser.');
			if (
				profile.status !== 'connecting' &&
				hello.serverId !== profile.serverId
			) {
				throw new Error('Recovered server identity does not match the saved profile.');
			}
			const verifiedProfile =
				profile.status === 'connecting'
					? hostRef.current.addConnection({
							...profile,
							serverId: hello.serverId,
							status: 'connected',
						})
					: profile;
			const context = await createConnectedServerClientContext(client, hello, {
				signal: recoveryAttempt.signal,
				onTransportClosed: () => connectionController.current?.recover(profile.id),
			});
			let reportTerminalHydrated!: () => void;
			let reportTerminalHydrationFailed!: (error: unknown) => void;
			const terminalHydrated = new Promise<void>((resolve, reject) => {
				reportTerminalHydrated = resolve;
				reportTerminalHydrationFailed = reject;
			});
			const labelledContext = Object.freeze({
				...context,
				connectionLabel: profile.label,
				retryConnection: connectionController.current?.retry,
				canRetryConnection: () => connectionController.current?.state.phase === 'retry-wait',
				reportConnectionHydrated: reportTerminalHydrated,
				reportConnectionHydrationFailed: reportTerminalHydrationFailed,
			});
			const candidate = Object.freeze({
				profileId: profile.id,
				label: profile.label,
				origin: profile.origin,
				client,
				serverId: hello.serverId,
				clientId,
				context: labelledContext,
				dispose: () => labelledContext.dispose?.(),
			});
			return managedWebCandidate(verifiedProfile, client, clientId, hello, candidate, terminalHydrated);
		} catch (cause) {
			await client.close().catch(() => undefined);
			throw cause;
		}
	}

	function browserRecoveryPipeline() {
		return {
			acquire: connectSavedBrowserProfile,
			resubscribe: async () => {},
			hydrate: async () => {},
			verify: async (recovery: WebRecoveryContext) => {
				if (recovery.candidate === undefined)
					throw new Error('Recovered browser connection was not hydrated.');
				// Terminal attachment/resume traverses the replacement application
				// client and receives a confirmed server result. It is the hydration
				// probe. A separate query here can reject and dispose the candidate
				// before React commits the context queued by onCandidate, leaving the
				// mounted panel with a new callback bound to already-closed authority.
				await recovery.terminalHydrated;
			},
		};
	}

	function startBrowserRecovery(profileId: string): void {
		connectionController.current?.connect(profileId, browserRecoveryPipeline());
	}

	function publishBrowserRecoveryState(
		recoveryState: RendererConnectionState,
	): void {
		if (recoveryState.phase === 'connected') return;
		if (recoveryState.profileId !== undefined) {
			const recoveringProfile = hostRef.current.profiles.get(recoveryState.profileId);
			if (recoveringProfile?.status !== 'connecting') {
				hostRef.current.markStatus(recoveryState.profileId, 'unreachable');
			}
		}
		setStatus(null);
		if (recoveryState.phase === 'retry-wait') {
			recordReconnectDiagnostic('failed', recoveryState.attempt);
			const cause =
				recoveryState.error instanceof Error
					? recoveryState.error.message
					: 'Connection recovery failed.';
			setError(`${cause} Retrying in ${recoveryState.nextRetryMs ?? 0}ms…`);
		} else if (recoveryState.phase === 'blocked' || recoveryState.phase === 'stopped') {
			const cause = recoveryState.error instanceof Error
				? recoveryState.error.message
				: `Connection ${recoveryState.reason ?? recoveryState.phase}.`;
			setError(cause);
			if (recoveryState.phase === 'stopped') setActiveConnection(null);
		} else {
			if (recoveryState.phase === 'connecting')
				recordReconnectDiagnostic('started', recoveryState.attempt);
			setError(
				recoveryState.phase === 'connecting'
					? 'Connection lost. Reconnecting…'
					: recoveryState.phase === 'resubscribing'
						? 'Connection restored. Resubscribing…'
						: 'Connection restored. Hydrating workspace…',
			);
		}
		refresh();
	}

	async function openConnection(
		profileId: string,
		newTab = false,
		recovering = false,
	): Promise<void> {
		setError(null);
		const profile = host.profiles.get(profileId);
		if (profile === undefined) {
			setError('That server is no longer saved in this browser.');
			return;
		}
		if (shouldLaunchOnSessionOrigin(profile.origin)) {
			host.open(profileId, { newTab });
			return;
		}
		if (recovering) {
			startBrowserRecovery(profile.id);
			return;
		}
		if (getSessionTransportHost() !== undefined) {
			await connectPairedWebRtcBrowser(profile.origin);
			return;
		}
		// Keep the reconnect handshake and activation bound to the same generation.
		const rendererAttempt = beginConnectionAttempt(profile.id);
		const attempt = rendererAttempt;
		try {
			if (isBrowserReconnectOrigin(profile.origin)) {
				const credential = await reconnectVault.credential(profile.origin);
				if (credential === undefined)
					throw new Error(
						'This server needs a fresh pairing URL because this browser has no saved reconnect credential.',
					);
				const endpoint = transportOriginForProfile(profile.origin);
				const clientNonce = reconnectNonce();
				const challenge = await reconnectRequest<ReconnectChallenge>(
					endpoint,
					'/protocol/reconnect/challenge',
					{
						handle: credential.handle,
						clientNonce,
					},
				);
				const proof = await reconnectVault.sign({
					origin: profile.origin,
					handle: credential.handle,
					signingInput: challenge.signingInput,
				});
				const completion = await reconnectRequest<ReconnectCompletion>(
					endpoint,
					'/protocol/reconnect/complete',
					{
						attemptId: challenge.attemptId,
						handle: credential.handle,
						clientNonce,
						proof,
					},
				);
				// A device-paired direct connection must retain the same protocol
				// identity across recovery. A new id makes the server treat the
				// replacement as another device and loses this browser's terminal
				// attachment during the reconnect handoff.
				const clientId =
					clientIdsByProfile.current.get(profile.id) ?? createWebClientId();
				clientIdsByProfile.current.set(profile.id, clientId);
				const hosted = await acquireHostedApplicationTransport(completion.ticket);
				const transport = hosted ?? new WebSocketByteTransport({
								origin: endpoint,
								authToken: completion.ticket,
							});
				const initialWatermark = recoveryWatermarks.current.get(profile.id);
				const client = new TerminayClient({
					transport,
					...(initialWatermark === undefined ? {} : { initialWatermark }),
					clientId,
					clientVersion: '0.0.0',
					capabilities: [
						'server.health',
						'terminal',
						'workspace',
						'files',
						'agents',
					],
				});
				let keepClient = false;
				try {
					const hello = await client.connect();
					if (!isCurrentConnectionAttempt(profile, attempt)) return;
					const context = await createConnectedServerClientContext(
						client,
						hello,
						{
							onTransportClosed: () =>
								handleTransportClosed(profile.id, rendererAttempt, client),
						},
					);
					if (!isCurrentConnectionAttempt(profile, attempt)) {
						await context.dispose?.();
						return;
					}
					const labelledContext = Object.freeze({
						...context,
						connectionLabel: profile.label,
						retryConnection: connectionController.current?.retry,
						canRetryConnection: () => connectionController.current?.state.phase === 'retry-wait',
					});
					const candidate = {
						profileId: profile.id,
						label: profile.label,
						origin: profile.origin,
						client,
						serverId: hello.serverId,
						clientId,
						context: labelledContext,
						dispose: () => labelledContext.dispose?.(),
					};
					if (
						!(await connectionController.current!.activate(
							rendererAttempt,
							managedWebCandidate(profile, client, clientId, hello, candidate),
						))
					)
						return;
					setActiveConnection(candidate);
					connectionController.current!.setRecoveryPipeline(profile.id, browserRecoveryPipeline());
					host.markStatus(profile.id, 'connected');
					recordReconnectDiagnostic('succeeded', 0);
					setError(null);
					setStatus(null);
					keepClient = true;
				} catch (_cause) {
					throw new Error(
						'Saved reconnect credentials were rejected during protocol handshake.',
					);
				} finally {
					if (!keepClient) await client.close().catch(() => undefined);
				}
				return;
			}
			host.open(profileId, { newTab });
		} catch (cause) {
			if (!isCurrentConnectionAttempt(profile, attempt)) return;
			setStatus(null);
			if (reconnectNeedsFreshPairing(cause)) {
				invalidateConnectionAttempt(profile.id);
				void connectionController.current?.stop(profile.id);
				host.disconnect(profile.id);
				await reconnectVault.forget(profile.origin).catch(() => undefined);
				setActiveConnection((current) =>
					current?.profileId === profile.id ? null : current,
				);
				setError(
					'Saved reconnect credentials are no longer valid. Paste a fresh pairing URL.',
				);
				refresh();
				return;
			}
			setError(
				recovering
					? 'Connection lost. Reconnecting…'
					: cause instanceof Error
						? cause.message
						: 'Unable to open that server.',
			);
		}
		refresh();
	}

	async function forgetConnection(profileId: string): Promise<void> {
		const origin = host.profiles.get(profileId)?.origin;
		clientIdsByProfile.current.delete(profileId);
		invalidateConnectionAttempt(profileId);
		void connectionController.current?.stop(profileId, 'forgotten');
		if (activeConnection?.profileId === profileId) {
			void connectionController.current?.stop(profileId);
			setActiveConnection(null);
		}
		if (origin !== undefined) {
			await Promise.all([
				reconnectVault.forget(origin),
				removePairing(origin),
				removeReconnectGrant(origin),
			]);
		}
		host.forget(profileId, true);
		refresh();
	}

	function handleTransportClosed(
		profileId: string,
		attempt: ReturnType<
			RendererConnectionController<WebRecoveryContext>['begin']
		>,
		client: TerminayClient,
	): void {
		// A close callback belongs to one exact renderer generation. Once a new
		// attempt begins or activates, a late callback from the retired context
		// must not dispose the replacement merely because it has the same profile.
		if (!connectionController.current!.isCurrent(attempt)) {
			recordReconnectDiagnostic('stale-close-ignored', 0);
			return;
		}
		recoveryWatermarks.current.set(profileId, {
			revision: client.snapshot.revision,
			cursor: client.snapshot.cursor,
		});
		// Keep the last connected workspace mounted while its replacement
		// generation reconnects. Dropping it here flashes the initial pairing
		// modal on every transient transport loss.
		hostRef.current.markStatus(profileId, 'unreachable');
		setError('Connection lost. Reconnecting…');
		setStatus(null);
		refresh();
		connectionController.current?.recover(profileId);
	}

	if (activeConnection !== null && pairingRequest === null) {
		return (
			<ConnectedWorkspace
				connection={activeConnection}
				connectionProfiles={host.profiles}
				hostContext={desktopHostContext}
				subscribeAppCommands={
					window.terminayHost !== undefined
						? (listener: (command: AppCommand) => Promise<void> | void) =>
								(
									window.terminayHost as unknown as DesktopHostBridge
								).subscribeEvent((event) => {
									if (event.event.type === 'menu.command') {
										return listener(event.event.command)
									}
								})
						: undefined
				}
				connectionRoute={{
					profileStore: sharedConnectionProfiles,
					canPair: true,
					onSelect: (profile) => openConnection(profile.id),
					onRemember: (profile) => {
						host.addConnection(profile);
						refresh();
					},
					onRename: (profile, label) => {
						host.rename(profile.id, label);
						refresh();
					},
					onForget: (profile) => forgetConnection(profile.id),
					onPairingHandoff: async (rawUrl) => {
						if (await pairDesktopConnection(rawUrl)) return;
						setServerUrl(rawUrl);
						await connectServer(undefined, rawUrl, true);
					},
				}}
				onBack={() => {
					void connectionController.current?.stop(activeConnection.profileId);
					setActiveConnection(null);
				}}
			/>
		);
	}

	if (pairingRequest !== null) {
		return (
			<main className="browser-host-shell" data-web-host-shell="terminay">
				<div className="connect-modal-backdrop" role="presentation">
					<section
						ref={connectModalRef}
						className="connect-modal connect-modal--enrollment"
						role="dialog"
						aria-modal="true"
						aria-labelledby="enroll-browser-heading"
						aria-describedby="enroll-browser-description"
					>
						<div className="connect-modal__header">
							<h1 id="enroll-browser-heading">Enroll browser device</h1>
						</div>
						<p id="enroll-browser-description" className="muted">
							Name this browser and enter the six-digit PIN shown by the
							Terminay server.
						</p>
						<form
							className="connection-form connection-form--modal"
							onSubmit={(event) => void submitBrowserEnrollment(event)}
						>
							<label>
								Device name
								<input
									autoFocus
									value={pairingRequest.deviceName}
									onChange={(event) =>
										setPairingRequest((current) =>
											current === null
												? null
												: { ...current, deviceName: event.target.value },
										)
									}
								/>
							</label>
							<label>
								Pairing PIN
								<input
									type="password"
									inputMode="numeric"
									autoComplete="one-time-code"
									pattern="[0-9]{6}"
									maxLength={6}
									value={pairingPin}
									onChange={(event) =>
										setPairingPin(
											event.target.value.replace(/\D/gu, '').slice(0, 6),
										)
									}
								/>
							</label>
							<div className="connect-modal__actions">
								<button
									type="button"
									className="secondary"
									onClick={() => {
						cancelPairingIntent();
										setPairingPin('');
										setPairingRequest(null);
										setServerUrl('');
									}}
								>
									Cancel pairing
								</button>
								<button
									type="submit"
									disabled={
										isConnecting ||
										pairingRequest.deviceName.trim().length === 0 ||
										pairingPin.length !== 6
									}
								>
									{isConnecting ? 'Pairing…' : 'Pair and connect'}
								</button>
							</div>
						</form>
						{error && (
							<p className="error" role="alert">
								{error}
							</p>
						)}
					</section>
				</div>
			</main>
		);
	}

	return (
		<main className="browser-host-shell" data-web-host-shell="terminay">
			<header className="browser-host-titlebar">
				<div className="browser-window-controls" aria-hidden="true">
					<span />
					<span />
					<span />
				</div>
				<div
					className="browser-project-tabs"
					role="tablist"
					aria-label="Host tabs"
				>
					<div
						className="browser-project-tab browser-project-tab--active"
						role="tab"
						aria-selected="true"
						tabIndex={0}
					>
						<span className="browser-project-tab__dot" />
						<span>Terminay</span>
					</div>
					<button
						className="browser-project-tab browser-project-tab--new"
						type="button"
						aria-label="Add connection"
					>
						+
					</button>
				</div>
				<span className="host-badge">Browser host · no Local server</span>
			</header>

			<section
				className="browser-host-workspace"
				aria-label="Disconnected Terminay workspace"
			>
				<aside className="browser-host-sidebar" aria-label="Workspace routes">
					<button
						className="browser-host-sidebar__item browser-host-sidebar__item--active"
						type="button"
					>
						Workspace
					</button>
					<button className="browser-host-sidebar__item" type="button" disabled>
						Connections
					</button>
					<button className="browser-host-sidebar__item" type="button" disabled>
						Settings
					</button>
				</aside>

				<section
					className="browser-host-empty-workspace"
					aria-label="Workspace requires a server connection"
				>
					<div className="browser-host-empty-terminal" aria-hidden="true">
						<span className="terminal-cursor" />
					</div>
				</section>
			</section>

			<div className="connect-modal-backdrop" role="presentation">
				<section
					ref={connectModalRef}
					className="connect-modal"
					role="dialog"
					aria-modal="true"
					aria-labelledby="connect-server-heading"
					aria-describedby="connect-server-description"
				>
					<div className="connect-modal__header">
						<h1 id="connect-server-heading">Connect to Remote Server</h1>
					</div>
					<p id="connect-server-description" className="muted">
						Paste a pairing or authenticated server URL from a Terminay server.
						The browser host stores only non-secret connection metadata.
					</p>
					<form
						className="connection-form connection-form--modal"
						onSubmit={(event) => void connectServer(event)}
					>
						<label>
							Pairing URL
							<input
								id="terminay-server-url"
								name="serverUrl"
								autoComplete="url"
								placeholder="https://... or http://localhost:4317/#pairingToken=..."
								value={serverUrl}
								autoFocus
								onChange={(event) => setServerUrl(event.target.value)}
							/>
						</label>
						<div className="connect-modal__actions">
							<button
								className="secondary"
								type="button"
								onClick={() => setServerUrl('')}
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={isConnecting || serverUrl.trim().length === 0}
							>
								{isConnecting ? 'Connecting…' : 'Connect'}
							</button>
						</div>
					</form>
					{status && (
						<p className="success" role="status">
							{status}
						</p>
					)}
					{error && (
						<p className="error" role="alert">
							{error}
						</p>
					)}

					<section
						className="connect-modal__profiles"
						aria-labelledby="saved-servers-heading"
					>
						<h2 id="saved-servers-heading">Saved servers</h2>
						<SharedConnectionsRouteBody
							state="ready"
							embedded
							profileStore={sharedConnectionProfiles}
							canPair
							onSelect={(profile) => openConnection(profile.id)}
							onRemember={(profile) => {
								host.addConnection(profile);
								refresh();
							}}
							onRename={(profile, label) => {
								host.rename(profile.id, label);
								refresh();
							}}
							onForget={(profile) => forgetConnection(profile.id)}
							onPairingHandoff={async (rawUrl) => {
								if (await pairDesktopConnection(rawUrl)) return;
								setServerUrl(rawUrl);
								await connectServer(undefined, rawUrl, true);
							}}
						/>
					</section>
				</section>
			</div>
		</main>
	);
}

function ConnectedWorkspace({
	connection,
	connectionProfiles,
	connectionRoute,
	hostContext,
	onBack,
	subscribeAppCommands,
}: {
	connection: ActiveTerminalConnection;
	connectionProfiles: ConnectionProfileStore;
	connectionRoute?: Omit<SharedConnectionsRouteBodyProps, 'state'>;
	hostContext?: TerminayHostContext;
	onBack: () => void;
	subscribeAppCommands?: (
		listener: (command: AppCommand) => Promise<void> | void,
	) => () => void;
}) {
	return (
		<ConnectedWebRendererWorkspace
			connectionRoute={connectionRoute ?? { profileStore: connectionProfiles }}
			hostContext={hostContext}
			subscribeAppCommands={subscribeAppCommands}
			onBack={onBack}
			terminalClientContext={connection.context}
		/>
	);
}

export function mountWebManagerApp(root: HTMLElement): void {
	createRoot(root).render(<WebManagerApp />);
}

const root = document.getElementById('web-root');
if (root !== null) mountWebManagerApp(root);
