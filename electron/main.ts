import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import {
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	type ByteTransport,
	type JsonValue,
	type TerminayHostActionRequest,
	type TerminayHostContext,
} from '@terminay/protocol';
import {
	app,
	BrowserWindow,
	clipboard,
	crashReporter,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	Notification,
	powerMonitor,
	safeStorage,
	screen,
	shell,
	webContents,
} from 'electron';
import { LocalServerUiSession } from '../apps/terminay-desktop/src/main/localServerUiSession';
import {
	type DesktopAuthenticatedAssetLane,
	type DesktopBundleLaunch,
	DesktopServerBundleHost,
} from '../apps/terminay-desktop/src/main/serverBundleHost';
import { MacroRepository } from '../packages/server-core/src/macroService/repository';
import { ParakeetRuntime } from '../packages/server-core/src/aiService/parakeetRuntime';
import {
	FileProjectEnvironmentStateBackend,
	ProjectEnvironmentRepository,
} from '../packages/server-core/src/projectEnvironment/index';
import {
	RecordingService,
	ServerRecordingAdapter,
} from '../packages/server-core/src/recordingService/index';
import type { RemoteReconnectGrantRecord } from '../packages/server-core/src/remote/reconnect';
import { ServerSettingsRepository } from '../packages/server-core/src/settings/repository';
import { createServerVaultComposition } from '../packages/server-core/src/settings/vaultComposition';
import { openCanonicalWorkspace } from '../packages/server-core/src/workspaceHydration';
import {
	createNodeShellDiscoveryHost,
	ShellProfileCatalogueService,
	ShellProfileDiscoveryService,
} from '../packages/server-core/src/shellProfiles/index';
import type { TerminalEvent } from '../packages/server-core/src/terminalService/index';
import {
	findCommandForKeyboardEvent,
	getCommandShortcut,
	isReservedSystemAccelerator,
} from '../src/keyboardShortcuts';
import { defaultMacros, normalizeMacros } from '../src/macroSettings';
import { distanceToRect, pointInRect } from '../src/projectTabDrag';
import { parseRemoteStreamConnectionUrl } from '../src/shared/remoteStreamTransport';
import {
	type ServerMessagePort,
} from '../src/shared/serverPortTransport';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
} from '../src/terminalSettings';
import { isAgentProvider } from '../src/types/agentStatus';
import type { MacroDefinition } from '../src/types/macros';
import type { TerminalSettings } from '../src/types/settings';
import type {
	AiTabMetadataModel,
	AppCommand,
	AppUpdateStatus,
	RemoteAccessStatus,
} from '../src/types/terminay';
import {
	AiTabMetadataService,
	warmAiTabMetadataProviderEnv,
} from './aiTabMetadata/service';
import {
	bindLocalServerUiDocumentEndpoint,
	bindRemoteServerUiDocumentEndpoint,
} from './serverUiDocumentEndpoint';
import { showCanonicalLaunchRecovery } from './canonicalLaunchRecovery';
import { createEmbeddedWorkspaceStateBackend, embeddedWorkspacePersistenceFault } from './workspacePersistence';
import {
	assertBoundServerUiEvent,
	bindServerUiWindow,
	getServerUiPartitionName,
	releaseServerUiWindowBinding,
} from './serverUiHost';
import {
	CONTROL_SOCKET_ENV,
	CONTROL_SOCKET_FILENAME,
	CONTROL_TOKEN_ENV,
	type ControlOp,
} from './control/protocol';
import {
	type ControlForwardResult,
	type ControlServer,
	type ControlServerScope,
	createControlServer,
} from './control/server';
import {
	bindAppChildDiagnostics,
	bindWebContentsDiagnostics,
} from './diagnostics/electronEvents';
import { createDiagnosticsHelpMenuItems } from './diagnostics/menu';
import {
	bindFatalProcessDiagnostics,
	initializeDesktopDiagnostics,
} from './diagnostics/service';
import { normalizeExternalHttpsUrl } from './externalUrl';
import { FileBufferService } from './fileViewer/fileBufferService';
import { FileWatchService } from './fileViewer/fileWatchService';
import { GitDiffService } from './fileViewer/gitDiffService';
import { registerFileViewerIpcHandlers } from './fileViewer/ipc';
import { createGracefulQuitHandler } from './gracefulQuit';
import {
	bindMainWindowCloseConfirmation,
	createCloseConfirmationDialog,
} from './mainWindowCloseConfirmation';
import {
	getMcpInstallStatus,
	installMcpAgent,
	type McpServerCommand,
	uninstallMcpAgent,
} from './mcpInstall';
import { TerminalRecordingService } from './recording/service';
import { createDesktopReconnectTransport } from './remote/desktopReconnect';
import { enrollDesktopReconnectCredential } from './remote/desktopReconnectEnrollment';
import { createDesktopBootstrappedWebRtcConnection } from './remote/desktopWebRtcBootstrap';
import { resolveDesktopWebRtcRuntimeRoot } from './remote/desktopWebRtcRuntimeRoot';
import {
	createEphemeralTestProtectedValueCodec,
	DesktopDeviceCredentialStore,
} from './remote/deviceCredentialStore';
import { EmbeddedLanExposure } from './remote/embeddedLanExposure';
import { createHostedSignalingRoomRegistrar } from './remote/hostedSignalingRegistration';
import { createPairingPinHash } from './remote/pin';
import { PrivilegedWebRtcExposure } from './remote/privilegedWebRtcExposure';
import { DesktopServerOwnedExposure } from './remote/serverOwnedExposure';
import {
	ServerTerminalAuthority,
	writePortDiagnostic,
} from './serverTerminalAuthority';
import { secureSession } from './sessionSecurity';
import { assertTrustedIpcSender } from './trustedIpcSender';
import {
	ElectronSafeStorageVaultAdapter,
	FileSafeStorageVaultRepository,
} from './vault/safeStorageVault';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASES_LATEST_URL =
	'https://github.com/markwylde/terminay/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DICTATION_OPENAI_SECRET_ID = 'dictation-openai-api-key';
const DICTATION_OPENAI_SECRET_NAME = 'OpenAI API key';
const desktopTestCredentialCodec =
	process.env.TERMINAY_TEST === '1'
		? createEphemeralTestProtectedValueCodec()
		: undefined;

process.env.APP_ROOT = path.join(__dirname, '..');
app.setName('Terminay');

const customUserDataPath = process.env.TERMINAY_USER_DATA_DIR?.trim();
if (customUserDataPath) {
	app.setPath('userData', customUserDataPath);
}

try {
	if (process.env.TERMINAY_TEST === '1' && customUserDataPath) {
		app.setAppLogsPath(path.join(customUserDataPath, 'logs'));
	} else {
		app.setAppLogsPath();
	}
} catch {
	process.stderr.write(
		'[Terminay diagnostics] application log path setup failed\n',
	);
}
app.commandLine.appendSwitch(
	'enable-features',
	'DocumentPolicyIncludeJSCallStacksInCrashReports',
);
const desktopDiagnostics = await initializeDesktopDiagnostics({
	app,
	crashReporter,
});
const unbindFatalProcessDiagnostics =
	bindFatalProcessDiagnostics(desktopDiagnostics);
const unbindAppChildDiagnostics = bindAppChildDiagnostics({
	app,
	diagnostics: desktopDiagnostics,
});

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
export const SERVER_UI_DIST = path.join(process.env.APP_ROOT, 'dist-web');

let localServerUiSession: LocalServerUiSession;
let remoteServerUiBundleHost: DesktopServerBundleHost;
let embeddedStartupWindowForRecovery: BrowserWindow | null = null;

/** A window can be closed while Local startup is deliberately paused on the
 * host-owned recovery document. The UI session does not exist yet in that
 * state, so teardown must be a no-op instead of throwing from Electron's
 * `closed` callback. */
function releaseLocalServerUiSessionSafely(webContentsId: number): void {
	try {
		localServerUiSession?.release(webContentsId);
	} catch (error) {
		void desktopDiagnostics
			.record(
				{
					component: 'renderer',
					event: 'renderer.bootstrap.failed',
					message: error,
					severity: 'warning',
					source: 'canonical-window-teardown',
				},
				{ channel: 'lifecycle' },
			)
			.catch(() => undefined);
	}
}

/** Recovery diagnostics are intentionally best effort: their writer may be
 * the failed dependency, and must never make a caught startup failure fatal. */
function recordCanonicalRecoveryDiagnostic(message: unknown): Promise<void> {
	return desktopDiagnostics
		.record(
			{
				component: 'renderer',
				event: 'renderer.bootstrap.failed',
				message,
				severity: 'error',
				source: 'canonical-launch-recovery',
			},
			{ channel: 'lifecycle' },
		)
		.catch(() => undefined);
}
const localServerUiPartitionKey = createHash('sha256')
	.update('desktop-local\0local:embedded')
	.digest('base64url');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, 'public')
	: RENDERER_DIST;

async function openInBrowser(url: unknown): Promise<void> {
	await shell.openExternal(normalizeExternalHttpsUrl(url));
}

function isAppNavigation(url: string): boolean {
	try {
		const parsedUrl = new URL(url);

		if (VITE_DEV_SERVER_URL) {
			return parsedUrl.origin === new URL(VITE_DEV_SERVER_URL).origin;
		}

		if (parsedUrl.protocol !== 'file:') {
			return false;
		}

		const filePath = fileURLToPath(parsedUrl);
		const relativePath = path.relative(RENDERER_DIST, filePath);

		return (
			relativePath.length > 0 &&
			!relativePath.startsWith('..') &&
			!path.isAbsolute(relativePath)
		);
	} catch {
		return false;
	}
}

/** Privileged IPC is accepted only from the top-level, known Terminay app
 * renderer. Payload validation alone is insufficient because a subframe or
 * foreign document could otherwise invoke the same preload-exposed channel. */
function assertTrustedAppSender(
	event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
): void {
	assertTrustedIpcSender(event, {
		isAllowedNavigation: isAppNavigation,
		isKnownWindow: (sender) => {
			const window = BrowserWindow.fromWebContents(
				sender as Electron.WebContents,
			);
			return (
				window !== null && !window.isDestroyed() && isTrustedAppWindow(window)
			);
		},
	});
}

function isTrustedAppWindow(window: BrowserWindow): boolean {
	return appWindows.has(window);
}

function isTrustedDictationWindow(window: BrowserWindow): boolean {
	return appWindows.has(window);
}

function allowPrimaryWindowPermission(
	requestingWebContents: unknown,
	permission: unknown,
	details: unknown,
): boolean {
	if (
		permission !== 'media' ||
		requestingWebContents === null ||
		typeof requestingWebContents !== 'object'
	) {
		return false;
	}

	const window = BrowserWindow.fromWebContents(
		requestingWebContents as Electron.WebContents,
	);
	if (window === null || !isTrustedDictationWindow(window)) {
		return false;
	}

	const mediaDetails = details as {
		mediaType?: unknown;
		mediaTypes?: unknown;
	};
	if (mediaDetails.mediaType !== undefined) {
		return mediaDetails.mediaType === 'audio';
	}

	return (
		Array.isArray(mediaDetails.mediaTypes) &&
		mediaDetails.mediaTypes.length > 0 &&
		mediaDetails.mediaTypes.every((mediaType) => mediaType === 'audio')
	);
}

/** Apply the process-wide, renderer-agnostic hardening shared by every native
 * shell. The exact navigation allowlist belongs to the current server-UI
 * document binding in `bindServerUiWindow`: a Desktop window can legitimately
 * switch from the embedded bundle to a verified remote bundle, whose file root
 * is not this application's static `dist` directory. Keeping the old
 * application-root allowlist here silently prevented that committed switch and
 * left the Connections dialog mounted. */
function securePrimaryWindow(window: BrowserWindow): void {
	const contents = window.webContents;
	contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	contents.on('will-attach-webview', (event) => event.preventDefault());
	secureSession(contents.session, allowPrimaryWindowPermission);
}

function getBrandAssetPath(filename: string): string | null {
	const candidates = [
		path.join(process.env.VITE_PUBLIC, filename),
		path.join(process.cwd(), 'public', filename),
		path.join(app.getAppPath(), 'public', filename),
		path.join(process.env.APP_ROOT, 'public', filename),
	];

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return null;
}

function getWindowIconPath(): string | undefined {
	if (process.platform === 'win32') {
		return (
			getBrandAssetPath('icon.ico') ??
			getBrandAssetPath('terminay.png') ??
			undefined
		);
	}

	if (process.platform === 'darwin') {
		return (
			getBrandAssetPath('icon.icns') ??
			getBrandAssetPath('terminay.png') ??
			undefined
		);
	}

	return (
		getBrandAssetPath('terminay.png') ??
		getBrandAssetPath('terminay.svg') ??
		undefined
	);
}

let terminalZoomLevel = 0;

function broadcastZoomChange(): void {
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) {
			continue;
		}
		window.webContents.send('terminal:zoom-changed', {
			zoomLevel: terminalZoomLevel,
		});
	}
}

function zoomIn(): void {
	if (terminalZoomLevel < 10) {
		terminalZoomLevel++;
		broadcastZoomChange();
	}
}

function zoomOut(): void {
	if (terminalZoomLevel > -5) {
		terminalZoomLevel--;
		broadcastZoomChange();
	}
}

function resetZoom(): void {
	terminalZoomLevel = 0;
	broadcastZoomChange();
}

// Shell-profile discovery is constructed before the embedded authority. Keep
// that lifecycle state explicit so its reference callback cannot mistake an
// uninitialised binding for a published workspace authority.
let serverTerminalAuthority: ServerTerminalAuthority | null = null;
let privilegedWebRtcExposure: PrivilegedWebRtcExposure | null = null;
let embeddedLanExposure: EmbeddedLanExposure;
let desktopRemoteExposure: DesktopServerOwnedExposure;
let desktopDirectNetworkExposure: DesktopServerOwnedExposure;
const privilegedWebRtcSessions = new Set<string>();
let appliedAgentIntegrationSetting: boolean | null = null;
let applyAgentIntegrationPromise = Promise.resolve();

function applyAgentIntegrationSetting(
	settings: TerminalSettings,
): Promise<void> {
	const enabled = settings.agentIntegration.enabled;
	applyAgentIntegrationPromise = applyAgentIntegrationPromise
		.catch(() => undefined)
		.then(async () => {
			if (appliedAgentIntegrationSetting === enabled) {
				return;
			}

			const serverAgents = serverTerminalAuthority?.agents;
			if (serverAgents !== undefined) {
				await serverTerminalAuthority?.composition.start();
				serverAgents.setIntegrationEnabled(enabled);
			}
			if (enabled) {
				// Rebind terminals that remained alive while observation was disabled.
				if (serverAgents !== undefined && serverTerminalAuthority !== null) {
					for (const session of serverTerminalAuthority.list()) {
						const identity = serverTerminalAuthority.agentIdentity(session.id);
						if (identity !== undefined) {
							serverAgents.register(identity);
							if (session.pid !== undefined)
								serverAgents.terminalStarted(identity, session.pid);
						}
					}
				}
				appliedAgentIntegrationSetting = true;
				return;
			}
			appliedAgentIntegrationSetting = false;
		})
		.catch((error) => {
			appliedAgentIntegrationSetting = null;
			console.error(
				'[agent-status] failed to apply integration setting',
				error,
			);
		});
	return applyAgentIntegrationPromise;
}

// --- MCP control surface state -------------------------------------------
// Each terminal gets a unique capability token injected into its shell env.
// The token both authorizes the local control socket and anchors scope (the
// session, hence the project, the calling agent lives in).
interface ControlTokenRecord {
	projectId?: string;
	token: string;
	sessionId: string;
	webContentsId: number;
}
const controlTokensByToken = new Map<string, ControlTokenRecord>();
const controlTokensBySession = new Map<string, string>();
let controlServer: ControlServer | null = null;
// BrowserWindow identity outlives a renderer document and its transferred
// MessagePort. Keep the selected authority separately so a reload reconnects
// the same profile instead of allowing the Local load hook to take over.
const remoteProfileBindingsByWebContents = new Map<number, string>();
const auxiliaryWindowsByPresentation = new Map<string, BrowserWindow>();
const launchRecoveryWebContents = new Set<number>();
const deferredCanonicalLaunches = new Map<number, () => Promise<void>>();

type RememberedRemoteConnection = {
	id: string;
	kind: 'device' | 'standalone';
	label: string;
	origin: string;
};

const rememberedRemoteConnections = new Map<
	string,
	RememberedRemoteConnection
>();
let rememberedRemoteConnectionsLoaded = false;

function rememberedRemoteConnectionsPath(): string {
	return path.join(app.getPath('userData'), 'connection-profiles.json');
}

function loadRememberedRemoteConnections(): void {
	if (rememberedRemoteConnectionsLoaded) return;
	rememberedRemoteConnectionsLoaded = true;
	try {
		const raw = JSON.parse(
			readFileSync(rememberedRemoteConnectionsPath(), 'utf8'),
		) as unknown;
		if (!Array.isArray(raw)) return;
		for (const candidate of raw) {
			if (
				typeof candidate !== 'object' ||
				candidate === null ||
				Array.isArray(candidate)
			)
				continue;
			const value = candidate as Record<string, unknown>;
			if (
				typeof value.id !== 'string' ||
				typeof value.label !== 'string' ||
				typeof value.origin !== 'string' ||
				(value.kind !== 'device' && value.kind !== 'standalone')
			)
				continue;
			const origin = new URL(value.origin);
			if (
				(origin.protocol !== 'https:' &&
					!(
						origin.protocol === 'http:' &&
						['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
					)) ||
				origin.username ||
				origin.password ||
				origin.pathname !== '/' ||
				origin.search ||
				origin.hash
			)
				continue;
			rememberedRemoteConnections.set(value.id, {
				id: value.id,
				kind: value.kind,
				label: value.label,
				origin: origin.origin,
			});
		}
	} catch {
		// A missing or malformed metadata file is an empty profile list. It
		// contains no credentials and must never prevent Local from starting.
	}
}

/** The connection menu contains only non-secret profile metadata. Write it as
 * one replacement so a reconnect never observes half a newly paired profile. */
function rememberRemoteConnection(profile: RememberedRemoteConnection): void {
	loadRememberedRemoteConnections();
	rememberedRemoteConnections.set(profile.id, profile);
	const destination = rememberedRemoteConnectionsPath();
	mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
	const temporary = `${destination}.${randomUUID()}.tmp`;
	writeFileSync(
		temporary,
		JSON.stringify([...rememberedRemoteConnections.values()]),
		{ encoding: 'utf8', mode: 0o600, flag: 'wx' },
	);
	renameSync(temporary, destination);
}

function createDesktopDeviceCredentialStore(): DesktopDeviceCredentialStore {
	return new DesktopDeviceCredentialStore({
		codec: desktopTestCredentialCodec ?? {
			backend: selectedSafeStorageBackend,
			decrypt: (encrypted) => safeStorage.decryptString(encrypted),
			encrypt: (plainText) => safeStorage.encryptString(plainText),
			isAvailable: () => safeStorage.isEncryptionAvailable(),
		},
		directory: path.join(app.getPath('userData'), 'remote-device-credentials'),
	});
}

function selectedSafeStorageBackend(): string | undefined {
	const backend = (
		safeStorage as typeof safeStorage & {
			getSelectedStorageBackend?: () => string | undefined;
		}
	).getSelectedStorageBackend;
	return typeof backend === 'function' ? backend.call(safeStorage) : undefined;
}

// A project torn off into its own window (or merged into another) travels as an
// opaque payload built by the renderer. Main only needs the terminal session
// ids so it can re-home ownership of the live PTYs to the receiving window.
// Project-host (index.html) windows, as opposed to the auxiliary settings /
// macros / recordings / edit windows. Multi-window project tabs are peers.
const appWindows = new Set<BrowserWindow>();
const workspaceViewByWebContents = new Map<number, string>();
// A server-UI document has exactly one opaque byte endpoint.  Rebinding a
// Desktop window from Local to a paired server must retire the Local endpoint
// before the new preload announces readiness; otherwise both endpoint owners
// can race to deliver a port and the new document can reconnect to Local.
const documentEndpointUnbindByWebContents = new Map<number, () => void>();

function sanitizedDesktopConnectionProfiles(selectedProfileId: string): Readonly<{
	profile: Readonly<{
		id: string;
		isLocal: boolean;
		label: string;
		status: 'connected' | 'offline' | 'unavailable';
	}>;
	profiles: readonly Readonly<{
		id: string;
		isLocal: boolean;
		label: string;
		status: 'connected' | 'offline' | 'unavailable';
	}>[];
}> {
	loadRememberedRemoteConnections();
	const profiles = [
		{
			id: LocalServerUiSession.profileId,
			isLocal: true,
			label: 'Local',
			status: selectedProfileId === LocalServerUiSession.profileId
				? ('connected' as const)
				: ('offline' as const),
		},
		...[...rememberedRemoteConnections.values()]
			.sort((left, right) => left.label.localeCompare(right.label))
			.map((remote) => ({
				id: remote.id,
				isLocal: false,
				label: remote.label,
				status:
					remote.id === selectedProfileId
						? ('connected' as const)
						: ('offline' as const),
			})),
	];
	const profile = profiles.find((candidate) => candidate.id === selectedProfileId);
	if (profile === undefined)
		throw new Error('The Desktop window profile is unavailable.');
	return Object.freeze({
		profile: Object.freeze(profile),
		profiles: Object.freeze(profiles.map((candidate) => Object.freeze(candidate))),
	});
}

function getRunningTerminalCount(): number {
	const authority = serverTerminalAuthority;
	if (authority === null) return 0;
	return authority.list().filter(
		(session) =>
			authority.activity.get({
				serverId: session.serverId,
				projectId: session.projectId,
				sessionId: session.id,
			})?.foregroundBusy === true,
	).length;
}

function getRunningTerminalCountForWindow(webContentsId: number): number {
	const authority = serverTerminalAuthority;
	if (authority === null) return 0;
	// A torn-off window owns a logical workspace view.  Its terminal stream can
	// still be replaying into the new renderer when the user closes the window,
	// so a transient renderer subscription is not a safe destructive-close
	// boundary.  Resolve the terminal scope from the canonical view instead.
	const viewId = workspaceViewByWebContents.get(webContentsId);
	const projectIds = authority.workspace.state.views[viewId ?? '']?.projectIds;
	if (projectIds === undefined) return 0;
	const ownedProjects = new Set(projectIds);
	return authority.list().filter(
		(session) => {
			if (!ownedProjects.has(session.projectId)) return false;
			const activity = authority.activity.get({
				serverId: session.serverId,
				projectId: session.projectId,
				sessionId: session.id,
			});
			// Foreground-process polling is asynchronous.  The canonical reducer
			// marks the PTY working immediately on accepted/echoed input, which is
			// the safe close boundary until that poll confirms the child process.
			return activity?.foregroundBusy === true || activity?.status === 'working';
		},
	).length;
}

function getOpenProjectWindowCount(): number {
	let count = 0;
	for (const window of appWindows) {
		if (!window.isDestroyed()) count += 1;
	}
	return count;
}
const fileBufferService = new FileBufferService(() => app.getPath('home'));
const fileWatchService = new FileWatchService(fileBufferService);
const gitDiffService = new GitDiffService(fileBufferService);
const aiTabMetadataService = new AiTabMetadataService(app.getPath('home'));
const parakeetRuntime = new ParakeetRuntime({
	rootDirectory: path.join(app.getPath('userData'), 'dictation', 'parakeet'),
});
warmAiTabMetadataProviderEnv();
let cachedAppUpdateStatus: AppUpdateStatus | null = null;
let appUpdateFetchPromise: Promise<AppUpdateStatus> | null = null;

const recordingService = new TerminalRecordingService({
	getHomePath: () => app.getPath('home'),
	getLibraryIndexPath: () =>
		path.join(app.getPath('userData'), 'recording-roots.json'),
	getSettings: () => readTerminalSettings(),
	onStateChanged: () => undefined,
});

function handleServerTerminalEvent(event: TerminalEvent): void {
	if (event.type === 'output') {
		const data = new TextDecoder().decode(event.bytes);
		if (!privilegedWebRtcSessions.has(event.sessionId)) {
			privilegedWebRtcSessions.add(event.sessionId);
			privilegedWebRtcExposure?.service.ensureSession(event.sessionId);
		}
		privilegedWebRtcExposure?.service.appendSessionData(event.sessionId, data);
		try {
			recordingService.appendOutput(event.sessionId, data);
		} catch {
			/* recording is optional */
		}
		return;
	}

	if (event.type === 'exit') {
		privilegedWebRtcSessions.delete(event.sessionId);
		privilegedWebRtcExposure?.service.markSessionExit(
			event.sessionId,
			event.exitCode,
			event.signal,
		);
		removeControlToken(event.sessionId);
		recordingService.finalize(event.sessionId, event.exitCode, event.signal);
	}
}

const serverRecordingService = new RecordingService({
	serverId: 'desktop-local',
	recordingRoot: path.join(app.getPath('userData'), 'server-recordings'),
	homeDirectory: app.getPath('home'),
	libraryIndexPath: path.join(
		app.getPath('userData'),
		'server-recording-roots.v1.json',
	),
});
const serverRecordingAdapter = new ServerRecordingAdapter(
	serverRecordingService,
	{
		serverId: 'desktop-local',
		resolveSessionProject: (sessionId) =>
			serverTerminalAuthority?.service
				.listSessions()
				.find((session) => session.sessionId === sessionId)?.projectId,
	},
);

const embeddedServerSettingsPath = path.join(
	app.getPath('userData'),
	'server-settings.v1.json',
);
const embeddedServerSettings = new ServerSettingsRepository({
	load: async () => {
		try {
			return JSON.parse(
				await readFile(embeddedServerSettingsPath, 'utf8'),
			) as unknown;
		} catch (error) {
			if ((error as { code?: string }).code === 'ENOENT')
				return readTerminalSettings();
			throw error;
		}
	},
	backup: async (source) => {
		const backupPath = `${embeddedServerSettingsPath}.pre-migration.json`;
		await mkdir(path.dirname(backupPath), { recursive: true, mode: 0o700 });
		try {
			await writeFile(backupPath, JSON.stringify(source), {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			});
		} catch (error) {
			if ((error as { code?: string }).code !== 'EEXIST') throw error;
		}
	},
	commit: async (state) => {
		await mkdir(path.dirname(embeddedServerSettingsPath), {
			recursive: true,
			mode: 0o700,
		});
		const temporary = `${embeddedServerSettingsPath}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify(state), {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			});
			await rename(temporary, embeddedServerSettingsPath);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
	},
});

/**
 * Remote exposure is a selected-server feature. Its non-secret configuration
 * therefore comes from the embedded server repository, not the Desktop
 * device-settings projection. The pairing-PIN verifier remains local and is
 * deliberately not included in the server settings snapshot.
 */
function readEmbeddedRemoteAccessSettings(): TerminalSettings['remoteAccess'] {
	const serverSettings = embeddedServerSettings.settings as Partial<TerminalSettings>;
	return {
		...normalizeTerminalSettings({
			...defaultTerminalSettings,
			...serverSettings,
		}).remoteAccess,
		pairingPinHash: readRemotePairingPinVerifier(),
	};
}

const embeddedShellProfiles = new ShellProfileCatalogueService({
	settings: embeddedServerSettings,
	discovery: new ShellProfileDiscoveryService(
		await createNodeShellDiscoveryHost(process.env),
	),
	projectReferences: (profileId) =>
		serverTerminalAuthority === null
			? []
			: Object.values(serverTerminalAuthority.workspace.state.projects)
					.filter((project) => project.defaultShellProfileId === profileId)
					.map((project) => project.id),
});
const embeddedMacroPath = path.join(
	app.getPath('userData'),
	'server-macros.v1.json',
);
const embeddedMacros = new MacroRepository({
	load: async () => {
		try {
			return JSON.parse(await readFile(embeddedMacroPath, 'utf8')) as unknown;
		} catch (error) {
			if ((error as { code?: string }).code === 'ENOENT')
				return { macros: readMacros() };
			throw error;
		}
	},
	commit: async (state) => {
		await mkdir(path.dirname(embeddedMacroPath), {
			recursive: true,
			mode: 0o700,
		});
		const temporary = `${embeddedMacroPath}.${randomUUID()}.tmp`;
		try {
			await writeFile(temporary, JSON.stringify(state), {
				encoding: 'utf8',
				flag: 'wx',
				mode: 0o600,
			});
			await rename(temporary, embeddedMacroPath);
		} finally {
			await rm(temporary, { force: true }).catch(() => undefined);
		}
	},
});

function embeddedMacroKeyBytes(key: string): Uint8Array {
	const value = (
		{
			Enter: '\r',
			Tab: '\t',
			Escape: '\x1b',
			Backspace: '\x7f',
			ArrowUp: '\x1b[A',
			ArrowDown: '\x1b[B',
			ArrowRight: '\x1b[C',
			ArrowLeft: '\x1b[D',
		} as Readonly<Record<string, string>>
	)[key];
	if (value === undefined) throw new Error(`Unsupported macro key: ${key}`);
	return new TextEncoder().encode(value);
}

await desktopDiagnostics.record(
	{
		component: 'local-server',
		event: 'local-server.starting',
		severity: 'info',
		source: 'local-server',
	},
	{ channel: 'lifecycle' },
);
const embeddedProjectEnvironments = new ProjectEnvironmentRepository(
	new FileProjectEnvironmentStateBackend(
		path.join(app.getPath('userData'), 'project-environments.v1.json'),
	),
	'desktop-local',
);
await embeddedProjectEnvironments.load();
const embeddedVaultAdapter = await ElectronSafeStorageVaultAdapter.open({
	repository: new FileSafeStorageVaultRepository(
		path.join(app.getPath('userData'), 'vault', 'safe-storage.v1.json'),
	),
	codec:
		desktopTestCredentialCodec === undefined
			? {
					backend: selectedSafeStorageBackend,
					decrypt: (encrypted) => safeStorage.decryptString(encrypted),
					encrypt: (plainText) => safeStorage.encryptString(plainText),
					isAvailable: () => safeStorage.isEncryptionAvailable(),
				}
			: {
					backend:
						desktopTestCredentialCodec.backend ??
						(() => 'terminay_test_ephemeral'),
					decrypt: desktopTestCredentialCodec.decrypt,
					encrypt: desktopTestCredentialCodec.encrypt,
					isAvailable: desktopTestCredentialCodec.isAvailable,
				},
});
const embeddedVault = createServerVaultComposition(embeddedVaultAdapter);
const embeddedRuntimeReady = prepareEmbeddedRuntime();

async function prepareEmbeddedRuntime(): Promise<BrowserWindow> {
await app.whenReady();
const embeddedStartupWindow = createWindow({ deferCanonicalLaunch: true });
if (embeddedStartupWindow === null) throw new Error('The embedded workspace window could not be created.');
embeddedStartupWindowForRecovery = embeddedStartupWindow;
const embeddedWorkspace = await openEmbeddedWorkspaceWithRecovery(embeddedStartupWindow);
const authority: ServerTerminalAuthority = new ServerTerminalAuthority({
	serverId: 'desktop-local',
	dataRoot: app.getPath('userData'),
	extensionHostChildEntrypoint: path.join(MAIN_DIST, 'extensionHostEntry.js'),
	vault: embeddedVault,
	parakeetRuntime,
	defaultProjectRoot: () => app.getPath('home'),
	projectEnvironmentRepository: embeddedProjectEnvironments,
	shellProfiles: embeddedShellProfiles,
	aiMetadata: aiTabMetadataService,
	saveSparseFile: (request) => fileBufferService.saveSparseFile(request),
	recordings: serverRecordingAdapter,
	settings: embeddedServerSettings,
	workspaceRepository: embeddedWorkspace,
	applicationFeatures: {
		mcpInstall: {
			getStatus: getMcpInstallStatus,
			install: (agent) => installMcpAgent(agent, getMcpServerCommand()),
			uninstall: uninstallMcpAgent,
		},
		remoteAccess: {
			getStatus: () => currentRemoteAccessStatus(),
			command: async (operation, value) => {
				switch (operation) {
					case 'pairing-pin-status': return readTerminalSettings().remoteAccess.pairingPinHash.trim().length > 0;
					case 'toggle-server': return toggleRemoteServer();
					case 'toggle-direct-listener': return toggleDirectRemoteListener();
					case 'revoke-device': return revokeRemoteDevice(value ?? '');
					case 'close-connection': return closeRemoteConnection(value ?? '');
					case 'set-pairing-address': return setRemotePairingAddress(value ?? '');
					case 'set-pairing-pin': return setRemotePairingPin(value ?? '');
					default: throw new Error('Remote access operation is unavailable.');
				}
			},
		},
	},
	remoteMcpDispatch: async (sessionId, op, params, signal) =>
		JSON.parse(
			JSON.stringify(
				await dispatchServerControlRequest(
					sessionId,
					op as ControlOp,
					params,
					signal,
				),
			),
		) as JsonValue,
	macros: {
		repository: embeddedMacros,
		environmentFor: (request, target) => {
			const terminalAuthority = authority;
			const authorization = {
				...target,
				clientId: request.context.clientId,
				scope:
					request.context.authScope === 'admin'
						? ('admin' as const)
						: ('write' as const),
			};
			return {
				target,
				write: (_candidate, bytes) =>
					terminalAuthority.service.input(target, bytes, authorization),
				key: (_candidate, key) =>
					terminalAuthority.service.input(
						target,
						embeddedMacroKeyBytes(key),
						authorization,
					),
				waitForInactivity: (_candidate, milliseconds, signal) =>
					terminalAuthority.service.waitForInactivity(target, milliseconds, {
						authorization,
						signal,
					}),
				resolveSecret: (_candidate, secretId) => {
					if (
						secretId === DICTATION_OPENAI_SECRET_ID ||
						!safeStorage.isEncryptionAvailable()
					)
						throw new Error('Macro secret is unavailable.');
					const secret = readSecrets().find(
						(candidate) => candidate.id === secretId,
					);
					if (secret === undefined)
						throw new Error('Macro secret is unavailable.');
					return new TextEncoder().encode(
						safeStorage.decryptString(
							Buffer.from(secret.encryptedValue, 'base64'),
						),
					);
				},
			};
		},
	},
	onEvent: handleServerTerminalEvent,
	onDeliveryDiagnostic: (diagnostic) => {
		if (diagnostic.phase !== 'terminal_congestion') return;
		void desktopDiagnostics.record(
			{
				component: 'local-server',
				event: 'local-server.terminal-congestion',
				fields: {
					code: diagnostic.code,
					queuedBytes: diagnostic.queuedBytes,
					queuedFrames: diagnostic.queuedFrames,
					confirmedPosition: diagnostic.confirmedPosition,
					headPosition: diagnostic.headPosition,
				},
				severity: 'warning',
				source: 'local-server-protocol',
			},
			{ channel: 'lifecycle' },
		);
	},
	// These callbacks run only after the server has accepted the operation.
	// Recording and remote bookkeeping must never be driven by renderer intent.
	onAcceptedWrite: ({ sessionId, data }) => {
		try {
			recordingService.appendInput(
				sessionId,
				typeof data === 'string' ? data : new TextDecoder().decode(data),
			);
		} catch {
			// Recording remains optional and cannot affect a committed PTY write.
		}
	},
	onAcceptedResize: ({ sessionId, cols, rows }) => {
		try {
			recordingService.appendResize(sessionId, cols, rows);
			recordingService.updateSessionMetadata(sessionId, { cols, rows });
		} catch {
			// Recording remains optional and cannot affect a committed PTY resize.
		}
	},
});
await recoverEmbeddedWorkspaceOperation(
	embeddedStartupWindow,
	() => authority.initializeWorkspace(),
);
serverTerminalAuthority = authority;
localServerUiSession = new LocalServerUiSession({
	bundleRoot: SERVER_UI_DIST,
	cacheRoot: path.join(app.getPath('userData'), 'ui-bundles'),
	serverId: authority.service.serverId,
});
remoteServerUiBundleHost = new DesktopServerBundleHost({
	cacheRoot: path.join(app.getPath('userData'), 'ui-bundles'),
	capabilities: { clipboardWrite: 1, filePicker: 1, nativeMenus: 1, nativeWindows: 1, notifications: 1, osIntegration: 1, updater: 1 },
});
const embeddedReconnectRecordsPath = path.join(
	app.getPath('userData'),
	'embedded-reconnect-grants.v1.json',
);
let embeddedReconnectRecords = readEmbeddedReconnectRecords(
	embeddedReconnectRecordsPath,
);
const persistEmbeddedReconnectRecords = (
	records: readonly RemoteReconnectGrantRecord[],
) => {
	const scopes = new Set(
		records.map((record) => `${record.serverId}\u0000${record.sessionOrigin}`),
	);
	embeddedReconnectRecords = [
		...embeddedReconnectRecords.filter(
			(record) =>
				!scopes.has(`${record.serverId}\u0000${record.sessionOrigin}`),
		),
		...records,
	];
	mkdirSync(path.dirname(embeddedReconnectRecordsPath), {
		recursive: true,
		mode: 0o700,
	});
	const temporary = `${embeddedReconnectRecordsPath}.${randomUUID()}.tmp`;
	writeFileSync(temporary, JSON.stringify(embeddedReconnectRecords), {
		encoding: 'utf8',
		mode: 0o600,
		flag: 'wx',
	});
	renameSync(temporary, embeddedReconnectRecordsPath);
};
embeddedLanExposure = new EmbeddedLanExposure({
	core: authority.composition.core,
	...(process.env.TERMINAY_TEST === '1' ? { enableTestControl: true } : {}),
	getSettings: readEmbeddedRemoteAccessSettings,
	onConnectionError: (error) => {
		void desktopDiagnostics.record(
			{
				component: 'local-server',
				event: 'local-server.connection.failed',
				message: error,
				severity: 'error',
				source: 'local-server-protocol',
			},
			{ channel: 'lifecycle' },
		);
	},
	onReconnectRecordsChanged: persistEmbeddedReconnectRecords,
	remoteDirectory: path.join(app.getPath('userData'), 'remote-access'),
	serverId: authority.service.serverId,
	serverVersion: app.getVersion(),
	uiBundleDirectory: SERVER_UI_DIST,
});
desktopRemoteExposure = new DesktopServerOwnedExposure({
	serverId: authority.service.serverId,
	sessionOrigin: readEmbeddedRemoteAccessSettings().origin,
	pairingMode: () => 'webrtc',
	initialReconnectRecords: embeddedReconnectRecords,
	lanListener: embeddedLanExposure,
	onReconnectRecordsChanged: persistEmbeddedReconnectRecords,
	...(process.env.TERMINAY_TEST === '1' &&
	process.env.TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI === '1'
		? {}
		: {
				webRtcUnavailableReason:
					'Desktop WebRTC Relay is unavailable in this build because its authenticated hosted signaling runtime is not installed.',
				signalingRegistrar: createHostedSignalingRoomRegistrar(),
				ensureWebRtcRuntimeAvailable: () => {
					throw new Error(
						'Desktop WebRTC runtime is unavailable in this build. Install a build with an approved production WebRTC runtime before enabling WebRTC Remote Access.',
					);
				},
			}),
	resolveSessionOrigin: () => {
		const settings = readEmbeddedRemoteAccessSettings();
		if (settings.pairingMode === 'lan') return settings.origin;
		const configured = settings.webRtcHostedDomain.includes('://')
			? settings.webRtcHostedDomain
			: `https://${settings.webRtcHostedDomain}`;
		const hosted = new URL(configured);
		const loopbackHostedDomain =
			hosted.hostname === 'localhost' ||
			hosted.hostname.endsWith('.localhost') ||
			hosted.hostname === '127.0.0.1' ||
			hosted.hostname === '[::1]';
		// Loopback development hosts are the sole HTTP exception. Normalized
		// settings intentionally store only the hosted authority, so derive the
		// transport from the parsed hostname rather than from a stripped scheme.
		hosted.protocol = loopbackHostedDomain ? 'http:' : 'https:';
		hosted.hostname = `${randomUUID().replace(/-/g, '')}.${hosted.hostname}`;
		hosted.pathname = '/';
		hosted.search = '';
		hosted.hash = '';
		return hosted.toString();
	},
});
desktopDirectNetworkExposure = new DesktopServerOwnedExposure({
	serverId: authority.service.serverId,
	sessionOrigin: readTerminalSettings().remoteAccess.origin,
	pairingMode: () => 'lan',
	initialReconnectRecords: embeddedReconnectRecords,
	lanListener: embeddedLanExposure,
	onReconnectRecordsChanged: persistEmbeddedReconnectRecords,
});

const desktopWebRtcRuntimeRoot = resolveDesktopWebRtcRuntimeRoot({
	isPackaged: app.isPackaged,
	resourcesPath: process.resourcesPath,
	environment: process.env,
});
if (desktopWebRtcRuntimeRoot !== undefined) {
	privilegedWebRtcExposure = new PrivilegedWebRtcExposure(
		desktopWebRtcRuntimeRoot,
		{
			serverId: authority.service.serverId,
			serverVersion: app.getVersion(),
			acceptApplicationTransport: (transport, authenticatedClient) => {
				if (serverTerminalAuthority === null) {
					throw new Error('The embedded server is unavailable.');
				}
				return serverTerminalAuthority.composition.core.accept(transport, {
					authenticatedClient,
				});
			},
			getControllableSession: (sessionId) => {
				const authority = serverTerminalAuthority;
				const session = authority?.get(sessionId);
				if (
					authority === null ||
					authority === undefined ||
					session === undefined
				)
					return null;
				return {
					close: () => authority.kill(sessionId),
					resize: (cols, rows) => authority.resize(sessionId, { cols, rows }),
					write: (data) => authority.write(sessionId, data),
				};
			},
			getRemoteAccessSettings: readEmbeddedRemoteAccessSettings,
			notifyTerminalRemoteSizeOverride: () => undefined,
			onStatusChanged: () => undefined,
			// Direct-browser/WebRTC exposure serves the identical generated server
			// workspace artifact used by Local Desktop.  `dist` only contains the
			// host shell and must never become a second workspace release line.
			publicDir: SERVER_UI_DIST,
			rendererDistDir: SERVER_UI_DIST,
			saveGeneratedTlsPaths: () => undefined,
			userDataPath: app.getPath('userData'),
		},
	);
}
	return embeddedStartupWindow;
}

function readEmbeddedReconnectRecords(
	file: string,
): readonly RemoteReconnectGrantRecord[] {
	try {
		const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
		return Array.isArray(value) && value.every(isEmbeddedReconnectRecord)
			? value
			: [];
	} catch (error) {
		if ((error as { code?: unknown }).code === 'ENOENT') return [];
		console.error('[remote] unable to read embedded reconnect records', error);
		return [];
	}
}

function isEmbeddedReconnectRecord(
	value: unknown,
): value is RemoteReconnectGrantRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const record = value as Record<string, unknown>;
	const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
	const token = /^[A-Za-z0-9_-]{16,512}$/u;
	return (
		typeof record.id === 'string' &&
		id.test(record.id) &&
		typeof record.deviceId === 'string' &&
		id.test(record.deviceId) &&
		typeof record.serverId === 'string' &&
		id.test(record.serverId) &&
		typeof record.handle === 'string' &&
		token.test(record.handle) &&
		typeof record.sessionOrigin === 'string' &&
		typeof record.grantHash === 'string' &&
		token.test(record.grantHash) &&
		typeof record.proofVerifier === 'string' &&
		token.test(record.proofVerifier) &&
		Number.isSafeInteger(record.issuedAt) &&
		(record.expiresAt === null || Number.isSafeInteger(record.expiresAt)) &&
		(record.lastUsedAt === null || Number.isSafeInteger(record.lastUsedAt)) &&
		(record.revokedAt === null || Number.isSafeInteger(record.revokedAt))
	);
}

async function createServerOwnedTerminalSession(
	webContentsId: number,
	projectId: string,
	cwd?: string,
	projectRootOrigin?: 'explicit' | 'server-default',
	activePanelId?: string,
): Promise<Awaited<ReturnType<ServerTerminalAuthority['create']>>> {
	const id = randomUUID();
	const settings = readTerminalSettings();
	let controlEnv: { socketPath: string; token: string } | undefined;
	if (settings.terminayMcp.enabled) {
		// The capability must exist before spawning the shell, while the
		// authority session is only published by create() below. Bind the known
		// requested project explicitly so resolution still fails closed later.
		const token = registerControlToken(id, webContentsId, projectId);
		controlEnv = { socketPath: getControlSocketPath(), token };
	}
	try {
		const session = await serverTerminalAuthority!.create({
			sessionId: id,
			projectId,
			...(cwd === undefined ? {} : { cwd }),
			...(projectRootOrigin === undefined ? {} : { projectRootOrigin }),
			...(activePanelId === undefined ? {} : { activePanelId }),
			env: getTerminalSpawnEnv(controlEnv),
			cols: 80,
			rows: 24,
		});
		if (settings.recording.recordNewTerminals) {
			try {
				recordingService.start(id, {
					cwd: session.cwd,
					shell: session.shellPath ?? 'System default',
				});
			} catch {
				// Recording storage failure never prevents the PTY from starting.
			}
		}
		return session;
	} catch (error) {
		removeControlToken(id);
		recordingService.finalize(id, null, null, 'failed');
		throw error;
	}
}

function serverTerminalRendererListener(
	rendererId: number,
):
	| ((
			event: import('./serverTerminalAuthority').ServerTerminalRendererEvent,
	  ) => void)
	| null {
	const target = webContents.fromId(rendererId);
	if (!target || target.isDestroyed()) return null;
	return (event) => {
		if (target.isDestroyed()) return;
		try {
			if (event.type === 'output') {
				target.send('terminal:data', { id: event.id, data: event.data ?? '' });
			} else if (event.type === 'exit') {
				target.send('terminal:exit', {
					id: event.id,
					exitCode: event.exitCode ?? 0,
					signal: event.signal ?? null,
				});
			}
		} catch {
			// Window is shutting down; the subscription is detached by destroyed.
		}
	};
}

function attachServerTerminalRenderer(
	sessionId: string,
	rendererId: number,
	fromPosition = 0,
): void {
	if (!serverTerminalAuthority) return;
	const listener = serverTerminalRendererListener(rendererId);
	if (!listener) return;
	serverTerminalAuthority.attachRenderer(
		sessionId,
		rendererId,
		listener,
		fromPosition,
	);
}

function normalizeVersion(value: string): string | null {
	const match = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/.exec(
		value.trim(),
	);
	if (!match?.groups) {
		return null;
	}

	return `${match.groups.major}.${match.groups.minor}.${match.groups.patch}`;
}

function compareVersions(left: string, right: string): number {
	const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
	const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));

	for (
		let index = 0;
		index < Math.max(leftParts.length, rightParts.length);
		index += 1
	) {
		const leftPart = leftParts[index] ?? 0;
		const rightPart = rightParts[index] ?? 0;
		if (leftPart !== rightPart) {
			return leftPart - rightPart;
		}
	}

	return 0;
}

async function fetchAppUpdateStatus(): Promise<AppUpdateStatus> {
	const currentVersion = normalizeVersion(app.getVersion()) ?? '0.0.0';

	if (currentVersion === '0.0.0') {
		return {
			checkedAt: new Date().toISOString(),
			currentVersion,
			errorMessage: null,
			hasUpdate: false,
			latestVersion: null,
			releaseUrl: null,
		};
	}

	try {
		const response = await fetch(RELEASES_LATEST_URL, {
			headers: {
				Accept: 'text/html',
				'User-Agent': `Terminay/${currentVersion}`,
			},
			redirect: 'follow',
		});

		if (!response.ok) {
			throw new Error(`GitHub responded with ${response.status}`);
		}

		const releaseUrl = response.url;
		const latestTag =
			releaseUrl.match(/\/tag\/(v?\d+\.\d+\.\d+)\/?$/)?.[1] ?? null;
		const latestVersion = latestTag ? normalizeVersion(latestTag) : null;

		if (!latestVersion) {
			throw new Error(
				'Could not determine the latest version from the GitHub release URL.',
			);
		}

		return {
			checkedAt: new Date().toISOString(),
			currentVersion,
			errorMessage: null,
			hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
			latestVersion,
			releaseUrl,
		};
	} catch (error) {
		return {
			checkedAt: new Date().toISOString(),
			currentVersion,
			errorMessage:
				error instanceof Error ? error.message : 'Unable to check for updates.',
			hasUpdate: false,
			latestVersion: null,
			releaseUrl: null,
		};
	}
}

async function getAppUpdateStatus(options?: {
	force?: boolean;
}): Promise<AppUpdateStatus> {
	const force = options?.force === true;
	const checkedAtMs = cachedAppUpdateStatus?.checkedAt
		? Date.parse(cachedAppUpdateStatus.checkedAt)
		: Number.NaN;
	const isCachedValueFresh =
		cachedAppUpdateStatus !== null &&
		Number.isFinite(checkedAtMs) &&
		Date.now() - checkedAtMs < UPDATE_CHECK_INTERVAL_MS;

	if (!force && isCachedValueFresh && cachedAppUpdateStatus) {
		return cachedAppUpdateStatus;
	}

	if (!appUpdateFetchPromise) {
		appUpdateFetchPromise = fetchAppUpdateStatus()
			.then((status) => {
				cachedAppUpdateStatus = status;
				return status;
			})
			.finally(() => {
				appUpdateFetchPromise = null;
			});
	}

	return appUpdateFetchPromise;
}

function getTerminalSettingsPath(): string {
	return path.join(app.getPath('userData'), 'terminal-settings.json');
}

function getRemotePairingPinVerifierPath(): string {
	return path.join(app.getPath('userData'), 'remote-pairing-pin-verifier');
}

function getRemoteAccessSettingsPath(): string {
	return path.join(app.getPath('userData'), 'remote-access-settings.json');
}

function readRemotePairingPinVerifier(): string {
	try {
		const verifier = readFileSync(getRemotePairingPinVerifierPath(), 'utf8').trim();
		return /^scrypt-v1:[A-Za-z0-9_-]{8,}:[A-Za-z0-9_-]{32,}$/u.test(verifier)
			? verifier
			: '';
	} catch {
		return '';
	}
}

function writeRemotePairingPinVerifier(verifier: string): void {
	const verifierPath = getRemotePairingPinVerifierPath();
	mkdirSync(path.dirname(verifierPath), { recursive: true });
	writeFileSync(verifierPath, `${verifier}\n`, { mode: 0o600 });
}

function readRemoteAccessSettings(): TerminalSettings['remoteAccess'] {
	let candidate: unknown;
	try {
		candidate = JSON.parse(readFileSync(getRemoteAccessSettingsPath(), 'utf8'));
	} catch {
		try {
			const legacy = JSON.parse(readFileSync(getTerminalSettingsPath(), 'utf8')) as {
				remoteAccess?: unknown;
			};
			candidate = legacy.remoteAccess;
		} catch {
			candidate = undefined;
		}
	}
	return normalizeTerminalSettings({
		...defaultTerminalSettings,
		remoteAccess: candidate,
	}).remoteAccess;
}

function writeRemoteAccessSettings(
	settings: TerminalSettings['remoteAccess'],
): void {
	const settingsPath = getRemoteAccessSettingsPath();
	const { pairingPinHash: _pairingPinHash, ...nonSecretSettings } = settings;
	mkdirSync(path.dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(nonSecretSettings, null, 2), {
		mode: 0o600,
	});
}

function getMacrosPath(): string {
	return path.join(app.getPath('userData'), 'macros.json');
}

function getSecretsPath(): string {
	return path.join(app.getPath('userData'), 'secrets.json');
}

function readTerminalSettings(): TerminalSettings {
	const settingsPath = getTerminalSettingsPath();
	const remoteAccess = {
		...readRemoteAccessSettings(),
		pairingPinHash: readRemotePairingPinVerifier(),
	};

	try {
		if (!existsSync(settingsPath)) {
			return {
				...defaultTerminalSettings,
				remoteAccess,
			};
		}

		const fileContents = readFileSync(settingsPath, 'utf8');
		const settings = normalizeTerminalSettings(JSON.parse(fileContents));
		return {
			...settings,
			remoteAccess,
		};
	} catch {
		return {
			...defaultTerminalSettings,
			remoteAccess,
		};
	}
}

function writeTerminalSettings(settings: TerminalSettings): TerminalSettings {
	const normalized = normalizeTerminalSettings(settings);
	const settingsPath = getTerminalSettingsPath();
	writeRemoteAccessSettings(normalized.remoteAccess);

	mkdirSync(path.dirname(settingsPath), { recursive: true });
	writeFileSync(
		settingsPath,
		JSON.stringify(selectDeviceTerminalSettings(normalized), null, 2),
	);
	return normalized;
}

function sendDeviceTerminalSettings(webContents: Electron.WebContents): void {
	if (webContents.isDestroyed()) return;
	webContents.send('server-ui-host:event', {
		type: 'device.settings.changed',
		settings: selectDeviceTerminalSettings(readTerminalSettings()),
	});
}

function broadcastDeviceTerminalSettings(): void {
	for (const window of BrowserWindow.getAllWindows()) {
		sendDeviceTerminalSettings(window.webContents);
	}
}

function readMacros(): MacroDefinition[] {
	const macrosPath = getMacrosPath();

	try {
		if (!existsSync(macrosPath)) {
			return defaultMacros;
		}

		const fileContents = readFileSync(macrosPath, 'utf8');
		return normalizeMacros(JSON.parse(fileContents));
	} catch {
		return defaultMacros;
	}
}

type SecretRecord = {
	id: string;
	name: string;
	encryptedValue: string;
};

function readSecrets(): SecretRecord[] {
	const secretsPath = getSecretsPath();
	try {
		if (!existsSync(secretsPath)) {
			return [];
		}
		const content = readFileSync(secretsPath, 'utf8');
		return JSON.parse(content);
	} catch {
		return [];
	}
}

function writeSecrets(secrets: SecretRecord[]): void {
	mkdirSync(path.dirname(getSecretsPath()), { recursive: true });
	writeFileSync(getSecretsPath(), JSON.stringify(secrets, null, 2));
}

function ensureNodePtySpawnHelperIsExecutable(): void {
	if (process.platform === 'win32') {
		return;
	}

	const nodePtyRoot = path.join(process.cwd(), 'node_modules', 'node-pty');
	const helperPaths = [
		path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
		path.join(nodePtyRoot, 'build', 'Debug', 'spawn-helper'),
		path.join(
			nodePtyRoot,
			'prebuilds',
			`${process.platform}-${process.arch}`,
			'spawn-helper',
		),
	];

	for (const helperPath of helperPaths) {
		if (!existsSync(helperPath)) {
			continue;
		}

		try {
			chmodSync(helperPath, 0o755);
		} catch {
			// If chmod fails we continue and let the normal spawn error surface.
		}
	}
}

function getTerminalSpawnEnv(controlEnv?: {
	socketPath: string;
	token: string;
}): Record<string, string | undefined> {
	// The canonical resolver already starts from the host environment and then
	// applies the selected profile. Keep this overlay to server-protected,
	// per-session values so it cannot accidentally overwrite profile variables.
	const env: Record<string, string | undefined> = {};

	// xterm.js renders true color, but many CLI tools only enable 24-bit output
	// when COLORTERM explicitly advertises it.
	env.COLORTERM = 'truecolor';

	// Inject the per-terminal MCP control socket + capability token so an agent
	// running in this shell (and its `terminay mcp` child) can control siblings.
	if (controlEnv) {
		env[CONTROL_SOCKET_ENV] = controlEnv.socketPath;
		env[CONTROL_TOKEN_ENV] = controlEnv.token;
	}
	if (process.platform !== 'darwin') {
		return env;
	}

	const utf8Locale =
		process.env.LC_ALL ||
		process.env.LC_CTYPE ||
		process.env.LANG ||
		'en_US.UTF-8';
	const normalizedLocale = utf8Locale.toUpperCase().includes('UTF-8')
		? utf8Locale
		: 'en_US.UTF-8';

	// GUI-launched macOS apps may not inherit a UTF-8 locale, which breaks non-ASCII PTY I/O like emoji.
	env.LANG = normalizedLocale;
	env.LC_CTYPE = normalizedLocale;

	return env;
}

function getControlSocketPath(): string {
	if (process.platform === 'win32') {
		return '\\\\.\\pipe\\terminay-control';
	}
	return path.join(app.getPath('userData'), CONTROL_SOCKET_FILENAME);
}

function getMcpEntryPath(): string {
	// serverMcpEntry.js is asar-unpacked because it runs under
	// ELECTRON_RUN_AS_NODE. This is the server-owned, renderer-free entry.
	const entry = path.join(MAIN_DIST, 'serverMcpEntry.js');
	return entry.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function getMcpServerCommand(): McpServerCommand {
	return {
		command: process.execPath,
		args: [getMcpEntryPath()],
		env: { ELECTRON_RUN_AS_NODE: '1' },
	};
}

function registerControlToken(
	sessionId: string,
	webContentsId: number,
	projectId?: string,
): string {
	removeControlToken(sessionId);
	const token = randomUUID();
	const resolvedProjectId =
		projectId ?? serverTerminalAuthority?.get(sessionId)?.projectId;
	controlTokensByToken.set(token, {
		token,
		sessionId,
		...(resolvedProjectId === undefined ? {} : { projectId: resolvedProjectId }),
		webContentsId,
	});
	controlTokensBySession.set(sessionId, token);
	return token;
}

function removeControlToken(sessionId: string): void {
	const token = controlTokensBySession.get(sessionId);
	if (token) {
		controlTokensByToken.delete(token);
		controlTokensBySession.delete(sessionId);
	}
}

function resolveControlScope(token: string): ControlServerScope | null {
	const record = controlTokensByToken.get(token);
	if (!record || controlTokensBySession.get(record.sessionId) !== token) {
		return null;
	}
	const session = serverTerminalAuthority?.get(record.sessionId);
	if (
		session?.status !== 'running' ||
		(record.projectId !== undefined && session.projectId !== record.projectId)
	) {
		return null;
	}
	return { sessionId: record.sessionId, webContentsId: record.webContentsId };
}

function forwardControlRequest(
	scope: ControlServerScope,
	op: ControlOp,
	params: unknown,
	context: { signal: AbortSignal },
): Promise<ControlForwardResult> {
	return dispatchServerControlRequest(
		scope.sessionId,
		op,
		params,
		context.signal,
	);
}

/** Compatibility socket requests resolve directly against Local server state. */
async function dispatchServerControlRequest(
	sessionId: string,
	op: ControlOp,
	params: unknown,
	signal: AbortSignal,
): Promise<ControlForwardResult> {
	const authority = serverTerminalAuthority;
	const caller = authority?.get(sessionId);
	if (!authority || !caller)
		return {
			ok: false,
			error: {
				code: 'invalid_token',
				message: 'The terminal capability is no longer valid.',
			},
		};
	if (signal.aborted)
		return {
			ok: false,
			error: {
				code: 'cancelled',
				message: 'The control request was cancelled.',
			},
		};
	const service = authority.service;
	const authorization = {
		serverId: service.serverId,
		projectId: caller.projectId,
		scope: 'admin' as const,
	};
	const targetId = readTerminalRef(params, sessionId);
	const target = targetId === null ? undefined : service.getSession(targetId);
	if (
		op !== 'list_terminals' &&
		op !== 'open_terminal' &&
		(target === undefined || target.projectId !== caller.projectId)
	) {
		return {
			ok: false,
			error: {
				code: 'terminal_not_found',
				message: 'No terminal matches the requested terminal in this project.',
			},
		};
	}
	try {
		switch (op) {
			case 'list_terminals':
				return {
					ok: true,
					result: {
						terminals: service
							.listSessions()
							.filter((entry) => entry.projectId === caller.projectId)
							.map((entry) => {
								const activity = authority.activity.get({
									serverId: entry.serverId,
									projectId: entry.projectId,
									sessionId: entry.sessionId,
								});
								return {
									id: entry.sessionId,
									name: entry.sessionId,
									busy: activity?.status === 'working',
									attention: activity?.attention ?? false,
									cwd: entry.cwd || null,
									lastActivityAgoMs:
										activity === undefined
											? null
											: Math.max(0, Date.now() - activity.updatedAt),
									exitCode: entry.exit?.exitCode ?? null,
									isSelf: entry.sessionId === sessionId,
								};
							}),
					},
				};
			case 'read_terminal': {
				const subscription = service.subscribe(target!, {
					authorization,
					fromPosition: target!.replayFrom,
				});
				try {
					const events = subscription.drain();
					const bytes = events.flatMap((entry) =>
						entry.type === 'output' ? [entry.bytes] : [],
					);
					const output = new TextDecoder().decode(concatTerminalBytes(bytes));
					const lines = readRecordLines(params);
					return {
						ok: true,
						result: {
							id: target!.sessionId,
							output:
								lines === null
									? output
									: output.split(/\r?\n/u).slice(-lines).join('\n'),
						},
					};
				} finally {
					subscription.close();
				}
			}
			case 'get_terminal_status':
				return {
					ok: true,
					result: {
						id: target!.sessionId,
						status: target!.status,
						exitCode: target!.exit?.exitCode ?? null,
					},
				};
			case 'write_terminal':
			case 'run_command': {
				const text = readControlText(params, op === 'run_command');
				await service.write(target!, text, authorization);
				return {
					ok: true,
					result: {
						id: target!.sessionId,
						bytes: new TextEncoder().encode(text).byteLength,
					},
				};
			}
			case 'close_terminal':
				await service.kill(target!, authorization);
				return { ok: true, result: { id: target!.sessionId, closed: true } };
			case 'open_terminal': {
				const activePanelId = Object.values(
					serverTerminalAuthority!.workspace.state.panels,
				).find(
					(panel) =>
						panel.type === 'terminal' &&
						panel.projectId === caller.projectId &&
						panel.sessionId === caller.id,
				)?.id;
				const opened = await createServerOwnedTerminalSession(
					0,
					caller.projectId,
					readOptionalControlString(params, 'cwd'),
					undefined,
					activePanelId,
				);
				return {
					ok: true,
					result: { id: opened.id, projectId: caller.projectId },
				};
			}
			default:
				return {
					ok: false,
					error: {
						code: 'unsupported_op',
						message: `control operation ${op} is unavailable without a canonical workspace view`,
					},
				};
		}
	} catch (error) {
		return {
			ok: false,
			error: {
				code: 'internal',
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

function readTerminalRef(params: unknown, fallback: string): string | null {
	if (
		params &&
		typeof params === 'object' &&
		typeof (params as { terminal?: unknown }).terminal === 'string'
	)
		return (params as { terminal: string }).terminal;
	return fallback;
}

function readOptionalControlString(
	params: unknown,
	key: string,
): string | undefined {
	if (!params || typeof params !== 'object') return undefined;
	const value = (params as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : undefined;
}

function readControlText(params: unknown, command: boolean): string {
	const value =
		readOptionalControlString(params, command ? 'command' : 'text') ?? '';
	if (command) return `\u001b[200~${value}\u001b[201~\r`;
	return (
		value +
		(params &&
		typeof params === 'object' &&
		(params as { submit?: unknown }).submit === true
			? '\r'
			: '')
	);
}

function readRecordLines(params: unknown): number | null {
	const value =
		params && typeof params === 'object'
			? (params as { lines?: unknown }).lines
			: undefined;
	return typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value > 0 &&
		value <= 10_000
		? value
		: null;
}

function concatTerminalBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(
		chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
	);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}

async function startControlServer(): Promise<void> {
	if (controlServer) {
		return;
	}

	const server = createControlServer({
		socketPath: getControlSocketPath(),
		resolveScope: resolveControlScope,
		forward: forwardControlRequest,
		onError: (error) => {
			console.error('[control] server error', error);
		},
	});
	controlServer = server;

	try {
		await server.start();
	} catch (error) {
		console.error('[control] failed to start control server', error);
		if (controlServer === server) {
			controlServer = null;
		}
	}
}

async function stopControlServer(): Promise<void> {
	const server = controlServer;
	if (!server) {
		return;
	}
	controlServer = null;
	try {
		await server.stop();
	} catch (error) {
		console.error('[control] failed to stop control server', error);
	}
}

function applyControlServerSetting(): void {
	if (readTerminalSettings().terminayMcp.enabled) {
		void startControlServer();
	} else {
		void stopControlServer();
	}
}

function detachSessionsForWebContents(webContentsId: number): void {
	// A renderer closing is a client lifecycle event, never a PTY lifecycle.
	serverTerminalAuthority?.detachRendererAll(webContentsId);
}

let isQuitting = false;
let isQuitConfirmed = false;
let quitConfirmationPending = false;

function getFirstAppWindow(): BrowserWindow | null {
	for (const window of appWindows) {
		if (!window.isDestroyed()) {
			return window;
		}
	}
	return null;
}

function sendCommandToFocusedWindow(command: AppCommand): void {
	if (isQuitting) {
		return;
	}

	const targetWindow = BrowserWindow.getFocusedWindow() ?? getFirstAppWindow();
	if (!targetWindow || targetWindow.isDestroyed()) {
		return;
	}

	targetWindow.webContents.send('server-ui-host:event', {
		type: 'menu.command',
		command,
	});
}

function isMacQuitInput(input: Electron.Input): boolean {
	return (
		process.platform === 'darwin' &&
		input.meta &&
		!input.control &&
		!input.alt &&
		!input.shift &&
		input.key.toLowerCase() === 'q'
	);
}

function bindAppShortcuts(webContents: Electron.WebContents): void {
	webContents.on('before-input-event', (event, input) => {
		if (input.type === 'keyDown' && isMacQuitInput(input)) {
			event.preventDefault();
			app.quit();
			return;
		}

		if (input.type !== 'keyDown') {
			return;
		}

		const command = findCommandForKeyboardEvent(
			{
				altKey: input.alt,
				ctrlKey: input.control,
				key: input.key,
				metaKey: input.meta,
				shiftKey: input.shift,
			},
			readTerminalSettings().keyboardShortcuts,
			process.platform === 'darwin',
		);

		if (!command) {
			return;
		}

		event.preventDefault();
		webContents.send('server-ui-host:event', {
			type: 'menu.command',
			command,
		});
	});
}

function getMenuShortcut(
	settings: TerminalSettings,
	command: AppCommand,
): string | undefined {
	const shortcut = getCommandShortcut(settings.keyboardShortcuts, command);
	if (isReservedSystemAccelerator(shortcut, process.platform === 'darwin')) {
		return undefined;
	}

	return shortcut.length > 0 ? shortcut : undefined;
}

function shouldAutoHideMenuBar(): boolean {
	return process.platform !== 'linux';
}

function sendCopyRequestToFocusedWindow(
	browserWindow?: Electron.BaseWindow,
): void {
	const target =
		browserWindow instanceof BrowserWindow
			? browserWindow
			: BrowserWindow.getFocusedWindow();
	target?.webContents.copy();
	target?.webContents.send('terminal:copy-requested');
}

function createAppMenu(
	settings: TerminalSettings = readTerminalSettings(),
): void {
	const template: Electron.MenuItemConstructorOptions[] = [
		...(process.platform === 'darwin'
			? [
					{
						label: 'Terminay',
						submenu: [
							{ role: 'about' },
							{ type: 'separator' },
							{ role: 'services' },
							{ type: 'separator' },
							{ role: 'hide' },
							{ role: 'hideOthers' },
							{ role: 'unhide' },
							{ type: 'separator' },
							{ role: 'quit' },
						],
					} satisfies Electron.MenuItemConstructorOptions,
				]
			: []),
		{
			label: 'File',
			submenu: [
				{
					label: 'Create a new terminal tab',
					accelerator: getMenuShortcut(settings, 'new-terminal'),
					click: () => sendCommandToFocusedWindow('new-terminal'),
				},
				{
					label: 'Create a new project',
					accelerator: getMenuShortcut(settings, 'new-project'),
					click: () => sendCommandToFocusedWindow('new-project'),
				},
				{
					label: 'Project Environments…',
					click: () => sendCommandToFocusedWindow('open-project-environments'),
				},
				{
					label: 'Extensions…',
					click: () => sendCommandToFocusedWindow('open-extensions'),
				},
				{
					type: 'separator',
				},
				{
					label: 'Save',
					accelerator: getMenuShortcut(settings, 'save-active'),
					click: () => sendCommandToFocusedWindow('save-active'),
				},
				{
					type: 'separator',
				},
				{
					label: 'Settings',
					accelerator: 'CmdOrCtrl+,',
					click: () => sendCommandToFocusedWindow('open-settings'),
				},
				{
					label: 'Macros',
					accelerator: 'CmdOrCtrl+;',
					click: () => sendCommandToFocusedWindow('open-macros'),
				},
				{
					label: 'Recordings',
					accelerator: getMenuShortcut(settings, 'open-recordings'),
					click: () => sendCommandToFocusedWindow('open-recordings'),
				},
				{
					type: 'separator',
				},
				{
					label: 'Close Terminal',
					accelerator: getMenuShortcut(settings, 'close-active'),
					click: () => sendCommandToFocusedWindow('close-active'),
				},
			],
		},
		{
			label: 'Terminal',
			submenu: [
				{
					label: 'Split Horizontally',
					accelerator: getMenuShortcut(settings, 'split-horizontal'),
					click: () => sendCommandToFocusedWindow('split-horizontal'),
				},
				{
					label: 'Split Vertically',
					accelerator: getMenuShortcut(settings, 'split-vertical'),
					click: () => sendCommandToFocusedWindow('split-vertical'),
				},
				{
					label: 'Pop Out Active Terminal',
					accelerator: getMenuShortcut(settings, 'popout-active'),
					click: () => sendCommandToFocusedWindow('popout-active'),
				},
				{
					label: 'Open Command Bar',
					accelerator: getMenuShortcut(settings, 'open-command-bar'),
					click: () => sendCommandToFocusedWindow('open-command-bar'),
				},
				{
					label: 'Start Dictation',
					accelerator: getMenuShortcut(settings, 'start-dictation'),
					click: () => sendCommandToFocusedWindow('start-dictation'),
				},
				{
					label: 'Clear Terminal',
					accelerator: getMenuShortcut(settings, 'clear-terminal'),
					click: () => sendCommandToFocusedWindow('clear-terminal'),
				},
			],
		},
		{
			label: 'Edit',
			submenu: [
				{ role: 'undo' },
				{ role: 'redo' },
				{ type: 'separator' },
				{ role: 'cut' },
				{
					label: 'Copy',
					accelerator:
						process.platform === 'darwin' ? 'CmdOrCtrl+C' : 'CmdOrCtrl+Shift+C',
					click: (_menuItem, browserWindow) =>
						sendCopyRequestToFocusedWindow(browserWindow ?? undefined),
				},
				{ role: 'paste' },
				{ role: 'selectAll' },
			],
		},
		{
			label: 'View',
			submenu: [
				{
					label: 'Reset Zoom',
					accelerator: 'CmdOrCtrl+0',
					click: () => resetZoom(),
				},
				{
					label: 'Zoom In',
					accelerator: 'CmdOrCtrl+=',
					click: () => zoomIn(),
				},
				{
					label: 'Zoom Out',
					accelerator: 'CmdOrCtrl+-',
					click: () => zoomOut(),
				},
				{ type: 'separator' },
				{
					label: 'Set Project Root to Working Directory',
					accelerator: getMenuShortcut(
						settings,
						'set-project-root-folder-to-working-directory',
					),
					click: () =>
						sendCommandToFocusedWindow(
							'set-project-root-folder-to-working-directory',
						),
				},
				{
					label: 'Toggle File Explorer Sidebar',
					accelerator: getMenuShortcut(
						settings,
						'toggle-file-explorer-sidebar',
					),
					click: () =>
						sendCommandToFocusedWindow('toggle-file-explorer-sidebar'),
				},
				{
					label: 'Force Reload',
					click: (_menuItem, browserWindow) => {
						if (browserWindow instanceof BrowserWindow) {
							browserWindow.webContents.reloadIgnoringCache();
						}
					},
				},
				{ role: 'toggleDevTools' },
			],
		},
		// Standard multi-window menu (Minimise, Zoom, Bring All to Front, window
		// list / cycling). macOS injects its own extras (Fill, Centre, etc.).
		{ role: 'windowMenu' },
		{
			label: 'Help',
			submenu: createDiagnosticsHelpMenuItems({
				directory: desktopDiagnostics.directory,
				clearManagedArtifacts: () => desktopDiagnostics.clearManagedArtifacts(),
				recordCleared: () => desktopDiagnostics.recordCleared(),
				reportFailure: (operation, error) => {
					void desktopDiagnostics.record(
						{
							component: 'diagnostics',
							event: 'diagnostics.writer.degraded',
							fields: { operation },
							message: error,
							severity: 'warning',
							source: 'diagnostics-menu',
						},
						{ channel: 'lifecycle' },
					);
				},
			}),
		},
	];

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

const AUXILIARY_TITLES: Readonly<Record<string, string>> = Object.freeze({
	macros: 'Macros',
	'project-environments': 'Project Environments',
	recordings: 'Recordings',
	settings: 'Settings',
});

function canonicalAuxiliaryRequest(
	action: Extract<TerminayHostActionRequest['action'], { type: 'route.present' }>,
): Readonly<{ logicalViewId: string; route: string; title: string }> {
	if (
		action.disposition !== 'native-window' ||
		action.logicalViewId === undefined
	) {
		throw new Error(
			'Desktop auxiliary routes require a logical native-window identity.',
		);
	}
	const requested = new URL(action.route, 'https://terminay.invalid');
	const kind = requested.searchParams.get('auxiliary');
	if (
		requested.pathname !== '/' ||
		kind === null ||
		AUXILIARY_TITLES[kind] === undefined ||
		action.logicalViewId !== kind
	) {
		throw new Error('The requested Desktop auxiliary route is unavailable.');
	}
	return Object.freeze({
		logicalViewId: action.logicalViewId,
		route: `${requested.pathname}${requested.search}`,
		title: AUXILIARY_TITLES[kind],
	});
}

async function presentCanonicalAuxiliaryRoute(
	sourceWindow: BrowserWindow,
	request: TerminayHostActionRequest,
	context: TerminayHostContext,
): Promise<void> {
	if (request.action.type !== 'route.present') return;
	const workspaceRoute = new URL(request.action.route, 'https://terminay.invalid');
	const workspaceViewId = workspaceRoute.searchParams.get('view');
	if (
		request.action.disposition === 'native-window' &&
		workspaceRoute.pathname === '/' &&
		workspaceViewId !== null &&
		request.action.logicalViewId === `workspace:${workspaceViewId}` &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(workspaceViewId)
	) {
		const x = Number(workspaceRoute.searchParams.get('x'));
		const y = Number(workspaceRoute.searchParams.get('y'));
		if (!Number.isFinite(x) || !Number.isFinite(y))
			throw new Error('The workspace window position is invalid.');
		const presentationId = `${context.profileId}:workspace:${workspaceViewId}`;
		const existing = auxiliaryWindowsByPresentation.get(presentationId);
		if (existing !== undefined && !existing.isDestroyed()) {
			existing.show();
			existing.focus();
			return;
		}
		let workspaceWindow: BrowserWindow | null;
		if (context.profileId === LocalServerUiSession.profileId) {
			workspaceWindow = createWindow({
				bounds: { x, y },
				workspaceViewId,
			});
		} else {
			const profile = rememberedRemoteConnections.get(context.profileId);
			if (profile === undefined)
				throw new Error('The selected remote profile is no longer available.');
			const connected = await createDesktopReconnectTransport({
				origin: profile.origin,
				store: createDesktopDeviceCredentialStore(),
			});
			try {
				if (connected.signalingBootstrap === undefined) {
					const launch = await prepareCanonicalHttpRemoteLaunch(profile.origin, profile);
					workspaceWindow = createWindow({
						bounds: { x, y }, workspaceViewId,
						serverUiLaunch: launch, serverUiTransport: connected.transport,
					});
				} else {
					const webRtc = await createDesktopBootstrappedWebRtcConnection({
						bootstrap: connected.signalingBootstrap,
						expectedOrigin: profile.origin,
					});
					await connected.transport.close({ code: 'normal' });
					const launch = await remoteServerUiBundleHost.prepareRemote({
						lane: webRtc.assets, origin: profile.origin, profileId: profile.id,
						serverId: webRtc.serverId, windowId: `window-${randomUUID()}`,
					});
					workspaceWindow = createWindow({
						bounds: { x, y }, workspaceViewId,
						serverUiLaunch: launch, serverUiTransport: webRtc.transport,
					});
				}
			} catch (error) {
				await connected.transport.close({ code: 'normal' });
				throw error;
			}
			if (workspaceWindow !== null) {
				remoteProfileBindingsByWebContents.set(workspaceWindow.webContents.id, profile.id);
			}
		}
		if (workspaceWindow === null) throw new Error('Desktop is closing.');
		auxiliaryWindowsByPresentation.set(presentationId, workspaceWindow);
		// Do not let the source renderer tear down its only presentation while the
		// destination is still only a BrowserWindow shell.  A workspace move is
		// authoritative before this call, but the destination must have loaded its
		// canonical document before the source may close its view.
		try {
			await waitForCanonicalWorkspaceDocument(workspaceWindow);
		} catch (error) {
			auxiliaryWindowsByPresentation.delete(presentationId);
			if (!workspaceWindow.isDestroyed()) workspaceWindow.close();
			throw error;
		}
		workspaceWindow.once('ready-to-show', () => {
			if (!workspaceWindow.isDestroyed()) {
				workspaceWindow.show();
				workspaceWindow.focus();
			}
		});
		return;
	}
	const auxiliary = canonicalAuxiliaryRequest(request.action);
	const presentationId = `${context.profileId}:${auxiliary.logicalViewId}`;
	const existing = auxiliaryWindowsByPresentation.get(presentationId);
	if (existing !== undefined && !existing.isDestroyed()) {
		const current = new URL(existing.webContents.getURL());
		const requested = new URL(auxiliary.route, 'https://terminay.invalid');
		if (current.search !== requested.search) {
			current.search = requested.search;
			await existing.loadURL(current.toString());
		}
		if (existing.isMinimized()) existing.restore();
		existing.show();
		existing.focus();
		return;
	}
	auxiliaryWindowsByPresentation.delete(presentationId);

	let auxiliaryWindow: BrowserWindow | null;
	if (context.profileId === LocalServerUiSession.profileId) {
		auxiliaryWindow = createWindow({
			auxiliary: { ...auxiliary, presentationId },
		});
	} else {
		loadRememberedRemoteConnections();
		const profile = rememberedRemoteConnections.get(context.profileId);
		if (profile === undefined)
			throw new Error('The selected remote profile is no longer available.');
		const connected = await createDesktopReconnectTransport({
			origin: profile.origin,
			store: createDesktopDeviceCredentialStore(),
		});
		if (connected.signalingBootstrap === undefined) {
			const launch = await prepareCanonicalHttpRemoteLaunch(
				profile.origin,
				profile,
			);
			auxiliaryWindow = createWindow({
				auxiliary: { ...auxiliary, presentationId },
				serverUiLaunch: launch,
				serverUiTransport: connected.transport,
			});
		} else {
			try {
				const webRtc = await createDesktopBootstrappedWebRtcConnection({
					bootstrap: connected.signalingBootstrap,
					expectedOrigin: profile.origin,
				});
				await connected.transport.close({ code: 'normal' });
				const launch = await remoteServerUiBundleHost.prepareRemote({
					lane: webRtc.assets,
					origin: profile.origin,
					profileId: profile.id,
					serverId: webRtc.serverId,
					windowId: `window-${randomUUID()}`,
				});
				auxiliaryWindow = createWindow({
					auxiliary: { ...auxiliary, presentationId },
					serverUiLaunch: launch,
					serverUiTransport: webRtc.transport,
				});
			} catch (error) {
				await connected.transport.close({ code: 'normal' });
				throw error;
			}
		}
		if (auxiliaryWindow !== null) {
			remoteProfileBindingsByWebContents.set(
				auxiliaryWindow.webContents.id,
				profile.id,
			);
		}
	}
	if (auxiliaryWindow === null) throw new Error('Desktop is closing.');
	auxiliaryWindowsByPresentation.set(presentationId, auxiliaryWindow);
	auxiliaryWindow.setParentWindow(sourceWindow);
	auxiliaryWindow.once('ready-to-show', () => {
		if (auxiliaryWindow.isDestroyed()) return;
		auxiliaryWindow.show();
		auxiliaryWindow.focus();
	});
}

function waitForCanonicalWorkspaceDocument(window: BrowserWindow): Promise<void> {
	return new Promise((resolve, reject) => {
		// A popout's logical view is already authoritative before this call.  Do
		// not close/rebind the source window merely because the child has finished
		// parsing HTML: its server port and React workspace projection still need
		// to mount.  Waiting for the canonical root keeps the move atomic from the
		// user's point of view and prevents a blank secondary presentation.
		let settled = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeout !== undefined) clearTimeout(timeout);
			if (retry !== undefined) clearTimeout(retry);
			window.webContents.off('did-finish-load', onLoaded);
			window.webContents.off('did-fail-load', onFailed);
			window.off('closed', onClosed);
		};
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (error === undefined) resolve();
			else reject(error);
		};
		const waitForMountedRoot = () => {
			if (settled || window.isDestroyed()) return;
			const currentUrl = window.webContents.getURL();
			if (
				currentUrl.length === 0 ||
				currentUrl === 'about:blank' ||
				window.webContents.isLoadingMainFrame()
			) {
				retry = setTimeout(waitForMountedRoot, 25);
				return;
			}
			void window.webContents
				.executeJavaScript(
					'Boolean(document.querySelector("[data-terminay-app-component]"))',
				)
				.then((mounted) => {
					if (settled) return;
					if (mounted === true) settle();
					else retry = setTimeout(waitForMountedRoot, 25);
				})
				.catch(() => {
					if (!settled) retry = setTimeout(waitForMountedRoot, 25);
				});
		};
		const onLoaded = () => waitForMountedRoot();
		const onFailed = (
			_event: Electron.Event,
			errorCode: number,
			errorDescription: string,
			_validatedURL: string,
			isMainFrame: boolean,
		) => {
			if (!isMainFrame || errorCode === -3) return;
			settle(
				new Error(
					`Unable to load the canonical workspace window: ${errorDescription}.`,
				),
			);
		};
		const onClosed = () => {
			settle(new Error('The canonical workspace window closed before mounting.'));
		};
		window.webContents.on('did-finish-load', onLoaded);
		window.webContents.on('did-fail-load', onFailed);
		window.once('closed', onClosed);
		timeout = setTimeout(() => {
			settle(
				new Error('Timed out mounting the canonical workspace window.'),
			);
		}, 15_000);
		waitForMountedRoot();
	});
}

async function openEmbeddedWorkspaceWithRecovery(window: BrowserWindow): Promise<Awaited<ReturnType<typeof openCanonicalWorkspace>>> {
	const openWorkspace = () => openCanonicalWorkspace({
		backend: createEmbeddedWorkspaceStateBackend({
			filePath: path.join(app.getPath('userData'), 'workspace.v3.json'),
			testFault: embeddedWorkspacePersistenceFault(process.env),
		}),
		serverId: 'desktop-local',
		defaultProjectRoot: app.getPath('home'),
	});
	return recoverEmbeddedWorkspaceOperation(window, openWorkspace);
}

async function recoverEmbeddedWorkspaceOperation<T>(
	window: BrowserWindow,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (initialError) {
		return new Promise((resolve) => {
			const renderRecovery = async (cause: unknown): Promise<void> => {
				console.error('[workspace] canonical persistence unavailable', cause);
				await showCanonicalLaunchRecovery({
					window,
					error: new Error('Terminay could not read or update its saved workspace. Retry after checking that application storage is available.'),
					retry: async () => {
						try { resolve(await operation()); }
						catch (error) { await renderRecovery(error); }
					},
					onRecoveryState: (active) => {
						if (active) launchRecoveryWebContents.add(window.webContents.id);
						else launchRecoveryWebContents.delete(window.webContents.id);
					},
					onDiagnostic: recordCanonicalRecoveryDiagnostic,
				});
				if (!window.isDestroyed()) window.show();
			};
			void renderRecovery(initialError);
		});
	}
}

function createWindow(options?: {
	auxiliary?: Readonly<{
		presentationId: string;
		route: string;
		title: string;
	}>;
	bounds?: { x: number; y: number };
	initialServerConnection?: 'local' | 'deferred';
	deferCanonicalLaunch?: boolean;
	workspaceViewId?: string;
	serverUiLaunch?: DesktopBundleLaunch;
	serverUiTransport?: ByteTransport;
}): BrowserWindow | null {
	if (isQuitting) {
		return null;
	}

	// Normal workspace windows always execute the selected server's verified UI
	// bundle. Development changes where those bytes are built, never which
	// renderer, preload, transport, or state owner is selected.
	const preloadPath = path.join(__dirname, 'serverUiPreload.cjs');
	const isMac = process.platform === 'darwin';
	const usesOverlayTitlebar = process.platform === 'win32';
	const windowIconPath = getWindowIconPath();
	const isAuxiliary = options?.auxiliary !== undefined;

	const window = new BrowserWindow({
		icon: windowIconPath,
		width: isAuxiliary ? 1180 : 1400,
		height: isAuxiliary ? 820 : 900,
		// Place a torn-off window's title bar near the drop point, like a browser.
		x: options?.bounds ? Math.round(options.bounds.x) - 120 : undefined,
		y: options?.bounds ? Math.round(options.bounds.y) - 12 : undefined,
		title: options?.auxiliary?.title ?? 'Terminay',
		show: !isAuxiliary && options?.deferCanonicalLaunch !== true,
		// Deliver the first click on an inactive window to the web contents instead of
		// letting macOS swallow it purely to activate the window (electron/electron#212).
		// Without this, clicking a background tab focuses the window but the click never
		// reaches that tab, so keystrokes go to the previously active terminal.
		acceptFirstMouse: true,
		titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
		titleBarOverlay: usesOverlayTitlebar
			? {
					color: '#0f1823',
					symbolColor: '#9bb0c8',
					height: 38,
				}
			: false,
		trafficLightPosition: isMac
			? {
					x: 14,
					y: 12,
				}
			: undefined,
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			partition: getServerUiPartitionName(
				options?.serverUiLaunch?.partitionKey ?? localServerUiPartitionKey,
			),
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	securePrimaryWindow(window);
	if (!isAuxiliary) appWindows.add(window);
	// Capture the webContents id now; it's unreadable once the window is closed
	// (accessing window.webContents after destruction throws).
	const windowWebContentsId = window.webContents.id;
	if (!isAuxiliary) bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => isQuitting,
		getRunningTerminalCount: () =>
			getRunningTerminalCountForWindow(windowWebContentsId),
		isLastWindow: () => getOpenProjectWindowCount() <= 1,
		showConfirmation: (target, dialogOptions) =>
			dialog.showMessageBox(target as BrowserWindow, dialogOptions),
		requestQuit: () => {
			isQuitConfirmed = true;
			isQuitting = true;
			app.quit();
		},
		requestClose: () => window.close(),
		onError: (error) =>
			console.error('[window] close confirmation failed', error),
	});

	if (options?.workspaceViewId) {
		workspaceViewByWebContents.set(
			windowWebContentsId,
			options.workspaceViewId,
		);
		// A project tear-off is an explicit request to work in the destination.
		// Creating the BrowserWindow from a drag-end callback does not reliably
		// activate it on macOS, where the first click would otherwise be consumed
		// solely to focus the window instead of reaching the terminal-tab + button.
		window.once('ready-to-show', () => {
			if (window.isDestroyed()) return;
			window.show();
			window.focus();
		});
	} else if (!isAuxiliary && options?.serverUiLaunch === undefined) {
		const defaultViewId = serverTerminalAuthority?.workspace.state.viewOrder[0];
		if (defaultViewId !== undefined) {
			workspaceViewByWebContents.set(windowWebContentsId, defaultViewId);
		}
	}

	window.on('closed', () => {
		documentEndpointUnbindByWebContents.get(windowWebContentsId)?.();
		documentEndpointUnbindByWebContents.delete(windowWebContentsId);
		releaseServerUiWindowBinding(
			windowWebContentsId,
			isQuitting ? 'application-quit' : 'window-close',
		);
		releaseLocalServerUiSessionSafely(windowWebContentsId);
		appWindows.delete(window);
		workspaceViewByWebContents.delete(windowWebContentsId);
		if (options?.auxiliary !== undefined) {
			const key = options.auxiliary.presentationId;
			if (auxiliaryWindowsByPresentation.get(key) === window)
				auxiliaryWindowsByPresentation.delete(key);
		}
		remoteProfileBindingsByWebContents.delete(windowWebContentsId);
		launchRecoveryWebContents.delete(windowWebContentsId);
		deferredCanonicalLaunches.delete(windowWebContentsId);
	});

	window.on('page-title-updated', (event) => {
		event.preventDefault();
		if (!window.isDestroyed()) {
			window.setTitle('Terminay');
		}
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		const isPopout = isAppNavigation(url) && url.includes('popout.html');

		if (!isPopout) {
			void openInBrowser(url).catch((error) =>
				console.error('Failed to open external link', error),
			);
			return { action: 'deny' };
		}

		return {
			action: 'allow',
			overrideBrowserWindowOptions: {
				icon: windowIconPath,
				title: 'Terminay',
				width: 1000,
				height: 700,
				titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
				trafficLightPosition: isMac
					? {
							x: 14,
							y: 12,
						}
					: undefined,
				autoHideMenuBar: shouldAutoHideMenuBar(),
				webPreferences: {
					preload: preloadPath,
					contextIsolation: true,
					nodeIntegration: false,
					sandbox: true,
					webSecurity: true,
					webviewTag: false,
				},
			},
		};
	});

	window.webContents.on('did-create-window', (childWindow) => {
		securePrimaryWindow(childWindow);
	});

	// Startup resolves and verifies the selected server's exact UI artifact
	// before any workspace renderer executes. A successful Desktop pairing can
	// replace this window's selected server, so the same mounting transaction is
	// reusable without returning credentials to the renderer.
	let switchToPairedDesktopServer: (pairingUrl: string) => Promise<void>;
	const mountCanonicalLaunch = async (
		launch: DesktopBundleLaunch,
		transport?: ByteTransport,
	): Promise<void> => {
				if (window.isDestroyed()) return;
				documentEndpointUnbindByWebContents.get(windowWebContentsId)?.();
				documentEndpointUnbindByWebContents.delete(windowWebContentsId);
				const entryUrl = pathToFileURL(path.join(launch.assetRoot, launch.entryPath));
				if (options?.auxiliary !== undefined) {
					const requested = new URL(options.auxiliary.route, 'https://terminay.invalid');
					entryUrl.search = requested.search;
				}
				// `route.present` is a canonical application route, whose logical view
				// lives in the query string.  Preserve that route when Desktop opens a
				// second workspace presentation instead of translating it into a hash:
				// the server bundle's route shell (and not only App's workspace picker)
				// then mounts the intended view before the source presentation closes.
				if (options?.workspaceViewId) {
					entryUrl.searchParams.set('view', options.workspaceViewId);
				}
				const connectionProfiles = sanitizedDesktopConnectionProfiles(
					launch.context.profileId,
				);
				bindServerUiWindow({
					window,
					context: {
						...launch.context,
						profile: connectionProfiles.profile,
						profiles: connectionProfiles.profiles,
					},
					expectedOrigin: entryUrl.toString(),
					hostPartitionKey: launch.partitionKey,
					initialUrl: entryUrl.toString(),
					preloadPath,
					onLifecycleDiagnostic: (event) => {
						void desktopDiagnostics.record(
							{
								component: 'renderer', event: 'diagnostics.cleanup.failed',
								fields: { reason: event.reason, resource: event.resource, webContentsId: windowWebContentsId },
								message: event.message, severity: 'warning', source: 'server-ui-lifecycle',
							},
							{ channel: 'lifecycle' },
						);
					},
					onHostAction: async (request) => {
						const action = request.action;
						switch (action.type) {
						case 'connection.pair':
							await switchToPairedDesktopServer(action.pairingUrl);
							return;
						case 'clipboard.write': clipboard.writeText(action.text); return;
							case 'file.choose': {
								const result = await dialog.showOpenDialog(window, { properties: action.multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
								return result.canceled ? [] : result.filePaths;
							}
							case 'notification.show': new Notification({ title: action.title, ...(action.body === undefined ? {} : { body: action.body }) }).show(); return;
							case 'updater.check': return getAppUpdateStatus({ force: true });
							case 'os.open-external': await openInBrowser(action.url); return;
							case 'route.close': {
								const target = action.presentationId === undefined ? window : auxiliaryWindowsByPresentation.get(`${launch.context.profileId}:${action.presentationId}`);
								target?.close(); return;
							}
							case 'route.focus': auxiliaryWindowsByPresentation.get(`${launch.context.profileId}:${action.presentationId}`)?.focus(); return;
							case 'menu.invoke': sendCommandToFocusedWindow(action.command as AppCommand); return;
							case 'menu.accelerators.update': {
								const current = readTerminalSettings();
								const shortcuts = { ...current.keyboardShortcuts };
								for (const entry of action.accelerators)
									shortcuts[entry.command as AppCommand] = entry.accelerator;
								const settings = writeTerminalSettings({ ...current, keyboardShortcuts: shortcuts });
								createAppMenu(settings);
								return;
							}
							case 'device.settings.update': {
								if (
									typeof action.settings !== 'object' ||
									action.settings === null ||
									Array.isArray(action.settings)
								)
									throw new TypeError('Device settings must be an object.');
								const current = readTerminalSettings();
								const settings = writeTerminalSettings({
									...current,
									...action.settings,
								});
								createAppMenu(settings);
								broadcastDeviceTerminalSettings();
								return selectDeviceTerminalSettings(settings);
							}
							case 'route.present': await presentCanonicalAuxiliaryRoute(window, request, launch.context); return;
							case 'os.reveal': throw new Error('OS reveal requires a host-issued path token.');
							case 'workspace.drag.start':
								beginCanonicalProjectDrag(window.webContents.id, action.viewId, action.preview);
								return;
							case 'workspace.drag.end': return endCanonicalProjectDrag();
						}
					},
				});
				const endpointDiagnostic = (resource: string, message: string) => {
					void desktopDiagnostics.record(
						{
							component: 'renderer', event: 'diagnostics.cleanup.failed',
							fields: { resource, webContentsId: windowWebContentsId }, message,
							severity: 'warning', source: 'server-ui-document-endpoint',
						},
						{ channel: 'lifecycle' },
					);
				};
				const targetWebContents = window.webContents;
				if (transport !== undefined) {
					const unbindEndpoint = bindRemoteServerUiDocumentEndpoint({
						diagnostic: endpointDiagnostic,
						launch,
						reconnect: () =>
							reconnectCanonicalDesktopRemoteTransport(
								launch.context.profileId,
							),
						sender: targetWebContents,
						transport,
					});
					documentEndpointUnbindByWebContents.set(
						windowWebContentsId,
						unbindEndpoint,
					);
				} else if (serverTerminalAuthority !== null) {
					const unbindEndpoint = bindLocalServerUiDocumentEndpoint({
						acceptPort: (port) => serverTerminalAuthority?.acceptRendererPort(port as unknown as ServerMessagePort),
						diagnostic: endpointDiagnostic, handle: launch.byteEndpointHandle, sender: targetWebContents,
					});
					documentEndpointUnbindByWebContents.set(
						windowWebContentsId,
						unbindEndpoint,
					);
				}
				await window.loadURL(entryUrl.toString());
				if (options?.deferCanonicalLaunch === true && !window.isDestroyed()) window.show();
	};
	switchToPairedDesktopServer = async (pairingUrl) => {
		const profile = await enrollPairedDesktopRemoteProfile(pairingUrl);
		// Keep the profile available for transport recovery during the first load,
		// but do not serialize metadata until the verified bundle is mounted.
		const replacedProfile = rememberedRemoteConnections.get(profile.id);
		rememberedRemoteConnections.set(profile.id, profile);
		try {
			const remote = await prepareCanonicalDesktopRemoteConnection(profile);
			releaseServerUiWindowBinding(windowWebContentsId, 'server-switch');
			releaseLocalServerUiSessionSafely(windowWebContentsId);
			remoteProfileBindingsByWebContents.set(windowWebContentsId, profile.id);
			await mountCanonicalLaunch(remote.launch, remote.transport);
			rememberRemoteConnection(profile);
		} catch (error) {
			if (replacedProfile === undefined)
				rememberedRemoteConnections.delete(profile.id);
			else rememberedRemoteConnections.set(profile.id, replacedProfile);
			remoteProfileBindingsByWebContents.delete(windowWebContentsId);
			throw error;
		}
	};
	const launchCanonical = async (): Promise<void> => {
		const launch = await (options?.serverUiLaunch === undefined
			? localServerUiSession.prepare(windowWebContentsId)
			: Promise.resolve(options.serverUiLaunch));
		await mountCanonicalLaunch(launch, options?.serverUiTransport);
	};
	const launchWithRecovery = async (): Promise<void> => {
		try {
			await launchCanonical();
		} catch (error) {
			console.error('[window] canonical server UI launch failed', error);
			releaseServerUiWindowBinding(windowWebContentsId, 'failed-launch');
			releaseLocalServerUiSessionSafely(windowWebContentsId);
			await showCanonicalLaunchRecovery({
				window,
				error,
				retry: launchWithRecovery,
				onRecoveryState: (active) => {
					if (active) launchRecoveryWebContents.add(windowWebContentsId);
					else launchRecoveryWebContents.delete(windowWebContentsId);
				},
				onDiagnostic: recordCanonicalRecoveryDiagnostic,
			});
		}
	};
	if (options?.deferCanonicalLaunch === true) deferredCanonicalLaunches.set(windowWebContentsId, launchWithRecovery);
	else void launchWithRecovery();

	void getAppUpdateStatus();

	return window;
}

async function launchDeferredCanonicalWindow(window: BrowserWindow): Promise<void> {
	const launch = deferredCanonicalLaunches.get(window.webContents.id);
	if (launch === undefined) throw new Error('The embedded workspace launch was not prepared.');
	deferredCanonicalLaunches.delete(window.webContents.id);
	await launch();
}

const REMOTE_SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

async function prepareCanonicalHttpRemoteLaunch(
	origin: string,
	profile: RememberedRemoteConnection,
): Promise<DesktopBundleLaunch> {
	const bootstrapUrl = new URL('/host-bootstrap.json', origin);
	const response = await fetch(bootstrapUrl, {
		headers: { accept: 'application/json' },
		redirect: 'error',
	});
	if (!response.ok) throw new Error('The remote server host bootstrap is unavailable.');
	const bootstrap = (await response.json()) as Record<string, unknown>;
	if (
		bootstrap.schemaVersion !== 1 ||
		typeof bootstrap.serverId !== 'string' ||
		!REMOTE_SERVER_ID.test(bootstrap.serverId) ||
		bootstrap.manifestPath !== '/manifest.json' ||
		bootstrap.streamPath !== '/protocol/stream'
	) {
		throw new Error('The remote server host bootstrap is invalid.');
	}
	const manifestPath = bootstrap.manifestPath;
	const serverId = bootstrap.serverId;
	const manifestUrl = new URL(manifestPath, origin);
	const manifestResponse = await fetch(manifestUrl, { redirect: 'error' });
	// A standalone protocol server is allowed to expose no renderer artifact.
	// Desktop still has a verified, host-compatible application bundle, so bind
	// that trusted local artifact to the authenticated remote server instead of
	// abandoning the pairing after credentials have been enrolled.  Do this
	// only for a missing manifest: an advertised but malformed or unverifiable
	// remote bundle remains a hard failure.
	if (manifestResponse.status === 404 || manifestResponse.status === 503) {
		return remoteServerUiBundleHost.prepareLocal({
			artifact: { rootDirectory: SERVER_UI_DIST },
			origin,
			profileId: profile.id,
			serverId,
			windowId: `window-${randomUUID()}`,
		});
	}
	if (!manifestResponse.ok)
		throw new Error(
			`The remote UI manifest is unavailable (${manifestResponse.status}).`,
		);
	const manifest = JSON.parse(
		new TextDecoder().decode(
			new Uint8Array(await manifestResponse.arrayBuffer()),
		),
	) as unknown;
	const fetchBytes = async (pathname: string): Promise<Uint8Array> => {
		const url = new URL(pathname, origin);
		if (url.origin !== new URL(origin).origin)
			throw new Error('The remote UI asset escaped its server origin.');
		const assetResponse = await fetch(url, { redirect: 'error' });
		if (!assetResponse.ok)
			throw new Error(`The remote UI asset is unavailable (${assetResponse.status}).`);
		return new Uint8Array(await assetResponse.arrayBuffer());
	};
	const lane: DesktopAuthenticatedAssetLane = {
		manifest: async () => manifest,
		read: fetchBytes,
	};
	return remoteServerUiBundleHost.prepareRemote({
		lane,
		origin,
		profileId: profile.id,
		serverId,
		windowId: `window-${randomUUID()}`,
	});
}

/** Consume a one-time pairing URL only in Electron. The resulting profile is
 * intentionally just origin/id/label metadata; the encrypted device grant
 * stays inside DesktopDeviceCredentialStore. */
async function enrollPairedDesktopRemoteProfile(
	pairingUrl: string,
): Promise<RememberedRemoteConnection> {
	const bootstrap = parseRemoteStreamConnectionUrl(pairingUrl);
	const origin = new URL(bootstrap.origin).origin;
	loadRememberedRemoteConnections();
	const existing = [...rememberedRemoteConnections.values()].find(
		(candidate) => candidate.origin === origin,
	);
	const profile: RememberedRemoteConnection = Object.freeze({
		id: existing?.id ?? `remote:${randomUUID()}`,
		kind: 'standalone',
		label: existing?.label ?? new URL(origin).host,
		origin,
	});
	await enrollDesktopReconnectCredential({
		authToken: bootstrap.authToken,
		clientId: `desktop-${randomUUID()}`,
		deviceName: 'Terminay Desktop',
		origin,
		store: createDesktopDeviceCredentialStore(),
	});
	return profile;
}

/** Prepare one authenticated remote lane and its verified server bundle for a
 * Desktop document. This is shared by initial pairing, auxiliary windows and
 * reconnection; the renderer never sees enrollment or reconnect material. */
async function prepareCanonicalDesktopRemoteConnection(
	profile: RememberedRemoteConnection,
): Promise<Readonly<{ launch: DesktopBundleLaunch; transport: ByteTransport }>> {
	const connected = await createDesktopReconnectTransport({
		origin: profile.origin,
		store: createDesktopDeviceCredentialStore(),
	});
	if (connected.signalingBootstrap === undefined) {
		try {
			return Object.freeze({
				launch: await prepareCanonicalHttpRemoteLaunch(profile.origin, profile),
				transport: connected.transport,
			});
		} catch (error) {
			await connected.transport.close({ code: 'normal' }).catch(() => undefined);
			throw error;
		}
	}
	try {
		const webRtc = await createDesktopBootstrappedWebRtcConnection({
			bootstrap: connected.signalingBootstrap,
			expectedOrigin: profile.origin,
		});
		await connected.transport.close({ code: 'normal' });
		return Object.freeze({
			launch: await remoteServerUiBundleHost.prepareRemote({
				lane: webRtc.assets,
				origin: profile.origin,
				profileId: profile.id,
				serverId: webRtc.serverId,
				windowId: `window-${randomUUID()}`,
			}),
			transport: webRtc.transport,
		});
	} catch (error) {
		await connected.transport.close({ code: 'normal' }).catch(() => undefined);
		throw error;
	}
}

/** Reconnect a Desktop-owned remote byte lane without reloading the selected
 * server bundle.  The renderer receives a fresh document MessagePort only
 * after this authenticated transport has been established. */
async function reconnectCanonicalDesktopRemoteTransport(
	profileId: string,
): Promise<ByteTransport> {
	loadRememberedRemoteConnections();
	const profile = rememberedRemoteConnections.get(profileId);
	if (profile === undefined)
		throw new Error('The selected remote profile is no longer available.');
	const connected = await createDesktopReconnectTransport({
		origin: profile.origin,
		store: createDesktopDeviceCredentialStore(),
	});
	if (connected.signalingBootstrap === undefined) return connected.transport;
	try {
		const webRtc = await createDesktopBootstrappedWebRtcConnection({
			bootstrap: connected.signalingBootstrap,
			expectedOrigin: profile.origin,
		});
		await connected.transport.close({ code: 'normal' });
		return webRtc.transport;
	} catch (error) {
		await connected.transport.close({ code: 'normal' });
		throw error;
	}
}

function setDockIcon(): void {
	if (process.platform !== 'darwin') return;
	const iconPath =
		getBrandAssetPath('icon.icns') ?? getBrandAssetPath('terminay.png');
	if (!iconPath) return;
	const icon = nativeImage.createFromPath(iconPath);
	if (!icon.isEmpty()) app.dock?.setIcon(icon);
}

if (process.env.TERMINAY_TEST === '1') {
	ipcMain.on(
		'test:renderer-bootstrap-diagnostic',
		(event, payload: unknown) => {
			assertTrustedAppSender(event);
			if (
				typeof payload !== 'object' ||
				payload === null ||
				Array.isArray(payload)
			)
				return;
			const phase = (payload as { phase?: unknown }).phase;
			const count = (payload as { count?: unknown }).count;
			if (
				typeof phase !== 'string' ||
				phase.length === 0 ||
				phase.length > 96 ||
				(count !== undefined &&
					(!Number.isSafeInteger(count) ||
						(count as number) < 0 ||
						(count as number) > 1_000_000))
			)
				return;
			writePortDiagnostic({
				phase: 'renderer-bootstrap',
				rendererPhase: phase,
				...(count === undefined ? {} : { count }),
			});
		},
	);
}

// Orphaned renderer feature IPC was removed; canonical server authority owns these operations.
ipcMain.on('server-ui-host:subscribe-events', (event) => {
	assertBoundServerUiEvent(event);
	event.sender.send('server-ui-host:event', {
		type: 'terminal.zoom',
		zoomLevel: terminalZoomLevel,
	});
	sendDeviceTerminalSettings(event.sender);
});

// Cross-window drag tracking with Chrome-style tear-off. While a project tab is
// being dragged, framer-motion keeps it x-locked in its own bar (reorder). The
// main process polls the cursor; once the cursor is dragged past a threshold
// away from the source bar, the tab "tears off" into a floating ghost window
// that follows the cursor and magnetically snaps onto any window's tab bar. The
// outcome (reorder / merge / popout) is decided on release.
type ProjectDragPreview = {
	title: string;
	emoji: string;
	color: string;
	width: number;
};

const PROJECT_TAB_TEAR_OFF_DISTANCE = 100;
const PROJECT_TAB_BAR_HEIGHT = 48;
// Transparent padding around the ghost card so its drop shadow isn't clipped.
const GHOST_PADDING = 24;
const GHOST_HEIGHT = 56;

let projectDragPollTimer: ReturnType<typeof setInterval> | null = null;
let projectDragSourceWebContentsId: number | null = null;
let projectDragPreview: ProjectDragPreview | null = null;
let projectDragTornOff = false;
let tabGhostWindow: BrowserWindow | null = null;
let ghostWindowWidth = 0;

type ScreenRect = { x: number; y: number; width: number; height: number };

function getBarScreenRect(webContentsId: number | null): ScreenRect | null {
	if (webContentsId === null) {
		return null;
	}
	for (const window of appWindows) {
		if (window.isDestroyed() || window.isMinimized()) {
			continue;
		}
		if (window.webContents.id !== webContentsId) {
			continue;
		}
		const content = window.getContentBounds();
		return {
			x: content.x,
			y: content.y,
			width: content.width,
			height: Math.min(PROJECT_TAB_BAR_HEIGHT, content.height),
		};
	}
	return null;
}

function findAppWindowTabBarAtPoint(point: {
	x: number;
	y: number;
}): number | null {
	for (const window of appWindows) {
		if (window.isDestroyed() || window.isMinimized()) {
			continue;
		}
		const rect = getBarScreenRect(window.webContents.id);
		if (rect && pointInRect(point, rect)) {
			return window.webContents.id;
		}
	}
	return null;
}

function escapeGhostHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildTabGhostUrl(preview: ProjectDragPreview): string {
	const title = escapeGhostHtml(preview.title || 'Project');
	const emoji = escapeGhostHtml(preview.emoji);
	const color = /^#[0-9a-fA-F]{3,8}$/.test(preview.color)
		? preview.color
		: '#4db5ff';
	// Match the in-app active project tab: a project-color tint over the active
	// tab background (--tab-bg-active #0d1014), white bold label, no border.
	const badge = emoji ? `<span class="em">${emoji}</span>` : '';
	const cardWidth = Math.max(80, Math.round(preview.width));
	const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:grabbing;
      display:flex;align-items:center;justify-content:center;
      font-family:'Open Sans','Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;}
    .tab{display:flex;align-items:center;gap:8px;box-sizing:border-box;
      width:${cardWidth}px;height:30px;padding:0 12px;
      border-radius:6px;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:.01em;
      white-space:nowrap;background:color-mix(in srgb, ${color} 45%, #0d1014);
      box-shadow:0 10px 28px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35);}
    .em{font-size:14px;line-height:1;flex:none;}
    .ti{overflow:hidden;text-overflow:ellipsis;}
  </style></head><body><div class="tab">${badge}<span class="ti">${title}</span></div></body></html>`;
	return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showTabGhostWindow(preview: ProjectDragPreview): void {
	ghostWindowWidth =
		Math.max(80, Math.round(preview.width)) + GHOST_PADDING * 2;
	if (!tabGhostWindow || tabGhostWindow.isDestroyed()) {
		tabGhostWindow = new BrowserWindow({
			width: ghostWindowWidth,
			height: GHOST_HEIGHT,
			frame: false,
			transparent: true,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			focusable: false,
			skipTaskbar: true,
			hasShadow: false,
			alwaysOnTop: true,
			show: false,
			// This window displays only a generated drag preview, not application
			// content. Keep that isolation explicit so a future preview change
			// cannot accidentally inherit a privileged renderer configuration.
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
				webviewTag: false,
			},
		});
		tabGhostWindow.setIgnoreMouseEvents(true);
	}
	tabGhostWindow.setSize(ghostWindowWidth, GHOST_HEIGHT);
	tabGhostWindow.loadURL(buildTabGhostUrl(preview));
	tabGhostWindow.showInactive();
}

// Center the ghost card under the cursor.
function moveTabGhostToCursor(point: { x: number; y: number }): void {
	if (tabGhostWindow && !tabGhostWindow.isDestroyed()) {
		if (!tabGhostWindow.isVisible()) {
			tabGhostWindow.showInactive();
		}
		tabGhostWindow.setBounds({
			x: Math.round(point.x - ghostWindowWidth / 2),
			y: Math.round(point.y - GHOST_HEIGHT / 2),
			width: ghostWindowWidth,
			height: GHOST_HEIGHT,
		});
	}
}

function destroyTabGhostWindow(): void {
	if (tabGhostWindow && !tabGhostWindow.isDestroyed()) {
		tabGhostWindow.destroy();
	}
	tabGhostWindow = null;
}

function setProjectTabTornOff(tornOff: boolean): void {
	if (tornOff === projectDragTornOff) {
		return;
	}
	projectDragTornOff = tornOff;
	const source = webContents.fromId(projectDragSourceWebContentsId ?? -1);
	if (tornOff) {
		if (projectDragPreview) {
			showTabGhostWindow(projectDragPreview);
		}
		source?.send('server-ui-host:event', { type: 'workspace.drag-state', active: true });
	} else {
		destroyTabGhostWindow();
		source?.send('server-ui-host:event', { type: 'workspace.drag-state', active: false });
	}
}

function stopProjectDragTracking(): void {
	if (projectDragPollTimer) {
		clearInterval(projectDragPollTimer);
		projectDragPollTimer = null;
	}
	destroyTabGhostWindow();
	projectDragTornOff = false;
	projectDragSourceWebContentsId = null;
	projectDragPreview = null;
}

function beginCanonicalProjectDrag(
	senderId: number,
	viewId: string,
	preview: ProjectDragPreview,
): void {
	workspaceViewByWebContents.set(senderId, viewId);
	projectDragSourceWebContentsId = senderId;
	projectDragPreview = preview;
	projectDragTornOff = false;
	if (projectDragPollTimer) clearInterval(projectDragPollTimer);
	projectDragPollTimer = setInterval(() => {
		const point = screen.getCursorScreenPoint();
		const sourceBar = getBarScreenRect(projectDragSourceWebContentsId);
		if (!projectDragTornOff) {
			if (
				sourceBar &&
				distanceToRect(point, sourceBar) > PROJECT_TAB_TEAR_OFF_DISTANCE
			) setProjectTabTornOff(true);
			return;
		}
		if (sourceBar && pointInRect(point, sourceBar)) {
			setProjectTabTornOff(false);
			return;
		}
		moveTabGhostToCursor(point);
	}, 16);
}

function endCanonicalProjectDrag():
	| { action: 'reorder' }
	| { action: 'merge'; targetViewId: string }
	| { action: 'popout'; x: number; y: number } {
	const sourceId = projectDragSourceWebContentsId;
	const wasTornOff = projectDragTornOff;
	if (projectDragPollTimer) clearInterval(projectDragPollTimer);
	projectDragPollTimer = null;
	destroyTabGhostWindow();
	projectDragTornOff = false;
	projectDragSourceWebContentsId = null;
	projectDragPreview = null;
	const point = screen.getCursorScreenPoint();
	const hit = findAppWindowTabBarAtPoint(point);
	if (!wasTornOff || hit === sourceId) return { action: 'reorder' };
	if (hit !== null) {
		const targetViewId = workspaceViewByWebContents.get(hit);
		return targetViewId === undefined
			? { action: 'reorder' }
			: { action: 'merge', targetViewId };
	}
	return { action: 'popout', x: point.x, y: point.y };
}

function usesPrivilegedWebRtcExposure(): boolean {
	return privilegedWebRtcExposure !== null;
}

function currentRemoteAccessStatus(): RemoteAccessStatus {
	const webRtc = usesPrivilegedWebRtcExposure()
		? privilegedWebRtcExposure!.service.getStatus()
		: desktopRemoteExposure.getStatus();
	const direct = desktopDirectNetworkExposure.getStatus();
	return {
		...webRtc,
		directListenerRunning: direct.isRunning,
		lanPairingExpiresAt: direct.lanPairingExpiresAt,
		lanPairingQrCodeDataUrl: direct.lanPairingQrCodeDataUrl,
		lanPairingQrCodePath: direct.lanPairingQrCodePath,
		lanPairingUrl: direct.lanPairingUrl,
		availableAddresses: direct.availableAddresses,
	};
}

async function toggleRemoteServer(): Promise<RemoteAccessStatus> {
	let status: RemoteAccessStatus;
	if (usesPrivilegedWebRtcExposure()) {
		for (const session of serverTerminalAuthority?.list() ?? []) {
			if (!privilegedWebRtcSessions.has(session.id)) {
				privilegedWebRtcSessions.add(session.id);
				privilegedWebRtcExposure!.service.ensureSession(session.id);
			}
			const dimensions = serverTerminalAuthority?.service.getSession(session.id)?.dimensions;
			if (dimensions !== undefined) {
				privilegedWebRtcExposure!.service.updateSessionSize(
					session.id,
					dimensions.cols,
					dimensions.rows,
				);
			}
		}
		status = await privilegedWebRtcExposure!.toggle();
	} else {
		status = await desktopRemoteExposure.toggle();
	}
	return status;
}

async function toggleDirectRemoteListener(): Promise<RemoteAccessStatus> {
	await desktopDirectNetworkExposure.toggle();
	return currentRemoteAccessStatus();
}

async function revokeRemoteDevice(deviceId: string): Promise<RemoteAccessStatus> {
	return usesPrivilegedWebRtcExposure()
		? privilegedWebRtcExposure!.service.revokeDevice(deviceId)
		: desktopRemoteExposure.revokeDevice(deviceId);
}

async function closeRemoteConnection(connectionId: string): Promise<RemoteAccessStatus> {
	return usesPrivilegedWebRtcExposure()
		? privilegedWebRtcExposure!.service.closeConnection(connectionId)
		: desktopRemoteExposure.closeConnection(connectionId);
}

async function setRemotePairingAddress(address: string): Promise<RemoteAccessStatus> {
	if (!desktopDirectNetworkExposure.getStatus().isRunning) {
		desktopDirectNetworkExposure.setPairingAddress(address);
	}
	if (usesPrivilegedWebRtcExposure()) {
		await privilegedWebRtcExposure!.service.setPairingAddress(address);
	} else {
		desktopRemoteExposure.setPairingAddress(address);
	}
	return currentRemoteAccessStatus();
}

function setRemotePairingPin(pin: string): TerminalSettings {
	const currentSettings = readTerminalSettings();
	const pairingPinHash = createPairingPinHash(pin);
	writeRemotePairingPinVerifier(pairingPinHash);
	const settings = writeTerminalSettings({
		...currentSettings,
		remoteAccess: { ...currentSettings.remoteAccess, pairingPinHash },
	});
	privilegedWebRtcExposure?.service.notifyStatusChanged();
	createAppMenu(settings);
	return settings;
}

if (process.env.TERMINAY_TEST === '1') {
	ipcMain.handle('test:list-remote-protocol-connections', (event) => {
		assertBoundServerUiEvent(event);
		return embeddedLanExposure.testProtocolConnectionIds();
	});

	ipcMain.handle(
		'test:fail-remote-protocol-connection',
		async (event, payload?: { connectionId?: unknown }) => {
			assertBoundServerUiEvent(event);
			const connectionId = payload?.connectionId;
			if (
				typeof connectionId !== 'string' ||
				connectionId.length === 0 ||
				connectionId.length > 128
			) {
				throw new TypeError('test protocol connection id is invalid');
			}
			await embeddedLanExposure.failTestProtocolConnection(connectionId);
		},
	);

	ipcMain.handle(
		'test:create-server-terminal',
		async (event, payload?: { cwd?: unknown; projectId?: unknown }) => {
			assertTrustedAppSender(event);
			if (!serverTerminalAuthority)
				throw new Error('embedded server is unavailable');
			const cwd =
				typeof payload?.cwd === 'string' && payload.cwd.length > 0
					? payload.cwd
					: undefined;
			const projectId =
				typeof payload?.projectId === 'string' &&
				payload.projectId.trim().length > 0
					? payload.projectId.trim()
					: 'desktop';
			const session = await createServerOwnedTerminalSession(
				event.sender.id,
				projectId,
				cwd,
			);
			attachServerTerminalRenderer(session.id, event.sender.id);
			return { id: session.id };
		},
	);

	ipcMain.handle(
		'test:write-server-terminal',
		async (event, payload?: { data?: unknown; sessionId?: unknown }) => {
			assertTrustedAppSender(event);
			if (!serverTerminalAuthority)
				throw new Error('embedded server is unavailable');
			const sessionId = payload?.sessionId;
			const data = payload?.data;
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			) {
				throw new TypeError('test terminal session id is invalid');
			}
			if (
				typeof data !== 'string' ||
				data.length === 0 ||
				data.length > 1_048_576
			) {
				throw new TypeError('test terminal input is invalid');
			}
			if (serverTerminalAuthority.get(sessionId)?.status !== 'running') {
				throw new Error('The requested terminal session is not available.');
			}
			await serverTerminalAuthority.write(sessionId, data);
		},
	);

	ipcMain.handle(
		'test:get-server-terminal-cwd',
		async (event, payload?: { sessionId?: unknown }) => {
			assertTrustedAppSender(event);
			if (!serverTerminalAuthority)
				throw new Error('embedded server is unavailable');
			const sessionId = payload?.sessionId;
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			) {
				throw new TypeError('test terminal session id is invalid');
			}
			return serverTerminalAuthority.currentCwd(sessionId);
		},
	);

	ipcMain.handle(
		'test:get-server-git-workspace',
		async (event, payload?: { sessionId?: unknown }) => {
			assertTrustedAppSender(event);
			if (!serverTerminalAuthority)
				throw new Error('embedded server is unavailable');
			const sessionId = payload?.sessionId;
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			) {
				throw new TypeError('test terminal session id is invalid');
			}
			const session = serverTerminalAuthority.get(sessionId);
			if (session === undefined) return null;
			const project =
				serverTerminalAuthority.workspace.state.projects[session.projectId];
			const binding = serverTerminalAuthority.git.getBinding(session.projectId);
			const worktrees = await serverTerminalAuthority.git.worktrees({
				projectId: session.projectId,
			});
			return {
				projectId: session.projectId,
				projectRoot: project?.root ?? null,
				binding: binding
					? {
							projectRoot: binding.projectRoot,
							repositoryRoot: binding.repositoryRoot,
							state: binding.state,
							worktreeRoot: binding.worktreeRoot,
						}
					: null,
				worktrees: {
					repositoryRoot: worktrees.repositoryRoot,
					state: worktrees.state,
					paths: worktrees.worktrees.map((worktree) => worktree.path),
				},
			};
		},
	);

	ipcMain.handle(
		'test:get-server-terminal-activity',
		(event, payload?: { sessionId?: unknown }) => {
			assertTrustedAppSender(event);
			if (!serverTerminalAuthority)
				throw new Error('embedded server is unavailable');
			const sessionId = payload?.sessionId;
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			) {
				throw new TypeError('test terminal session id is invalid');
			}
			const session = serverTerminalAuthority.get(sessionId);
			if (session === undefined) return null;
			const snapshot = serverTerminalAuthority.activity.get({
				serverId: session.serverId,
				projectId: session.projectId,
				sessionId,
			});
			return snapshot === undefined
				? null
				: {
						foregroundBusy: snapshot.foregroundBusy,
						status: snapshot.status,
						acknowledged: snapshot.acknowledged,
						claimed: snapshot.claimed,
						source: snapshot.source,
					};
		},
	);

	ipcMain.handle(
		'test:get-mcp-control-environment',
		(event, payload?: { terminalSessionId?: unknown }) => {
			assertBoundServerUiEvent(event);
			const terminalSessionId = payload?.terminalSessionId;
			if (
				typeof terminalSessionId !== 'string' ||
				terminalSessionId.length === 0
			) {
				throw new Error('A terminal session id is required.');
			}
			const serverSession = serverTerminalAuthority?.get(terminalSessionId);
			if (serverSession?.status !== 'running') {
				throw new Error('The requested terminal session is not available.');
			}
			// Canonical protocol-created terminals do not pass through the legacy
			// Electron spawn wrapper that eagerly installs shell MCP environment.
			// This test-only bridge may mint the same exact-session capability on
			// demand; normal MCP discovery remains controlled by server-owned spawn
			// configuration and the token cannot address another project/session.
			// Mint a fresh document-bound capability for this explicit request.
			// Restored sessions can retain a shell-era token; reusing it would make
			// a later renderer/document scope ambiguous. Replacing it atomically
			// also revokes that old capability.
			const token = registerControlToken(terminalSessionId, event.sender.id);
			return {
				projectId: serverSession.projectId,
				sessionId: serverSession.id,
				socketPath: getControlSocketPath(),
				token,
			};
		},
	);

	const appCommandStagesBySender = new Map<number, string>();
	ipcMain.on('test:app-command-stage', (event, stage: unknown) => {
		assertTrustedAppSender(event);
		if (typeof stage === 'string' && stage.length <= 200) {
			appCommandStagesBySender.set(event.sender.id, stage);
		}
	});

	ipcMain.handle(
		'test:send-app-command',
		async (event, command: AppCommand) => {
			assertTrustedAppSender(event);
			const requestId = randomUUID();
			const requestSenderId = event.sender.id;
			appCommandStagesBySender.set(requestSenderId, `dispatched:${command}`);
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					const stage =
						appCommandStagesBySender.get(requestSenderId) ?? 'unknown';
					cleanup();
					reject(
						new Error(
							`renderer app command completion timed out (last stage: ${stage})`,
						),
					);
					// App commands acknowledge their real asynchronous completion. Large
					// sparse saves and other bounded host operations can legitimately exceed
					// Playwright's per-action timeout on a loaded CI runner, so this test-only
					// transport deadline follows the enclosing 30-second scenario budget.
				}, 20_000);
				const onComplete = (
					event: Electron.IpcMainEvent,
					replyRequestId: unknown,
					errorMessage: unknown,
				) => {
					assertTrustedAppSender(event);
					if (
						event.sender.id !== requestSenderId ||
						replyRequestId !== requestId
					) {
						return;
					}
					cleanup();
					if (typeof errorMessage === 'string' && errorMessage.length > 0) {
						reject(new Error(errorMessage));
					} else {
						resolve();
					}
				};
				const cleanup = () => {
					clearTimeout(timeout);
					ipcMain.removeListener('test:app-command-complete', onComplete);
					appCommandStagesBySender.delete(requestSenderId);
				};
				ipcMain.on('test:app-command-complete', onComplete);
				event.sender.send('app:command', command, requestId);
			});
		},
	);

	ipcMain.handle(
		'test:set-ai-tab-metadata-mock',
		(
			event,
			mock: {
				error?: string | null;
				models?: AiTabMetadataModel[];
				noteResult?: string;
				titleResult?: string;
			},
		) => {
			assertBoundServerUiEvent(event);
			aiTabMetadataService.setTestMock(mock);
		},
	);

	ipcMain.handle(
		'test:emit-agent-journal-record',
		async (
			event,
			payload?: {
				provider?: unknown;
				terminalSessionId?: unknown;
				record?: unknown;
			},
		) => {
			assertBoundServerUiEvent(event);
			if (!isAgentProvider(payload?.provider)) {
				throw new Error('A supported agent provider is required.');
			}
			if (
				typeof payload?.terminalSessionId !== 'string' ||
				payload.terminalSessionId.length === 0
			) {
				throw new Error('A terminal session id is required.');
			}
			if (
				!payload.record ||
				typeof payload.record !== 'object' ||
				Array.isArray(payload.record)
			) {
				throw new Error('An agent journal record is required.');
			}
			const serverSession = serverTerminalAuthority?.get(
				payload.terminalSessionId,
			);
			if (serverSession !== undefined) {
				return serverTerminalAuthority!.agents.ingestJournalRecord(
					{
						serverId: serverSession.serverId,
						projectId: serverSession.projectId,
						sessionId: serverSession.id,
					},
					payload.provider,
					payload.record as Record<string, unknown>,
				);
			}
			throw new Error('The terminal session is not available.');
		},
	);
}

ipcMain.handle('secrets:get', (event) => {
	assertTrustedAppSender(event);
	const secrets = readSecrets();
	return secrets
		.filter(
			(secret) =>
				secret.id !== DICTATION_OPENAI_SECRET_ID &&
				secret.name !== DICTATION_OPENAI_SECRET_NAME,
		)
		.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.handle('secrets:save', (event, { name, value }) => {
	assertTrustedAppSender(event);
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Encryption is not available on this system.');
	}
	const secrets = readSecrets();
	const id = randomUUID();
	const encryptedValue = safeStorage.encryptString(value).toString('base64');
	const record: SecretRecord = { id, name, encryptedValue };
	secrets.push(record);
	writeSecrets(secrets);
	return { id, name };
});

ipcMain.handle('secrets:delete', (event, id) => {
	assertTrustedAppSender(event);
	const secrets = readSecrets();
	const index = secrets.findIndex((s) => s.id === id);
	if (index !== -1) {
		secrets.splice(index, 1);
		writeSecrets(secrets);
	}
});

ipcMain.handle('secrets:get-decrypted', (event, id) => {
	assertTrustedAppSender(event);
	if (id === DICTATION_OPENAI_SECRET_ID) {
		throw new Error('Secret not found.');
	}
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Encryption is not available on this system.');
	}
	const secrets = readSecrets();
	const secret = secrets.find((s) => s.id === id);
	if (!secret) {
		throw new Error('Secret not found.');
	}
	return safeStorage.decryptString(
		Buffer.from(secret.encryptedValue, 'base64'),
	);
});

app.on('browser-window-created', (_event, window) => {
	void desktopDiagnostics.record(
		{
			component: 'main',
			event: 'main.window.created',
			fields: { windowId: window.id },
			severity: 'info',
			source: 'window-lifecycle',
		},
		{ channel: 'lifecycle' },
	);
});

app.on('web-contents-created', (_event, contents) => {
	const webContentsId = contents.id;
	bindWebContentsDiagnostics({
		app,
		contents,
		diagnostics: desktopDiagnostics,
	});
	bindAppShortcuts(contents);

	contents.once('destroyed', () => {
		if (webContentsId === projectDragSourceWebContentsId) {
			stopProjectDragTracking();
		}
		detachSessionsForWebContents(webContentsId);
		fileWatchService.disposeSubscriber(webContentsId);
	});
});

const handleBeforeQuit = createGracefulQuitHandler({
	app,
	shutdown: async () => {
		let clean = false;
		try {
			await desktopDiagnostics.record(
				{
					component: 'local-server',
					event: 'local-server.stopping',
					severity: 'info',
					source: 'local-server',
				},
				{ channel: 'lifecycle' },
			);
			await Promise.all([
				privilegedWebRtcExposure?.shutdown(),
				desktopRemoteExposure.shutdown(),
				serverTerminalAuthority?.shutdown(),
				stopControlServer(),
			]);
			await desktopDiagnostics.record(
				{
					component: 'local-server',
					event: 'local-server.stopped',
					severity: 'info',
					source: 'local-server',
				},
				{ channel: 'lifecycle' },
			);
			clean = true;
		} catch (error) {
			await desktopDiagnostics.record(
				{
					component: 'local-server',
					event: 'local-server.failed',
					message: error,
					severity: 'error',
					source: 'local-server',
				},
				{ channel: 'lifecycle' },
			);
			throw error;
		} finally {
			unbindFatalProcessDiagnostics();
			unbindAppChildDiagnostics();
			await desktopDiagnostics.close({ clean });
		}
	},
	onShutdownError: (error) => {
		console.error('[shutdown] graceful cleanup failed', error);
	},
});

app.on('before-quit', (event) => {
	const runningTerminalCount = getRunningTerminalCount();
	if (!isQuitConfirmed && runningTerminalCount > 0) {
		event.preventDefault();
		if (quitConfirmationPending) return;
		quitConfirmationPending = true;
		const target = BrowserWindow.getFocusedWindow() ?? getFirstAppWindow();
		const confirmation = target
			? dialog.showMessageBox(
					target,
					createCloseConfirmationDialog('app', runningTerminalCount),
				)
			: dialog.showMessageBox(
					createCloseConfirmationDialog('app', runningTerminalCount),
				);
		void confirmation
			.then(({ response }) => {
				if (response !== 0) return;
				isQuitConfirmed = true;
				isQuitting = true;
				app.quit();
			})
			.catch((error) => console.error('[app] quit confirmation failed', error))
			.finally(() => {
				quitConfirmationPending = false;
			});
		return;
	}
	isQuitConfirmed = true;
	isQuitting = true;
	parakeetRuntime.stop();
	handleBeforeQuit(event);
});

registerFileViewerIpcHandlers({
	assertTrustedSender: assertTrustedAppSender,
	fileBufferService,
	fileWatchService,
	gitDiffService,
	ipcMain,
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	if (!isQuitting && BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

async function completeDesktopStartup(): Promise<void> {
	const embeddedStartupWindow = await embeddedRuntimeReady;
	app.setName('Terminay');
	app.setAboutPanelOptions({ applicationName: 'Terminay' });
	// Electron safeStorage can report unavailable before app readiness even when
	// the OS-backed protector is available immediately afterwards. Keep the
	// server vault locked during module composition, then unlock it inside the
	// readiness gate before admitting any renderer or reporting the Local server
	// ready. safeStorage owns the OS interaction; no reusable passphrase or key
	// material is supplied by Terminay in embedded mode.
	if (embeddedVault.status().state === 'locked') {
		await embeddedVault.unlock({ secret: new Uint8Array() });
	}
	powerMonitor.on('resume', () => {
		void desktopDiagnostics.cleanup();
	});
	await desktopDiagnostics.record(
		{
			component: 'main',
			event: 'main.ready',
			severity: 'info',
			source: 'main-lifecycle',
		},
		{ channel: 'lifecycle' },
	);
	ensureNodePtySpawnHelperIsExecutable();
	setDockIcon();
	createAppMenu();
	try {
		await applyAgentIntegrationSetting(readTerminalSettings());
		await desktopDiagnostics.record(
			{
				component: 'local-server',
				event: 'local-server.ready',
				severity: 'info',
				source: 'local-server',
			},
			{ channel: 'lifecycle' },
		);
	} catch (error) {
		await desktopDiagnostics.record(
			{
				component: 'local-server',
				event: 'local-server.failed',
				message: error,
				severity: 'error',
				source: 'local-server',
			},
			{ channel: 'lifecycle' },
		);
		throw error;
	}
	await launchDeferredCanonicalWindow(embeddedStartupWindow);
	applyControlServerSetting();
}

async function recoverFailedDesktopBootstrap(error: unknown): Promise<void> {
	console.error('[main] Desktop bootstrap failed', error);
	const window = embeddedStartupWindowForRecovery;
	if (window === null || window.isDestroyed()) {
		// There is no native surface on which a recovery state could be rendered.
		// Contain the rejected readiness chain rather than allowing Electron to
		// produce its own uncaught-error dialog.
		void recordCanonicalRecoveryDiagnostic(error);
		return;
	}
	const windowWebContentsId = window.webContents.id;
	await showCanonicalLaunchRecovery({
		window,
		error: new Error(
			'Terminay could not finish starting. Retry after checking that application storage is available.',
		),
		retry: async () => {
			// A failed main-process composition may have partially initialized native
			// services. Relaunching is the bounded recovery boundary; it avoids
			// reusing those services or presenting a blank native shell.
			app.relaunch();
			app.exit(0);
		},
		onDiagnostic: recordCanonicalRecoveryDiagnostic,
		onRecoveryState: (active) => {
			if (active) launchRecoveryWebContents.add(windowWebContentsId);
			else launchRecoveryWebContents.delete(windowWebContentsId);
		},
	});
}

void app.whenReady()
	.then(completeDesktopStartup)
	.catch((error) => recoverFailedDesktopBootstrap(error));
