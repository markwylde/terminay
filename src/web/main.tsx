import type { ConnectionProfile } from '@terminay/client-core';
import {
	ConnectionProfileStore,
	ServerHealthClient,
	TerminayClient,
	TerminayClientFacade,
	WebSocketByteTransport,
} from '@terminay/client-core';
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
import { RendererConnectionGeneration } from '../shared/rendererConnectionGeneration';
import {
	RendererConnectionRecovery,
	type RendererConnectionRecoveryState,
} from '../shared/rendererConnectionRecovery';
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
import { createBrowserWebRtcTransport } from './browserWebRtcTransport';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import { enrollBrowserDevice } from './deviceEnrollment';
import {
	type BrowserConnectionAttempt,
	BrowserConnectionAttemptGate,
	runBoundedBrowserRecoveryStep,
} from './reconnectAttempt';
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
	rendererAttempt: ReturnType<
		RendererConnectionGeneration<ActiveTerminalConnection>['begin']
	>;
	context?: Omit<TerminalPanelClientContextValue, 'projectId'>;
	candidate?: ActiveTerminalConnection;
};

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

const AUTO_RESTORE_PROFILE_STATUSES: ReadonlySet<ConnectionProfile['status']> =
	new Set([
		'connected',
		'connecting',
		'unreachable',
	] satisfies ConnectionProfile['status'][]);
const UNREACHABLE_AUTO_RESTORE_DELAY_MS = 1_250;

function isAutoRestorableProfile(profile: ConnectionProfile): boolean {
	return (
		profile.archived !== true &&
		profile.isLocal !== true &&
		AUTO_RESTORE_PROFILE_STATUSES.has(profile.status)
	);
}

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

function isBrowserReconnectOrigin(origin: string): boolean {
	const parsed = new URL(origin);
	if (parsed.protocol === 'https:') return true;
	return (
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' ||
			parsed.hostname.endsWith('.localhost') ||
			parsed.hostname === '127.0.0.1' ||
			parsed.hostname === '[::1]')
	);
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

function reconnectNeedsFreshPairing(cause: unknown): boolean {
	if (!(cause instanceof Error)) return false;
	return (
		cause.message === 'reconnect proof request is invalid' ||
		cause.message === 'reconnect credential is unavailable for this server' ||
		cause.message === 'reconnect credential changed while signing' ||
		cause.message.includes('Saved reconnect credentials were rejected') ||
		/Server reconnect request failed \((?:400|401|403|404)\)/u.test(
			cause.message,
		)
	);
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
	const [host, setHost] = useState(createHost);
	const connectModalRef = useRef<HTMLElement | null>(null);
	const initialPairingUrlRef = useRef<string | null>(null);
	// A browser reconnect has several asynchronous protocol steps. Keep the
	// most recent user intent so forgetting a profile (or choosing another one)
	// cannot let an older attempt revive a discarded server afterwards.
	const connectionAttemptGate = useRef(new BrowserConnectionAttemptGate());
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
		attempt: BrowserConnectionAttempt;
		deviceName: string;
		mode: 'direct' | 'webrtc';
		origin: string;
		pairingUrl: string;
	} | null>(null);
	const [pairingPin, setPairingPin] = useState('');
	const [activeConnection, setActiveConnection] =
		useState<ActiveTerminalConnection | null>(null);
	const connectionGeneration = useRef(
		new RendererConnectionGeneration<ActiveTerminalConnection>(),
	);
	const recoveryWatermarks = useRef(
		new Map<string, Readonly<{ revision: number; cursor: string }>>(),
	);
	const autoRestoreAttemptedProfileId = useRef<string | null>(null);
	const [reconnectVault] = useState<WebReconnectVault>(
		() => new IndexedDbWebReconnectVault(),
	);
	const hostRef = useRef(host);
	hostRef.current = host;
	const reconnectVaultRef = useRef(reconnectVault);
	reconnectVaultRef.current = reconnectVault;
	const connectionRecovery = useRef<
		RendererConnectionRecovery<WebRecoveryContext> | undefined
	>(undefined);
	if (connectionRecovery.current === undefined) {
		connectionRecovery.current = new RendererConnectionRecovery({
			initialRetryMs: 750,
			maxRetryMs: 10_000,
			connect: connectSavedBrowserProfile,
			dispose: async (recovery) => {
				await recovery.context?.dispose?.().catch(() => undefined);
				await recovery.client.close().catch(() => undefined);
			},
			resubscribe: async (recovery, attempt) => {
				recovery.context = await createConnectedServerClientContext(
					recovery.client,
					recovery.hello,
					{
						signal: attempt.signal,
						onTransportClosed: () =>
							recoverConnection(
								recovery.profile.id,
								recovery.rendererAttempt,
								recovery.client,
							),
					},
				);
			},
			hydrate: async (recovery) => {
				if (recovery.context === undefined)
					throw new Error('Recovered browser context is unavailable.');
				const labelledContext = Object.freeze({
					...recovery.context,
					connectionLabel: recovery.profile.label,
				});
				const candidate = Object.freeze({
					profileId: recovery.profile.id,
					label: recovery.profile.label,
					origin: recovery.profile.origin,
					client: recovery.client,
					serverId: recovery.hello.serverId,
					clientId: recovery.clientId,
					context: labelledContext,
					dispose: () => labelledContext.dispose?.(),
				});
				recovery.candidate = candidate;
			},
			onRecovered: async (recovery) => {
				if (recovery.candidate === undefined)
					throw new Error('Recovered browser connection was not hydrated.');
				if (
					!(await connectionGeneration.current.activate(
						recovery.rendererAttempt,
						recovery.candidate,
					))
				)
					throw new Error('Browser connection attempt was superseded.');
				try {
					setActiveConnection(recovery.candidate);
					hostRef.current.markStatus(recovery.profile.id, 'connected');
					recordReconnectDiagnostic(
						'succeeded',
						connectionRecovery.current?.state.attempt ?? 0,
					);
					setError(null);
					setStatus(null);
					refresh();
				} catch (error) {
					await connectionGeneration.current.disposeActive(recovery.profile.id);
					throw error;
				}
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
		const url = new URL(window.location.href);
		if (
			initialPairingUrlRef.current !== null ||
			window.__TERMINAY_BROWSER_ENROLLMENT__ === undefined ||
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
	}, []);

	useEffect(() => {
		if (window.__TERMINAY_BROWSER_ENROLLMENT__ !== undefined) return;
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

	function beginConnectionAttempt(profileId: string): BrowserConnectionAttempt {
		connectionRecovery.current?.cancel();
		return connectionAttemptGate.current.begin(profileId);
	}

	function isCurrentConnectionAttempt(
		profile: ConnectionProfile,
		attempt: BrowserConnectionAttempt,
	): boolean {
		const stored = host.profiles.get(profile.id);
		return (
			connectionAttemptGate.current.isCurrent(attempt) &&
			stored?.origin === profile.origin &&
			stored.archived !== true
		);
	}

	function invalidateConnectionAttempt(profileId: string): void {
		connectionAttemptGate.current.invalidate(profileId);
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
			if (pairingUrl.searchParams.get('transport') === 'webrtc')
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
				const attempt = beginConnectionAttempt(`pairing:${pairingUrl.origin}`);
				setPairingRequest({
					attempt,
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
		let attempt: BrowserConnectionAttempt | undefined;
		let rendererAttempt:
			| ReturnType<
					RendererConnectionGeneration<ActiveTerminalConnection>['begin']
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
			attempt = beginConnectionAttempt(pendingProfile.id);
			rendererAttempt = connectionGeneration.current.begin(pendingProfile.id);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : 'Unable to add that server.',
			);
			setIsConnecting(false);
			if (throwOnFailure) throw cause;
			return;
		}

		const clientId = `web-${Date.now().toString(36)}`;
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
					if (!connectionAttemptGate.current.isCurrent(attempt))
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
						recoverConnection(connectedProfile.id, rendererAttempt, client);
				},
			});
			if (!isCurrentConnectionAttempt(connectedProfile, attempt)) {
				await context.dispose?.();
				return;
			}
			const labelledContext = Object.freeze({
				...context,
				connectionLabel: connectedProfile.label,
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
				!(await connectionGeneration.current.activate(
					rendererAttempt,
					candidate,
				))
			)
				return;
			setActiveConnection(candidate);
			keepClient = true;
			setStatus(
				`${hello.serverId} connected${ready ? ' and ready' : ''}. This browser can reconnect without the pairing link.`,
			);
			setServerUrl('');
			refresh();
		} catch (cause) {
			if (
				attempt === undefined ||
				!connectionAttemptGate.current.isCurrent(attempt)
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
					if (!connectionAttemptGate.current.isCurrent(pairingRequest.attempt))
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
				isCurrent: () =>
					connectionAttemptGate.current.isCurrent(pairingRequest.attempt),
				origin: pairingRequest.origin,
				pairingPin,
				pairingUrl: pairingRequest.pairingUrl,
			});
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
		const rendererAttempt = connectionGeneration.current.begin(origin);
		const bridge = window.__TERMINAY_BROWSER_ENROLLMENT__;
		if (bridge === undefined)
			throw new Error('Browser device enrollment is unavailable.');
		const transport = await bridge.connect({
			origin,
			pairingPin,
			onStateChange: () => {},
		});
		const clientId = `web-webrtc-${Date.now().toString(36)}`;
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
			const displayOrigin = origin.split('#', 1)[0] ?? origin;
			const parsed = new URL(displayOrigin);
			const existing = host.profiles
				.snapshot()
				.profiles.find((profile) => profile.origin === parsed.origin);
			const profile =
				existing ??
				host.addConnection({
					id: createProfileId(parsed.hostname),
					serverId: hello.serverId,
					label: parsed.host,
					origin: parsed.origin,
					status: 'connected',
				});
			const context = await createConnectedServerClientContext(client, hello, {
				onTransportClosed: () =>
					recoverConnection(profile.id, rendererAttempt, client),
			});
			host.markStatus(profile.id, 'connected');
			const labelledContext = Object.freeze({
				...context,
				connectionLabel: profile.label,
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
				!(await connectionGeneration.current.activate(
					rendererAttempt,
					candidate,
				))
			)
				return;
			setActiveConnection(candidate);
			refresh();
		} catch (error) {
			await client.close().catch(() => undefined);
			throw error;
		}
	}

	async function connectSavedBrowserProfile(
		recoveryAttempt: Readonly<{ key: string; signal: AbortSignal }>,
	): Promise<WebRecoveryContext> {
		const profile = hostRef.current.profiles.get(recoveryAttempt.key);
		if (profile === undefined || profile.archived === true)
			throw new Error('That server is no longer saved in this browser.');
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

		const bridge = window.__TERMINAY_REMOTE_WEBRTC__;
		const transport = await runBoundedBrowserRecoveryStep({
			label: 'Reconnect transport',
			signal: recoveryAttempt.signal,
			operation: async () =>
				bridge?.getChannel === undefined
					? new WebSocketByteTransport({
							origin: endpoint,
							authToken: completion.ticket,
						})
					: createBrowserWebRtcTransport((name) =>
							bridge.getChannel!(name, completion.ticket),
						),
		});
		const clientId = `web-${Date.now().toString(36)}`;
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
			return {
				profile,
				client,
				clientId,
				hello,
				rendererAttempt: connectionGeneration.current.begin(profile.id),
			};
		} catch (cause) {
			await client.close().catch(() => undefined);
			throw cause;
		}
	}

	function publishBrowserRecoveryState(
		recoveryState: RendererConnectionRecoveryState,
	): void {
		if (recoveryState.phase === 'connected') return;
		if (recoveryState.key !== undefined) {
			hostRef.current.markStatus(recoveryState.key, 'unreachable');
		}
		setStatus(null);
		if (recoveryState.phase === 'failed') {
			recordReconnectDiagnostic('failed', recoveryState.attempt);
			const cause =
				recoveryState.error instanceof Error
					? recoveryState.error.message
					: 'Connection recovery failed.';
			setError(`${cause} Retrying in ${recoveryState.nextRetryMs ?? 0}ms…`);
		} else {
			if (recoveryState.phase === 'reconnecting')
				recordReconnectDiagnostic('started', recoveryState.attempt);
			setError(
				recoveryState.phase === 'reconnecting'
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
			connectionRecovery.current?.start(profile.id);
			return;
		}
		const attempt = beginConnectionAttempt(profile.id);
		const rendererAttempt = connectionGeneration.current.begin(profile.id);
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
				const clientId = `web-${Date.now().toString(36)}`;
				const bridge = window.__TERMINAY_REMOTE_WEBRTC__;
				const transport =
					bridge?.getChannel === undefined
						? new WebSocketByteTransport({
								origin: endpoint,
								authToken: completion.ticket,
							})
						: await createBrowserWebRtcTransport((name) =>
								bridge.getChannel!(name, completion.ticket),
							);
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
								recoverConnection(profile.id, rendererAttempt, client),
						},
					);
					if (!isCurrentConnectionAttempt(profile, attempt)) {
						await context.dispose?.();
						return;
					}
					const labelledContext = Object.freeze({
						...context,
						connectionLabel: profile.label,
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
						!(await connectionGeneration.current.activate(
							rendererAttempt,
							candidate,
						))
					)
						return;
					setActiveConnection(candidate);
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
				connectionRecovery.current?.cancel();
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
		invalidateConnectionAttempt(profileId);
		connectionRecovery.current?.cancel();
		if (activeConnection?.profileId === profileId) {
			void connectionGeneration.current.disposeActive(profileId);
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

	function recoverConnection(
		profileId: string,
		attempt: ReturnType<
			RendererConnectionGeneration<ActiveTerminalConnection>['begin']
		>,
		client: TerminayClient,
	): void {
		// A close callback belongs to one exact renderer generation. Once a new
		// attempt begins or activates, a late callback from the retired context
		// must not dispose the replacement merely because it has the same profile.
		if (!connectionGeneration.current.isCurrent(attempt)) {
			recordReconnectDiagnostic('stale-close-ignored', 0);
			return;
		}
		recoveryWatermarks.current.set(profileId, {
			revision: client.snapshot.revision,
			cursor: client.snapshot.cursor,
		});
		void connectionGeneration.current.disposeActive(profileId);
		// Keep the last connected workspace mounted while its replacement
		// generation reconnects. Dropping it here flashes the initial pairing
		// modal on every transient transport loss.
		hostRef.current.markStatus(profileId, 'unreachable');
		setError('Connection lost. Reconnecting…');
		setStatus(null);
		refresh();
		connectionRecovery.current?.start(profileId);
	}

	if (activeConnection !== null && pairingRequest === null) {
		return (
			<ConnectedWorkspace
				connection={activeConnection}
				connectionProfiles={host.profiles}
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
						setServerUrl(rawUrl);
						await connectServer(undefined, rawUrl, true);
					},
				}}
				onBack={() => {
					connectionRecovery.current?.cancel();
					void connectionGeneration.current.disposeActive(
						activeConnection.profileId,
					);
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
										invalidateConnectionAttempt(
											`pairing:${new URL(pairingRequest.pairingUrl).origin}`,
										);
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
	onBack,
}: {
	connection: ActiveTerminalConnection;
	connectionProfiles: ConnectionProfileStore;
	connectionRoute?: Omit<SharedConnectionsRouteBodyProps, 'state'>;
	onBack: () => void;
}) {
	return (
		<ConnectedWebRendererWorkspace
			connectionRoute={connectionRoute ?? { profileStore: connectionProfiles }}
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
