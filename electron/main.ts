import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
	chmodSync,
	type Dirent,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import {
	lstat,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import {
	type ByteTransport,
	decodeFrame,
	type JsonValue,
} from '@terminay/protocol';
import {
	app,
	BrowserWindow,
	clipboard,
	crashReporter,
	dialog,
	ipcMain,
	Menu,
	MessageChannelMain,
	nativeImage,
	Notification,
	powerMonitor,
	safeStorage,
	screen,
	shell,
	systemPreferences,
	webContents,
} from 'electron';
import WebSocket from 'ws';
import { LocalServerUiSession } from '../apps/terminay-desktop/src/main/localServerUiSession';
import { DesktopServerBundleHost, type DesktopBundleLaunch } from '../apps/terminay-desktop/src/main/serverBundleHost';
import { MacroRepository } from '../packages/server-core/src/macroService/repository';
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
import { createRemoteStreamTransport } from '../src/shared/remoteStreamTransport';
import {
	type ServerMessagePort,
	ServerPortTransport,
	ServerScopedMessagePort,
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
	EditWindowResult,
	EditWindowState,
	FileExplorerEntry,
	FileSearchResult,
	FolderSizeProgress,
	FolderSizeResult,
	ProjectEditWindowDraft,
	ProjectEditWindowResult,
	RemoteAccessStatus,
	TerminalEditWindowDraft,
	TerminalEditWindowResult,
	TerminalRecordingStartMetadata,
	TerminalRecordingState,
} from '../src/types/terminay';
import { registerAiTabMetadataIpcHandlers } from './aiTabMetadata/ipc';
import {
	AiTabMetadataService,
	warmAiTabMetadataProviderEnv,
} from './aiTabMetadata/service';
import { bindAuxiliaryWindowLifecycle } from './auxiliaryWindowLifecycle';
import {
	bindLocalServerUiDocumentEndpoint,
	bindRemoteServerUiDocumentEndpoint,
} from './serverUiDocumentEndpoint';
import {
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
import { registerDictationIpcHandlers } from './dictation/ipc';
import { ParakeetRuntime } from './dictation/parakeetRuntime';
import { DictationService } from './dictation/service';
import { normalizeExternalHttpsUrl } from './externalUrl';
import { FileExplorerWatchService } from './fileExplorerWatchService';
import { FileBufferService } from './fileViewer/fileBufferService';
import { FileWatchService } from './fileViewer/fileWatchService';
import { GitDiffService } from './fileViewer/gitDiffService';
import { registerFileViewerIpcHandlers } from './fileViewer/ipc';
import { createGracefulQuitHandler } from './gracefulQuit';
import {
	bindMainWindowCloseConfirmation,
	createCloseConfirmationDialog,
	type DestructiveCloseKind,
} from './mainWindowCloseConfirmation';
import {
	getMcpInstallStatus,
	installMcpAgent,
	type McpServerCommand,
	uninstallMcpAgent,
} from './mcpInstall';
import { registerQuickPushIpcHandlers } from './quickPush/ipc';
import { QuickPushService } from './quickPush/service';
import { TerminalRecordingService } from './recording/service';
import {
	isRemoteAccessPairingUrl,
	normalizeRemoteConnectionUrl,
} from './remote/connectionUrl';
import { resolveDesktopConnectionIntent } from './remote/desktopConnectionIntent';
import { establishDesktopDevicePairing } from './remote/desktopPairing';
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
import {
	bindNativeWindowCloseBarrier,
	bindSingletonWindowLifecycle,
} from './singletonWindowLifecycle';
import { assertTrustedIpcSender } from './trustedIpcSender';
import {
	ElectronSafeStorageVaultAdapter,
	FileSafeStorageVaultRepository,
} from './vault/safeStorageVault';

function hasOwn(value: object, key: PropertyKey): boolean {
	// Calling the prototype method explicitly remains safe for arbitrary objects.
	// biome-ignore lint/suspicious/noPrototypeBuiltins: do not trust a payload's own prototype.
	return Object.prototype.hasOwnProperty.call(value, key);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
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
	return (
		appWindows.has(window) ||
		window === settingsWindow ||
		window === macrosWindow ||
		window === recordingsWindow ||
		window === projectEnvironmentsWindow ||
		[...pendingEditWindows.values()].some(
			(pending) => pending.window === window,
		)
	);
}

function isTrustedDictationWindow(window: BrowserWindow): boolean {
	return appWindows.has(window) || window === settingsWindow;
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

/** Apply one explicit deny-by-default policy to every privileged renderer.
 * The app's own origin is the only allowed navigation target; external links
 * go through the validated host action instead of becoming renderer windows. */
function securePrimaryWindow(window: BrowserWindow): void {
	const contents = window.webContents;
	contents.setWindowOpenHandler(() => ({ action: 'deny' }));
	contents.on('will-attach-webview', (event) => event.preventDefault());
	const frameNavigations = contents as unknown as {
		on(
			event: 'will-frame-navigate',
			listener: (event: Electron.Event, url: string) => void,
		): void;
	};
	frameNavigations.on('will-frame-navigate', (event, url) => {
		if (!isAppNavigation(url)) event.preventDefault();
	});
	contents.on('will-navigate', (event, url) => {
		if (!isAppNavigation(url)) event.preventDefault();
	});
	contents.on('will-redirect', (event, url) => {
		if (!isAppNavigation(url)) event.preventDefault();
	});
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

let serverTerminalAuthority: ServerTerminalAuthority | null = null;
let privilegedWebRtcExposure: PrivilegedWebRtcExposure | null = null;
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
	token: string;
	sessionId: string;
	webContentsId: number;
}
const controlTokensByToken = new Map<string, ControlTokenRecord>();
const controlTokensBySession = new Map<string, string>();
let controlServer: ControlServer | null = null;
let settingsWindow: BrowserWindow | null = null;
let settingsWindowCloseBarrier: Promise<void> = Promise.resolve();
let macrosWindow: BrowserWindow | null = null;
let recordingsWindow: BrowserWindow | null = null;
let projectEnvironmentsWindow: BrowserWindow | null = null;
const activeRemoteByteConnectionsByWebContents = new Map<
	number,
	RemoteHttpConnection
>();
// BrowserWindow identity outlives a renderer document and its transferred
// MessagePort. Keep the selected authority separately so a reload reconnects
// the same profile instead of allowing the Local load hook to take over.
const remoteProfileBindingsByWebContents = new Map<number, string>();
const pendingRemoteConnectionWindowsByProfile = new Map<
	string,
	BrowserWindow
>();
const pendingEditWindows = new Map<
	number,
	{
		resolve: (
			result: ProjectEditWindowResult | TerminalEditWindowResult | null,
		) => void;
		settled: boolean;
		state: EditWindowState;
		window: BrowserWindow;
	}
>();

type RemoteHttpConnection = {
	readonly profileId: string;
	readonly scopeId: string;
	label: string;
	readonly origin: string;
	readonly close: () => Promise<void>;
};

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

function saveRememberedRemoteConnections(): void {
	mkdirSync(path.dirname(rememberedRemoteConnectionsPath()), {
		recursive: true,
	});
	writeFileSync(
		rememberedRemoteConnectionsPath(),
		`${JSON.stringify([...rememberedRemoteConnections.values()], null, 2)}\n`,
		{ mode: 0o600 },
	);
}

function rememberRemoteConnection(
	origin: string,
	label: string,
	kind: RememberedRemoteConnection['kind'],
): RememberedRemoteConnection {
	loadRememberedRemoteConnections();
	const existing = [...rememberedRemoteConnections.values()].find(
		(profile) => profile.origin === origin,
	);
	const profile = {
		id: existing?.id ?? `remote-profile-${randomUUID()}`,
		kind,
		label: existing?.label ?? label,
		origin,
	} satisfies RememberedRemoteConnection;
	rememberedRemoteConnections.set(profile.id, profile);
	saveRememberedRemoteConnections();
	return profile;
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
interface AdoptedProjectPayload {
	project: unknown;
	terminals: Array<{ sessionId: string; [key: string]: unknown }>;
	activeSessionId?: string | null;
}

// Project-host (index.html) windows, as opposed to the auxiliary settings /
// macros / recordings / edit windows. Multi-window project tabs are peers.
const appWindows = new Set<BrowserWindow>();
const runningTerminalSessionsByWindow = new Map<number, Set<string>>();
const workspaceViewByWebContents = new Map<number, string>();
const confirmedWindowCloseWebContents = new Set<number>();

function getRunningTerminalCount(): number {
	const sessions = new Set<string>();
	for (const windowSessions of runningTerminalSessionsByWindow.values()) {
		for (const sessionId of windowSessions) sessions.add(sessionId);
	}
	return sessions.size;
}

function getRunningTerminalCountForWindow(webContentsId: number): number {
	return runningTerminalSessionsByWindow.get(webContentsId)?.size ?? 0;
}

function getOpenProjectWindowCount(): number {
	let count = 0;
	for (const window of appWindows) {
		if (!window.isDestroyed()) count += 1;
	}
	return count;
}
// New popout windows pull their adopted project on boot through the transfer host.
const pendingAdoptedProjects = new Map<number, AdoptedProjectPayload>();
// Each project-host window publishes the screen-relative rect of its project tab
// bar so a cross-window drag can be hit-tested against it on release.
const tabBarRectsByWebContents = new Map<
	number,
	{ x: number; y: number; width: number; height: number }
>();
const fileBufferService = new FileBufferService(() => app.getPath('home'));
const fileWatchService = new FileWatchService(fileBufferService);
const fileExplorerWatchService = new FileExplorerWatchService(() =>
	app.getPath('home'),
);
const gitDiffService = new GitDiffService(fileBufferService);
const aiTabMetadataService = new AiTabMetadataService(app.getPath('home'));
const parakeetRuntime = new ParakeetRuntime({
	rootDirectory: path.join(app.getPath('userData'), 'dictation', 'parakeet'),
});
const dictationService = new DictationService({
	apiKeyProvider: () => readDictationOpenAiKey(),
	providerProvider: () => readTerminalSettings().dictation.provider,
	parakeetRuntime,
});
const quickPushService = new QuickPushService(aiTabMetadataService);
warmAiTabMetadataProviderEnv();
let cachedAppUpdateStatus: AppUpdateStatus | null = null;
let appUpdateFetchPromise: Promise<AppUpdateStatus> | null = null;

const recordingService = new TerminalRecordingService({
	getHomePath: () => app.getPath('home'),
	getLibraryIndexPath: () =>
		path.join(app.getPath('userData'), 'recording-roots.json'),
	getSettings: () => readTerminalSettings(),
	onStateChanged: broadcastTerminalRecordingState,
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
serverTerminalAuthority = new ServerTerminalAuthority({
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
			const authority = serverTerminalAuthority;
			if (authority === null)
				throw new Error('The embedded terminal authority is unavailable.');
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
					authority.service.input(target, bytes, authorization),
				key: (_candidate, key) =>
					authority.service.input(
						target,
						embeddedMacroKeyBytes(key),
						authorization,
					),
				waitForInactivity: (_candidate, milliseconds, signal) =>
					authority.service.waitForInactivity(target, milliseconds, {
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
localServerUiSession = new LocalServerUiSession({
	bundleRoot: SERVER_UI_DIST,
	cacheRoot: path.join(app.getPath('userData'), 'ui-bundles'),
	executionRuntimeVersion: Number.parseInt(process.versions.chrome, 10),
	serverId: serverTerminalAuthority.service.serverId,
});
remoteServerUiBundleHost = new DesktopServerBundleHost({
	cacheRoot: path.join(app.getPath('userData'), 'ui-bundles'),
	executionRuntimeVersion: Number.parseInt(process.versions.chrome, 10),
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
const embeddedLanExposure = new EmbeddedLanExposure({
	core: serverTerminalAuthority.composition.core,
	...(process.env.TERMINAY_TEST === '1' ? { enableTestControl: true } : {}),
	getSettings: () => readTerminalSettings().remoteAccess,
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
	serverId: serverTerminalAuthority.service.serverId,
	serverVersion: app.getVersion(),
	uiBundleDirectory: SERVER_UI_DIST,
});
const desktopRemoteExposure = new DesktopServerOwnedExposure({
	serverId: serverTerminalAuthority.service.serverId,
	sessionOrigin: readTerminalSettings().remoteAccess.origin,
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
		const settings = readTerminalSettings().remoteAccess;
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
const desktopDirectNetworkExposure = new DesktopServerOwnedExposure({
	serverId: serverTerminalAuthority.service.serverId,
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
			serverId: serverTerminalAuthority.service.serverId,
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
			getRemoteAccessSettings: () => readTerminalSettings().remoteAccess,
			notifyTerminalRemoteSizeOverride: () => undefined,
			onStatusChanged: () => broadcastRemoteAccessStatus(),
			publicDir: process.env.VITE_PUBLIC ?? RENDERER_DIST,
			rendererDistDir: RENDERER_DIST,
			saveGeneratedTlsPaths: () => undefined,
			userDataPath: app.getPath('userData'),
		},
	);
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
		const token = registerControlToken(id, webContentsId);
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

function writeMacros(macros: MacroDefinition[]): MacroDefinition[] {
	const normalized = normalizeMacros(macros);
	const macrosPath = getMacrosPath();

	mkdirSync(path.dirname(macrosPath), { recursive: true });
	writeFileSync(macrosPath, JSON.stringify(normalized, null, 2));
	return normalized;
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

function getDictationOpenAiSecret(
	secrets = readSecrets(),
): SecretRecord | null {
	return (
		secrets.find(
			(secret) =>
				secret.id === DICTATION_OPENAI_SECRET_ID ||
				secret.name === DICTATION_OPENAI_SECRET_NAME,
		) ?? null
	);
}

function getDictationOpenAiKeyStatus(): { configured: boolean } {
	return { configured: getDictationOpenAiSecret() !== null };
}

function getDictationMicrophonePermissionStatus():
	| 'not-determined'
	| 'granted'
	| 'denied'
	| 'restricted'
	| 'unknown' {
	if (process.platform !== 'darwin') {
		return 'granted';
	}

	return systemPreferences.getMediaAccessStatus('microphone');
}

async function requestDictationMicrophonePermission(): Promise<
	'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
> {
	if (process.platform !== 'darwin') {
		return 'granted';
	}

	const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
	if (
		currentStatus === 'granted' ||
		currentStatus === 'denied' ||
		currentStatus === 'restricted'
	) {
		return currentStatus;
	}

	const granted = await systemPreferences.askForMediaAccess('microphone');
	return granted
		? 'granted'
		: systemPreferences.getMediaAccessStatus('microphone');
}

function saveDictationOpenAiKey(apiKey: string): { configured: boolean } {
	const trimmedApiKey = apiKey.trim();
	if (!trimmedApiKey) {
		throw new Error('OpenAI API key is required.');
	}

	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Encryption is not available on this system.');
	}

	const secrets = readSecrets();
	const encryptedValue = safeStorage
		.encryptString(trimmedApiKey)
		.toString('base64');
	const existingIndex = secrets.findIndex(
		(secret) =>
			secret.id === DICTATION_OPENAI_SECRET_ID ||
			secret.name === DICTATION_OPENAI_SECRET_NAME,
	);
	const record: SecretRecord = {
		id: DICTATION_OPENAI_SECRET_ID,
		name: DICTATION_OPENAI_SECRET_NAME,
		encryptedValue,
	};

	if (existingIndex === -1) {
		secrets.push(record);
	} else {
		secrets[existingIndex] = record;
	}

	writeSecrets(secrets);
	return { configured: true };
}

function clearDictationOpenAiKey(): boolean {
	const secrets = readSecrets();
	const nextSecrets = secrets.filter(
		(secret) =>
			secret.id !== DICTATION_OPENAI_SECRET_ID &&
			secret.name !== DICTATION_OPENAI_SECRET_NAME,
	);
	if (nextSecrets.length === secrets.length) {
		return false;
	}

	writeSecrets(nextSecrets);
	return true;
}

function readDictationOpenAiKey(): string | null {
	if (!safeStorage.isEncryptionAvailable()) {
		throw new Error('Encryption is not available on this system.');
	}

	const secret = getDictationOpenAiSecret();
	if (!secret) {
		return null;
	}

	return safeStorage.decryptString(
		Buffer.from(secret.encryptedValue, 'base64'),
	);
}

function shellEscapePath(pathValue: string): string {
	return `'${pathValue.replace(/'/g, `'\\''`)}'`;
}

function expandClipboardFormatCandidates(format: string): string[] {
	const candidates = new Set<string>([format]);

	if (format.includes('.') && !format.includes('/')) {
		candidates.add(format.replace('.', '/'));
	}

	if (format.includes('/') && !format.includes('.')) {
		candidates.add(format.replace('/', '.'));
	}

	return [...candidates];
}

function readClipboardFormatText(format: string): string | null {
	for (const candidate of expandClipboardFormatCandidates(format)) {
		try {
			const text = clipboard.read(candidate);
			if (text.length > 0) {
				return text;
			}
		} catch {
			// Try the next candidate format.
		}

		try {
			const data = clipboard.readBuffer(candidate);
			if (data.length > 0) {
				return data.toString('utf8');
			}
		} catch {
			// Try the next candidate format.
		}
	}

	return null;
}

function resolveExplorerPath(rawPath: string): string {
	const trimmedPath = rawPath.trim();
	if (trimmedPath === '~') {
		return app.getPath('home');
	}

	if (trimmedPath.startsWith('~/') || trimmedPath.startsWith('~\\')) {
		return path.join(app.getPath('home'), trimmedPath.slice(2));
	}

	return trimmedPath;
}

async function readDirectoryEntries(
	dirPath: string,
): Promise<FileExplorerEntry[]> {
	const resolvedPath = resolveExplorerPath(dirPath);
	const directoryEntries = await readdir(resolvedPath, { withFileTypes: true });
	const items = await Promise.all(
		directoryEntries.map(async (entry) => {
			const entryPath = path.join(resolvedPath, entry.name);
			const linkStats = await lstat(entryPath);
			const stats = linkStats.isSymbolicLink()
				? await stat(entryPath).catch(() => linkStats)
				: linkStats;

			return {
				createdAtMs: Number.isFinite(stats.birthtimeMs)
					? stats.birthtimeMs
					: null,
				isDirectory: stats.isDirectory(),
				isSymbolicLink: linkStats.isSymbolicLink(),
				mode: stats.mode,
				modifiedAtMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
				name: entry.name,
				path: entryPath,
				size: stats.size,
			} satisfies FileExplorerEntry;
		}),
	);

	items.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) {
			return a.isDirectory ? -1 : 1;
		}

		return a.name.localeCompare(b.name, undefined, {
			sensitivity: 'base',
			numeric: true,
		});
	});

	return items;
}

const folderSizeJobs = new Map<string, { cancelled: boolean }>();

async function runFolderSizeJob(
	sender: Electron.WebContents,
	payload: { jobId: string; path: string },
): Promise<FolderSizeResult> {
	const job = { cancelled: false };
	folderSizeJobs.set(payload.jobId, job);

	let size = 0;
	let entryCount = 0;
	let lastProgressAt = Date.now();
	const pendingDirectories = [resolveExplorerPath(payload.path)];

	try {
		while (pendingDirectories.length > 0) {
			if (job.cancelled) {
				return { cancelled: true, entryCount, jobId: payload.jobId, size };
			}

			const directoryPath = pendingDirectories.pop() as string;
			let entries: Dirent[];
			try {
				entries = await readdir(directoryPath, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (job.cancelled) {
					return { cancelled: true, entryCount, jobId: payload.jobId, size };
				}

				entryCount += 1;
				const entryPath = path.join(directoryPath, entry.name);

				// Never follow symlinks: avoids cycles and double counting.
				if (entry.isSymbolicLink()) {
					continue;
				}
				if (entry.isDirectory()) {
					pendingDirectories.push(entryPath);
					continue;
				}

				try {
					const stats = await lstat(entryPath);
					size += stats.size;
				} catch {
					// unreadable entry: skip it
				}
			}

			const now = Date.now();
			if (now - lastProgressAt >= 100 && !sender.isDestroyed()) {
				lastProgressAt = now;
				sender.send('folder-size:progress', {
					entryCount,
					jobId: payload.jobId,
					size,
				} satisfies FolderSizeProgress);
			}
		}

		return { cancelled: false, entryCount, jobId: payload.jobId, size };
	} finally {
		folderSizeJobs.delete(payload.jobId);
	}
}

const FILE_SEARCH_IGNORED_DIRECTORIES = new Set([
	'.git',
	'.hg',
	'.svn',
	'.next',
	'.turbo',
	'.vite',
	'coverage',
	'dist',
	'dist-electron',
	'node_modules',
	'release',
]);
const FILE_SEARCH_SCAN_LIMIT = 25_000;

function normalizeFileSearchPath(value: string): string {
	return value.replace(/\\/g, '/');
}

function getFileSearchContext(rootPath: string, query: string) {
	const resolvedRoot = resolveExplorerPath(rootPath);
	const normalizedQuery = normalizeFileSearchPath(query).trim();
	const lastSeparatorIndex = normalizedQuery.lastIndexOf('/');
	const prefix =
		lastSeparatorIndex >= 0
			? normalizedQuery.slice(0, lastSeparatorIndex + 1)
			: '';
	const term =
		lastSeparatorIndex >= 0
			? normalizedQuery.slice(lastSeparatorIndex + 1)
			: normalizedQuery;
	const isAbsolute =
		normalizedQuery.startsWith('/') || path.isAbsolute(normalizedQuery);
	const basePath = isAbsolute
		? path.resolve(prefix || path.parse(resolvedRoot).root)
		: path.resolve(resolvedRoot, prefix || '.');

	return {
		basePath,
		displayPrefix: prefix,
		term,
	};
}

function getFuzzyTokenScore(source: string, token: string): number {
	let lastMatchIndex = -1;
	let score = 0;

	for (const character of token) {
		const matchIndex = source.indexOf(character, lastMatchIndex + 1);
		if (matchIndex === -1) {
			return 0;
		}

		score += matchIndex === lastMatchIndex + 1 ? 15 : 5;
		if (matchIndex === 0 || /[/._-]/.test(source[matchIndex - 1] ?? '')) {
			score += 10;
		}
		lastMatchIndex = matchIndex;
	}

	return score;
}

function getFileSearchScore(relativePath: string, query: string): number {
	const normalizedQuery = normalizeFileSearchPath(query).trim().toLowerCase();
	if (!normalizedQuery) {
		return 1;
	}

	const candidatePath = normalizeFileSearchPath(relativePath).toLowerCase();
	const candidateName = path.posix.basename(candidatePath);
	const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	let score = 0;

	for (const token of queryTokens) {
		if (candidatePath === token) {
			score += 10_000;
			continue;
		}
		if (candidateName === token) {
			score += 9_000;
			continue;
		}
		if (candidateName.startsWith(token)) {
			score += 5_000 - candidateName.length;
			continue;
		}
		if (candidatePath.startsWith(token)) {
			score += 4_000 - candidatePath.length;
			continue;
		}

		const nameSubstringIndex = candidateName.indexOf(token);
		if (nameSubstringIndex !== -1) {
			score += 3_000 - nameSubstringIndex;
			continue;
		}

		const pathSubstringIndex = candidatePath.indexOf(token);
		if (pathSubstringIndex !== -1) {
			score += 2_000 - pathSubstringIndex;
			continue;
		}

		const fuzzyScore = Math.max(
			getFuzzyTokenScore(candidateName, token),
			getFuzzyTokenScore(candidatePath, token),
		);
		if (fuzzyScore === 0) {
			return 0;
		}

		score += 1_000 + fuzzyScore;
	}

	return score;
}

async function searchFiles(
	rootPath: string,
	query: string,
	limit = 60,
): Promise<FileSearchResult[]> {
	const trimmedQuery = query.trim();
	if (!trimmedQuery) {
		return [];
	}

	const searchContext = getFileSearchContext(rootPath, trimmedQuery);
	const rootStats = await stat(searchContext.basePath);
	if (!rootStats.isDirectory()) {
		return [];
	}

	const requestedLimit = Number.isFinite(limit) ? Math.floor(limit) : 60;
	const boundedLimit = Math.max(1, Math.min(requestedLimit, 200));
	const matches: Array<FileSearchResult & { score: number }> = [];
	const directories = [''];
	let scannedFileCount = 0;

	while (directories.length > 0 && scannedFileCount < FILE_SEARCH_SCAN_LIMIT) {
		const relativeDirectory = directories.shift() ?? '';
		const absoluteDirectory = path.join(
			searchContext.basePath,
			relativeDirectory,
		);
		let entries: Dirent[];

		try {
			entries = await readdir(absoluteDirectory, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (entry.isSymbolicLink()) {
				continue;
			}

			const relativePath = path.join(relativeDirectory, entry.name);
			if (entry.isDirectory()) {
				if (!FILE_SEARCH_IGNORED_DIRECTORIES.has(entry.name)) {
					const displayPath = normalizeFileSearchPath(relativePath);
					const score = getFileSearchScore(displayPath, searchContext.term);
					if (score > 0) {
						matches.push({
							isDirectory: true,
							path: path.join(searchContext.basePath, relativePath),
							relativePath: `${searchContext.displayPrefix}${displayPath}/`,
							score: score + 50,
						});
					}

					directories.push(relativePath);
				}
				continue;
			}

			if (!entry.isFile()) {
				continue;
			}

			scannedFileCount += 1;
			const displayPath = normalizeFileSearchPath(relativePath);
			const score = getFileSearchScore(displayPath, searchContext.term);
			if (score <= 0) {
				continue;
			}

			matches.push({
				isDirectory: false,
				path: path.join(searchContext.basePath, relativePath),
				relativePath: `${searchContext.displayPrefix}${displayPath}`,
				score,
			});
		}
	}

	return matches
		.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}

			return left.relativePath.localeCompare(right.relativePath, undefined, {
				sensitivity: 'base',
				numeric: true,
			});
		})
		.slice(0, boundedLimit)
		.map(({ score: _score, ...result }) => result);
}

function parseClipboardFilePaths(rawValue: string): string[] {
	return rawValue
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.map((value) => {
			if (value.startsWith('file://')) {
				try {
					return fileURLToPath(value);
				} catch {
					return value;
				}
			}

			return value;
		});
}

function readClipboardFilePaths(): string[] {
	const availableFormats = clipboard
		.availableFormats()
		.map((format) => format.toLowerCase());
	const fileUrlFormats = [
		'public.file-url',
		'public/file-url',
		'text/uri-list',
		'nsfilenamespboardtype',
	];

	for (const format of fileUrlFormats) {
		const normalizedFormat = format.toLowerCase();
		if (!availableFormats.includes(normalizedFormat)) {
			continue;
		}

		const rawValue = readClipboardFormatText(format);
		if (!rawValue) {
			continue;
		}

		const paths = parseClipboardFilePaths(rawValue);
		if (paths.length > 0) {
			return paths;
		}
	}

	return [];
}

function readClipboardImagePath(): string | null {
	const image = clipboard.readImage();
	if (image.isEmpty()) {
		return null;
	}

	const imageBytes = image.toPNG();
	if (imageBytes.length === 0) {
		return null;
	}

	const tempDir = path.join(app.getPath('temp'), 'terminay-clipboard');
	mkdirSync(tempDir, { recursive: true });
	const filePath = path.join(tempDir, `clipboard-${randomUUID()}.png`);
	writeFileSync(filePath, imageBytes);
	return filePath;
}

function smartPasteClipboardContents(): string {
	// Match terminal-emulator behavior: prefer explicit file URLs, then plain text,
	// and only fall back to image-to-temp-file conversion when there is no text.
	const filePaths = readClipboardFilePaths();
	if (filePaths.length > 0) {
		return filePaths.map(shellEscapePath).join(' ');
	}

	const text = clipboard.readText();
	if (text.length > 0) {
		return text;
	}

	const imagePath = readClipboardImagePath();
	if (imagePath) {
		return shellEscapePath(imagePath);
	}

	return '';
}

function broadcastTerminalSettings(settings: TerminalSettings): void {
	const payload = { settings };
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) {
			continue;
		}

		window.webContents.send('settings:terminal-changed', payload);
	}
}

function broadcastMacros(macros: MacroDefinition[]): void {
	const payload = { macros };
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) {
			continue;
		}

		window.webContents.send('settings:macros-changed', payload);
	}
}

function broadcastTerminalRecordingState(state: TerminalRecordingState): void {
	const payload = { state };
	for (const window of BrowserWindow.getAllWindows()) {
		if (window.isDestroyed()) {
			continue;
		}

		window.webContents.send('terminal-recording:changed', payload);
	}
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

async function getChildProcessIds(pid: number): Promise<number[]> {
	try {
		if (process.platform === 'linux') {
			const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)]);
			return stdout
				.split('\n')
				.map((value) => Number.parseInt(value.trim(), 10))
				.filter((value) => Number.isInteger(value) && value > 0);
		}

		if (process.platform === 'darwin') {
			const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)]);
			return stdout
				.split('\n')
				.map((value) => Number.parseInt(value.trim(), 10))
				.filter((value) => Number.isInteger(value) && value > 0);
		}
	} catch {
		return [];
	}

	return [];
}

async function resolveDeepestProcessPid(pid: number): Promise<number> {
	let currentPid = pid;

	while (true) {
		const childPids = await getChildProcessIds(currentPid);
		if (childPids.length !== 1) {
			return currentPid;
		}

		currentPid = childPids[0];
	}
}

async function resolveProcessCwd(pid: number): Promise<string | null> {
	try {
		if (process.platform === 'linux') {
			const { stdout } = await execFileAsync('readlink', [`/proc/${pid}/cwd`]);
			const cwd = stdout.trim();
			return cwd.length > 0 ? cwd : null;
		}

		if (process.platform === 'darwin') {
			const { stdout } = await execFileAsync('/usr/sbin/lsof', [
				'-a',
				'-d',
				'cwd',
				'-Fn',
				'-p',
				String(pid),
			]);
			const cwdLine = stdout.split('\n').find((line) => line.startsWith('n'));
			const cwd = cwdLine?.slice(1).trim();
			return cwd && cwd.length > 0 ? cwd : null;
		}
	} catch {
		return null;
	}

	return null;
}

async function resolveTerminalProcessCwd(
	rootPid: number | undefined,
): Promise<string | null> {
	if (rootPid === undefined || rootPid <= 0) return null;
	const deepestPid = await resolveDeepestProcessPid(rootPid);
	return (
		(await resolveProcessCwd(deepestPid)) ??
		(deepestPid === rootPid ? null : await resolveProcessCwd(rootPid))
	);
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
): string {
	const token = randomUUID();
	controlTokensByToken.set(token, { token, sessionId, webContentsId });
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
	if (session?.status !== 'running') {
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

function reassignSessionOwner(
	sessionId: string,
	sourceWebContentsId: number,
	newWebContentsId: number,
): void {
	if (
		!serverTerminalAuthority?.isRendererAttached(sessionId, sourceWebContentsId)
	) {
		// Framed server clients subscribe with authenticated client identities,
		// not the obsolete numeric renderer-consumer alias. Their PTY ownership
		// remains server-side and the destination window resumes independently.
		return;
	}
	const listener = serverTerminalRendererListener(newWebContentsId);
	if (!listener) {
		throw new Error('The destination renderer is unavailable.');
	}
	serverTerminalAuthority.handoffRenderer(
		sessionId,
		sourceWebContentsId,
		newWebContentsId,
		listener,
	);

	// Keep MCP control routing pointed at the window that now hosts the session.
	const token = controlTokensBySession.get(sessionId);
	if (token) {
		const record = controlTokensByToken.get(token);
		if (record) {
			record.webContentsId = newWebContentsId;
		}
	}
}

function sendCommandToFocusedWindow(command: AppCommand): void {
	if (isQuitting) {
		return;
	}

	const targetWindow = BrowserWindow.getFocusedWindow() ?? getFirstAppWindow();
	if (!targetWindow || targetWindow.isDestroyed()) {
		return;
	}

	targetWindow.webContents.send('app:command', command);
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

		if (
			settingsWindow?.webContents.id === webContents.id ||
			macrosWindow?.webContents.id === webContents.id ||
			recordingsWindow?.webContents.id === webContents.id ||
			projectEnvironmentsWindow?.webContents.id === webContents.id ||
			pendingEditWindows.has(webContents.id)
		) {
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
		webContents.send('app:command', command);
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
					click: () => void openSettingsWindow(),
				},
				{
					label: 'Macros',
					accelerator: 'CmdOrCtrl+;',
					click: () => openMacrosWindow(),
				},
				{
					label: 'Recordings',
					accelerator: getMenuShortcut(settings, 'open-recordings'),
					click: () => openRecordingsWindow(),
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

function createWindow(options?: {
	adoptedProject?: AdoptedProjectPayload;
	bounds?: { x: number; y: number };
	initialServerConnection?: 'local' | 'deferred';
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

	const window = new BrowserWindow({
		icon: windowIconPath,
		width: 1400,
		height: 900,
		// Place a torn-off window's title bar near the drop point, like a browser.
		x: options?.bounds ? Math.round(options.bounds.x) - 120 : undefined,
		y: options?.bounds ? Math.round(options.bounds.y) - 12 : undefined,
		title: 'Terminay',
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
	appWindows.add(window);
	// Capture the webContents id now; it's unreadable once the window is closed
	// (accessing window.webContents after destruction throws).
	const windowWebContentsId = window.webContents.id;
	bindMainWindowCloseConfirmation({
		window,
		isQuitting: () => isQuitting,
		getRunningTerminalCount: () =>
			getRunningTerminalCountForWindow(windowWebContentsId),
		isLastWindow: () => getOpenProjectWindowCount() <= 1,
		consumeConfirmedClose: () =>
			confirmedWindowCloseWebContents.delete(windowWebContentsId),
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

	if (options?.adoptedProject) {
		pendingAdoptedProjects.set(windowWebContentsId, options.adoptedProject);
	}
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
	}

	window.on('closed', () => {
		releaseServerUiWindowBinding(
			windowWebContentsId,
			isQuitting ? 'application-quit' : 'window-close',
		);
		localServerUiSession.release(windowWebContentsId);
		appWindows.delete(window);
		runningTerminalSessionsByWindow.delete(windowWebContentsId);
		confirmedWindowCloseWebContents.delete(windowWebContentsId);
		tabBarRectsByWebContents.delete(windowWebContentsId);
		pendingAdoptedProjects.delete(windowWebContentsId);
		workspaceViewByWebContents.delete(windowWebContentsId);
		for (const [
			profileId,
			pendingWindow,
		] of pendingRemoteConnectionWindowsByProfile) {
			if (pendingWindow === window) {
				pendingRemoteConnectionWindowsByProfile.delete(profileId);
			}
		}
		const remoteConnection =
			activeRemoteByteConnectionsByWebContents.get(windowWebContentsId);
		activeRemoteByteConnectionsByWebContents.delete(windowWebContentsId);
		remoteProfileBindingsByWebContents.delete(windowWebContentsId);
		void remoteConnection?.close();
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

	window.webContents.on('will-navigate', (event) => {
		if (isAppNavigation(event.url)) {
			return;
		}

		event.preventDefault();
	});

	// Startup resolves and verifies the selected server's exact UI artifact
	// before any workspace renderer executes. Local, remote, development, and
	// packaged launches all enter through this canonical host/preload boundary.
	void (options?.serverUiLaunch === undefined
			? localServerUiSession.prepare(windowWebContentsId)
			: Promise.resolve(options.serverUiLaunch))
			.then((launch) => {
				if (window.isDestroyed()) return;
				const entryUrl = pathToFileURL(path.join(launch.assetRoot, launch.entryPath));
				if (options?.workspaceViewId) entryUrl.hash = `view=${encodeURIComponent(options.workspaceViewId)}`;
				bindServerUiWindow({
					window,
					context: launch.context,
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
							case 'clipboard.write': clipboard.writeText(action.text); return;
							case 'file.choose': await dialog.showOpenDialog(window, { properties: action.multiple ? ['openFile', 'multiSelections'] : ['openFile'] }); return;
							case 'notification.show': new Notification({ title: action.title, ...(action.body === undefined ? {} : { body: action.body }) }).show(); return;
							case 'updater.check': await getAppUpdateStatus({ force: true }); return;
							case 'os.open-external': await openInBrowser(action.url); return;
							case 'route.close': window.close(); return;
							case 'route.focus': window.focus(); return;
							case 'menu.invoke': sendCommandToFocusedWindow(action.command as AppCommand); return;
							case 'route.present': throw new Error('Route presentation is unavailable during Desktop bootstrap.');
							case 'os.reveal': throw new Error('OS reveal requires a host-issued path token.');
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
				if (options?.serverUiTransport !== undefined) {
					bindRemoteServerUiDocumentEndpoint({ diagnostic: endpointDiagnostic, launch, sender: targetWebContents, transport: options.serverUiTransport });
				} else if (serverTerminalAuthority !== null) {
					bindLocalServerUiDocumentEndpoint({
						acceptPort: (port) => serverTerminalAuthority?.acceptRendererPort(port as unknown as ServerMessagePort),
						diagnostic: endpointDiagnostic, handle: launch.byteEndpointHandle, sender: targetWebContents,
					});
				}
				return window.loadURL(entryUrl.toString());
			})
			.catch((error) => {
				console.error('[window] embedded server UI verification failed', error);
				releaseServerUiWindowBinding(windowWebContentsId, 'failed-launch');
				localServerUiSession.release(windowWebContentsId);
				if (!window.isDestroyed()) window.close();
			});

	void getAppUpdateStatus();

	return window;
}

function selectedProfileIdForRequester(
	requester?: Electron.WebContents,
): string | undefined {
	const source = requester ?? BrowserWindow.getFocusedWindow()?.webContents;
	return source === undefined
		? undefined
		: remoteProfileBindingsByWebContents.get(source.id);
}

function bindAuxiliaryServerAuthority(
	window: BrowserWindow,
	requester?: Electron.WebContents,
): void {
	const profileId = selectedProfileIdForRequester(requester);
	if (profileId === undefined)
		remoteProfileBindingsByWebContents.delete(window.webContents.id);
	else remoteProfileBindingsByWebContents.set(window.webContents.id, profileId);
}

async function postSelectedServerConnection(
	sender: Electron.WebContents,
	replacement = false,
): Promise<void> {
	const remoteProfileId = remoteProfileBindingsByWebContents.get(sender.id);
	if (remoteProfileId !== undefined) {
		loadRememberedRemoteConnections();
		const profile = rememberedRemoteConnections.get(remoteProfileId);
		if (profile === undefined || profile.kind !== 'device')
			throw new Error('The selected remote Terminay Server is unavailable.');
		await reconnectRememberedRemoteProfile(sender, profile);
		return;
	}
	const authority = serverTerminalAuthority;
	if (authority === null)
		throw new Error('The local server connection is unavailable.');
	const channel = new MessageChannelMain();
	authority.acceptRendererPort(channel.port1 as unknown as ServerMessagePort);
	sender.postMessage(
		'server:connection',
		{
			connectionId: randomUUID(),
			label: 'Local',
			...(replacement ? { replacement: true } : {}),
			serverId: authority.service.serverId,
		},
		[channel.port2],
	);
}

async function rebindAuxiliaryServerConnection(
	window: BrowserWindow,
	requester?: Electron.WebContents,
): Promise<void> {
	const nextProfileId = selectedProfileIdForRequester(requester);
	if (
		nextProfileId ===
		remoteProfileBindingsByWebContents.get(window.webContents.id)
	)
		return;
	bindAuxiliaryServerAuthority(window, requester);
	const active = activeRemoteByteConnectionsByWebContents.get(
		window.webContents.id,
	);
	activeRemoteByteConnectionsByWebContents.delete(window.webContents.id);
	await active?.close();
	if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
		await postSelectedServerConnection(window.webContents, true);
	}
}

function attachAuxiliaryServerConnection(
	window: BrowserWindow,
	requester?: Electron.WebContents,
): void {
	bindAuxiliaryServerAuthority(window, requester);
	const webContentsId = window.webContents.id;
	let sentForLoad = false;
	window.webContents.on('did-start-loading', () => {
		sentForLoad = false;
		const active = activeRemoteByteConnectionsByWebContents.get(webContentsId);
		activeRemoteByteConnectionsByWebContents.delete(webContentsId);
		void active?.close();
	});
	window.webContents.on('did-finish-load', () => {
		if (
			sentForLoad ||
			window.isDestroyed() ||
			window.webContents.isDestroyed() ||
			serverTerminalAuthority === null
		)
			return;
		sentForLoad = true;
		void postSelectedServerConnection(window.webContents).catch((error) =>
			console.error('[connection] failed to attach auxiliary window', error),
		);
	});
	window.on('closed', () => {
		const active = activeRemoteByteConnectionsByWebContents.get(webContentsId);
		activeRemoteByteConnectionsByWebContents.delete(webContentsId);
		remoteProfileBindingsByWebContents.delete(webContentsId);
		void active?.close();
	});
}

function postLocalServerConnection(
	sender: Electron.WebContents,
	replacement = true,
): void {
	const authority = serverTerminalAuthority;
	if (authority === null) {
		throw new Error('The local server connection is unavailable.');
	}
	const window = BrowserWindow.fromWebContents(sender);
	if (window === null || window.isDestroyed() || !appWindows.has(window)) {
		throw new Error('The requesting renderer is unavailable.');
	}
	const channel = new MessageChannelMain();
	authority.acceptRendererPort(channel.port1 as unknown as ServerMessagePort);
	sender.postMessage(
		'server:connection',
		{
			connectionId: randomUUID(),
			label: 'Local',
			replacement,
			serverId: authority.service.serverId,
		},
		[channel.port2],
	);
}

async function openSettingsWindow(
	sectionId?: string,
	requester?: Electron.WebContents,
): Promise<void> {
	// Page.close can resolve before the native BrowserWindow has emitted
	// `closed`. Serialize replacement creation behind that native boundary.
	await settingsWindowCloseBarrier;
	const preloadPath = path.join(__dirname, 'preload.mjs');
	const windowIconPath = getWindowIconPath();

	if (
		settingsWindow &&
		!settingsWindow.isDestroyed() &&
		!settingsWindow.webContents.isDestroyed()
	) {
		await rebindAuxiliaryServerConnection(settingsWindow, requester);
		settingsWindow.focus();
		if (sectionId) {
			settingsWindow.webContents.send('settings:focus-section', { sectionId });
		}
		return;
	}
	// Playwright and native close paths can destroy the renderer just before
	// BrowserWindow emits `closed`. Never focus that stale singleton or make the
	// caller wait forever for a window that cannot emit another page.
	settingsWindow = null;

	const isMac = process.platform === 'darwin';
	const usesOverlayTitlebar = process.platform === 'win32';

	const createdSettingsWindow = new BrowserWindow({
		icon: windowIconPath,
		width: 1320,
		height: 860,
		minWidth: 980,
		minHeight: 700,
		title: 'Terminay Settings',
		titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
		titleBarOverlay: usesOverlayTitlebar
			? {
					color: '#0d1117',
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
		autoHideMenuBar: shouldAutoHideMenuBar(),
		backgroundColor: '#0d1117',
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	settingsWindow = createdSettingsWindow;
	securePrimaryWindow(createdSettingsWindow);
	attachAuxiliaryServerConnection(createdSettingsWindow, requester);

	bindNativeWindowCloseBarrier(createdSettingsWindow, (barrier) => {
		settingsWindowCloseBarrier = barrier;
	});
	bindSingletonWindowLifecycle(
		createdSettingsWindow,
		() => settingsWindow,
		(value) => {
			settingsWindow = value;
		},
	);

	if (VITE_DEV_SERVER_URL) {
		const target = new URL(VITE_DEV_SERVER_URL);
		target.searchParams.set('view', 'settings');
		if (sectionId) {
			target.searchParams.set('section', sectionId);
		}
		createdSettingsWindow.loadURL(target.toString());
	} else {
		createdSettingsWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
			query: sectionId
				? { view: 'settings', section: sectionId }
				: { view: 'settings' },
		});
	}
}

async function connectRemoteServer(
	event: Electron.IpcMainInvokeEvent,
	rawUrl: unknown,
	pairingPin?: string,
): Promise<void> {
	const pairingUrl = normalizeRemoteConnectionUrl(rawUrl);
	if (isRemoteAccessPairingUrl(pairingUrl) && pairingPin === undefined) {
		throw new Error(
			'Enter the six-digit Remote Access pairing PIN for this device link.',
		);
	}
	// A server URL copied from the standalone server's readiness log is the
	// application-protocol handoff and must continue to connect with no extra
	// field.  Device pairing is an explicit PIN-bearing flow: its URL has the
	// same fragment shape, so fragment inspection alone cannot select it.
	const intent = resolveDesktopConnectionIntent(pairingPin);
	if (intent.kind === 'device-pairing') {
		const credentialStore = createDesktopDeviceCredentialStore();
		const paired = await establishDesktopDevicePairing({
			deviceName: `${app.getName()} Desktop`,
			pairingPin: intent.pairingPin,
			pairingUrl,
			store: credentialStore,
		});
		const connected = await createDesktopReconnectTransport({
			origin: paired.origin,
			store: credentialStore,
		});
		const profile = rememberRemoteConnection(
			paired.origin,
			new URL(paired.origin).host,
			'device',
		);
		if (connected.signalingBootstrap !== undefined) {
			try {
				const webRtcConnection = await createDesktopBootstrappedWebRtcConnection({
					bootstrap: connected.signalingBootstrap,
					expectedOrigin: paired.origin,
				});
				await connected.transport.close({ code: 'normal' });
				if (!VITE_DEV_SERVER_URL) {
					const current = BrowserWindow.fromWebContents(event.sender);
					if (current === null) throw new Error('The target window is unavailable.');
					await openCanonicalRemoteServerWindow(current, profile, paired.origin, webRtcConnection);
					return;
				}
				await connectRemoteByteTransport(
					event.sender,
					webRtcConnection.transport,
					new URL(paired.origin).host,
					paired.origin,
					profile,
				);
				return;
			} catch (error) {
				await connected.transport.close({ code: 'normal' });
				throw error;
			}
		}
		await connectRemoteByteTransport(
			event.sender,
			connected.transport,
			new URL(paired.origin).host,
			paired.origin,
			profile,
		);
		return;
	}
	// A standalone server hands out a structured fragment credential too. Do
	// not reject it based on fragment shape: the framed stream transport is
	// authoritative and accepts the token without ever retaining the URL.
	const { bootstrap, transport: remoteTransport } = createRemoteStreamTransport(
		pairingUrl,
		{
			WebSocket:
				WebSocket as unknown as import('@terminay/client-core').WebSocketConstructorLike,
		},
	);
	const profileClientId = `desktop-profile-${randomUUID()}`;
	await enrollDesktopReconnectCredential({
		authToken: bootstrap.authToken,
		clientId: profileClientId,
		deviceName: `${app.getName()} Desktop`,
		origin: bootstrap.origin,
		store: createDesktopDeviceCredentialStore(),
	});
	const profile = rememberRemoteConnection(
		bootstrap.origin,
		new URL(bootstrap.origin).host,
		'device',
	);
	await connectRemoteByteTransport(
		event.sender,
		remoteTransport,
		new URL(bootstrap.origin).host,
		bootstrap.origin,
		profile,
	);
}

async function openCanonicalRemoteServerWindow(
	current: BrowserWindow,
	profile: RememberedRemoteConnection,
	origin: string,
	connection: Awaited<ReturnType<typeof createDesktopBootstrappedWebRtcConnection>>,
): Promise<void> {
	const launch = await remoteServerUiBundleHost.prepareRemote({
		lane: connection.assets,
		origin,
		profileId: profile.id,
		serverId: connection.serverId,
		windowId: `window-${randomUUID()}`,
	});
	const replacement = createWindow({
		serverUiLaunch: launch,
		serverUiTransport: connection.transport,
	});
	if (replacement === null) throw new Error('Desktop is closing.');
	remoteProfileBindingsByWebContents.set(replacement.webContents.id, profile.id);
	current.close();
}

async function connectRemoteByteTransport(
	sender: Electron.WebContents,
	remoteTransport: ByteTransport,
	label: string,
	origin: string,
	profile: RememberedRemoteConnection,
): Promise<void> {
	const scopeId = `remote-${randomUUID()}`;
	const window = BrowserWindow.fromWebContents(sender);
	if (window === null || window.isDestroyed() || !appWindows.has(window)) {
		throw new Error('The target renderer is unavailable.');
	}
	const channel = new MessageChannelMain();
	const mainPort = new ServerScopedMessagePort(
		channel.port1 as unknown as ServerMessagePort,
		scopeId,
	);
	const rendererTransport = new ServerPortTransport(mainPort);
	let isClosed = false;
	let handshakeSettled = false;
	let resolveHandshake: () => void = () => {};
	let rejectHandshake: (error: unknown) => void = () => {};
	const handshake = new Promise<void>((resolve, reject) => {
		resolveHandshake = resolve;
		rejectHandshake = reject;
	});

	const close = async (): Promise<void> => {
		if (isClosed) return;
		isClosed = true;
		if (!handshakeSettled) {
			handshakeSettled = true;
			rejectHandshake(
				new Error('The remote client connection closed before handshake.'),
			);
		}
		await Promise.allSettled([
			remoteTransport.close({ code: 'normal' }),
			rendererTransport.close({ code: 'normal' }),
		]);
	};
	const fail = (error: unknown): void => {
		if (!handshakeSettled) {
			handshakeSettled = true;
			rejectHandshake(
				error instanceof Error ? error : new Error(String(error)),
			);
		}
		void close();
	};

	const forwardRendererFrames = async (): Promise<void> => {
		try {
			for await (const frame of rendererTransport.incoming) {
				if (isClosed) return;
				// The selected server bundle owns the application protocol. The
				// privileged host validates only the bounded byte endpoint and forwards
				// feature frames without decoding operation names or payloads.
				await remoteTransport.send(frame);
			}
			if (!isClosed) fail(new Error('Remote client transport closed.'));
		} catch (error) {
			if (!isClosed) fail(error);
		}
	};

	const forwardServerFrames = async (): Promise<void> => {
		try {
			for await (const frame of remoteTransport.incoming) {
				if (isClosed) return;
				await rendererTransport.send(frame);
				// Bootstrap negotiation is the one stable envelope the host owns. Once
				// established, all application frames remain opaque to Desktop.
				if (!handshakeSettled) {
					const envelope = decodeFrame(frame).envelope;
					if (envelope.type === 'server_hello') {
						handshakeSettled = true;
						resolveHandshake();
					} else if (envelope.type === 'error') {
						handshakeSettled = true;
						rejectHandshake(new Error(envelope.error.message));
					}
				}
			}
			if (!isClosed) fail(new Error('Remote server transport closed.'));
		} catch (error) {
			if (!isClosed) fail(error);
		}
	};

	await remoteTransport.open();
	await rendererTransport.open();
	sender.once('destroyed', () => {
		const activeConnection = activeRemoteByteConnectionsByWebContents.get(
			sender.id,
		);
		if (activeConnection?.scopeId === scopeId) {
			activeRemoteByteConnectionsByWebContents.delete(sender.id);
		}
		void close();
	});
	void forwardRendererFrames();
	void forwardServerFrames();
	const previous =
		activeRemoteByteConnectionsByWebContents.get(sender.id) ?? null;
	const connection: RemoteHttpConnection = {
		close,
		label: profile.label || label,
		origin,
		profileId: profile.id,
		scopeId,
	};
	activeRemoteByteConnectionsByWebContents.set(sender.id, connection);
	remoteProfileBindingsByWebContents.set(sender.id, profile.id);
	if (previous !== null && previous.scopeId !== scopeId) {
		await previous.close();
	}

	// Electron can resolve an ipcRenderer.invoke before the renderer is ready
	// to receive a MessagePort posted from that very invoke handler.  Unlike
	// the normal did-finish-load connection, that transfer is then silently
	// lost: the URL dialog closes but RendererEntry never sees a remote
	// authority.  Defer only the port transfer to the next main-process turn;
	// the bridge is already installed and the invoke can return immediately.
	const postRemoteConnection = () => {
		if (isClosed || sender.isDestroyed()) return;
		try {
			sender.postMessage(
				'server:connection',
				{ connectionId: randomUUID(), serverId: scopeId, label },
				[channel.port2],
			);
		} catch (error) {
			fail(error);
		}
	};
	const hasLoadedApp = sender.getURL() !== '' && !sender.isLoadingMainFrame();
	if (hasLoadedApp) {
		setImmediate(postRemoteConnection);
	} else {
		sender.once('did-finish-load', () => {
			setImmediate(postRemoteConnection);
		});
	}

	// The renderer must receive this transferred port and send client_hello in
	// order to settle `handshake`. Awaiting that handshake from ipcRenderer.invoke
	// can defer the renderer's delivery of the port and deadlock the Connect
	// modal. Install the bridge synchronously, return to the renderer, then
	// supervise its handshake in the background.
	let handshakeTimeout: ReturnType<typeof setTimeout> | undefined;
	void Promise.race([
		handshake,
		new Promise<never>((_resolve, reject) => {
			handshakeTimeout = setTimeout(() => {
				reject(
					new Error(
						'The remote server did not complete its protocol handshake within 15 seconds. Check the server URL, pairing expiry, and server logs.',
					),
				);
			}, 15_000);
		}),
	])
		.catch(async () => {
			const activeConnection = activeRemoteByteConnectionsByWebContents.get(
				sender.id,
			);
			if (activeConnection?.scopeId === scopeId) {
				activeRemoteByteConnectionsByWebContents.delete(sender.id);
			}
			await close();
		})
		.finally(() => {
			if (handshakeTimeout !== undefined) clearTimeout(handshakeTimeout);
		});
}

async function reconnectRememberedRemoteProfile(
	sender: Electron.WebContents,
	profile: RememberedRemoteConnection,
): Promise<void> {
	const connected = await createDesktopReconnectTransport({
		origin: profile.origin,
		store: createDesktopDeviceCredentialStore(),
	});
	if (connected.signalingBootstrap === undefined) {
		await connectRemoteByteTransport(
			sender,
			connected.transport,
			profile.label,
			profile.origin,
			profile,
		);
		return;
	}
	try {
		const webRtcConnection = await createDesktopBootstrappedWebRtcConnection({
			bootstrap: connected.signalingBootstrap,
			expectedOrigin: profile.origin,
		});
		await connected.transport.close({ code: 'normal' });
		if (!VITE_DEV_SERVER_URL) {
			const current = BrowserWindow.fromWebContents(sender);
			if (current === null) throw new Error('The target window is unavailable.');
			await openCanonicalRemoteServerWindow(current, profile, profile.origin, webRtcConnection);
			return;
		}
		await connectRemoteByteTransport(
			sender,
			webRtcConnection.transport,
			profile.label,
			profile.origin,
			profile,
		);
	} catch (error) {
		await connected.transport.close({ code: 'normal' });
		throw error;
	}
}

async function openMacrosWindow(
	requester?: Electron.WebContents,
): Promise<void> {
	const preloadPath = path.join(__dirname, 'preload.mjs');
	const windowIconPath = getWindowIconPath();

	if (macrosWindow && !macrosWindow.isDestroyed()) {
		await rebindAuxiliaryServerConnection(macrosWindow, requester);
		macrosWindow.focus();
		return;
	}

	const isMac = process.platform === 'darwin';
	const usesOverlayTitlebar = process.platform === 'win32';

	macrosWindow = new BrowserWindow({
		icon: windowIconPath,
		width: 1100,
		height: 760,
		minWidth: 860,
		minHeight: 620,
		title: 'Terminay Macros',
		titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
		titleBarOverlay: usesOverlayTitlebar
			? {
					color: '#0d1117',
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
		autoHideMenuBar: shouldAutoHideMenuBar(),
		backgroundColor: '#0d1117',
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	securePrimaryWindow(macrosWindow);
	attachAuxiliaryServerConnection(macrosWindow, requester);

	macrosWindow.on('closed', () => {
		macrosWindow = null;
	});

	if (VITE_DEV_SERVER_URL) {
		macrosWindow.loadURL(`${VITE_DEV_SERVER_URL}?view=macros`);
	} else {
		macrosWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
			query: { view: 'macros' },
		});
	}
}

async function openRecordingsWindow(
	requester?: Electron.WebContents,
): Promise<void> {
	const preloadPath = path.join(__dirname, 'preload.mjs');
	const windowIconPath = getWindowIconPath();

	if (recordingsWindow && !recordingsWindow.isDestroyed()) {
		await rebindAuxiliaryServerConnection(recordingsWindow, requester);
		recordingsWindow.focus();
		return;
	}

	const isMac = process.platform === 'darwin';
	const usesOverlayTitlebar = process.platform === 'win32';

	recordingsWindow = new BrowserWindow({
		icon: windowIconPath,
		width: 1180,
		height: 780,
		minWidth: 900,
		minHeight: 640,
		title: 'Terminay Recordings',
		titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
		titleBarOverlay: usesOverlayTitlebar
			? {
					color: '#0d1117',
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
		autoHideMenuBar: shouldAutoHideMenuBar(),
		backgroundColor: '#0d1117',
		webPreferences: {
			preload: preloadPath,
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	securePrimaryWindow(recordingsWindow);
	attachAuxiliaryServerConnection(recordingsWindow, requester);

	recordingsWindow.on('closed', () => {
		recordingsWindow = null;
	});

	if (VITE_DEV_SERVER_URL) {
		recordingsWindow.loadURL(`${VITE_DEV_SERVER_URL}?view=recordings`);
	} else {
		recordingsWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
			query: { view: 'recordings' },
		});
	}
}

type ProjectEnvironmentWindowIntent = Readonly<{
	providerId: string;
	mode: 'profile' | 'environment';
	profileId?: string;
}>;
async function openProjectEnvironmentsWindow(
	requester?: Electron.WebContents,
	intent?: ProjectEnvironmentWindowIntent,
): Promise<void> {
	if (
		projectEnvironmentsWindow &&
		!projectEnvironmentsWindow.isDestroyed() &&
		!projectEnvironmentsWindow.webContents.isDestroyed()
	) {
		await rebindAuxiliaryServerConnection(projectEnvironmentsWindow, requester);
		if (intent !== undefined) {
			projectEnvironmentsWindow.webContents.send(
				'desktop:project-environments-host:intent',
				intent,
			);
		}
		projectEnvironmentsWindow.focus();
		return;
	}
	projectEnvironmentsWindow = null;
	const isMac = process.platform === 'darwin';
	const usesOverlayTitlebar = process.platform === 'win32';
	const createdWindow = new BrowserWindow({
		icon: getWindowIconPath(),
		width: 1180,
		height: 780,
		minWidth: 900,
		minHeight: 640,
		title: 'Terminay Project Environments',
		titleBarStyle: isMac || usesOverlayTitlebar ? 'hidden' : 'default',
		titleBarOverlay: usesOverlayTitlebar
			? { color: '#0d1117', symbolColor: '#9bb0c8', height: 38 }
			: false,
		trafficLightPosition: isMac ? { x: 14, y: 12 } : undefined,
		autoHideMenuBar: shouldAutoHideMenuBar(),
		backgroundColor: '#0d1117',
		webPreferences: {
			preload: path.join(__dirname, 'preload.mjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
	});
	projectEnvironmentsWindow = createdWindow;
	securePrimaryWindow(createdWindow);
	attachAuxiliaryServerConnection(createdWindow, requester);
	createdWindow.on('closed', () => {
		if (projectEnvironmentsWindow === createdWindow)
			projectEnvironmentsWindow = null;
	});
	if (VITE_DEV_SERVER_URL) {
		const target = new URL(VITE_DEV_SERVER_URL);
		target.searchParams.set('view', 'project-environments');
		if (intent !== undefined) {
			target.searchParams.set('providerId', intent.providerId);
			target.searchParams.set('mode', intent.mode);
			if (intent.profileId !== undefined) {
				target.searchParams.set('profileId', intent.profileId);
			}
		}
		void createdWindow.loadURL(target.toString());
	} else {
		void createdWindow.loadFile(path.join(RENDERER_DIST, 'index.html'), {
			query: {
				view: 'project-environments',
				...(intent === undefined
					? {}
					: {
							providerId: intent.providerId,
							mode: intent.mode,
							...(intent.profileId === undefined
								? {}
								: { profileId: intent.profileId }),
						}),
			},
		});
	}
}

function getEditWindowUrl(kind: EditWindowState['kind']): string {
	if (VITE_DEV_SERVER_URL) {
		const target = new URL(VITE_DEV_SERVER_URL);
		target.searchParams.set('view', 'edit-tab');
		target.searchParams.set('kind', kind);
		return target.toString();
	}

	return path.join(RENDERER_DIST, 'index.html');
}

function openEditWindow(
	parentWindow: BrowserWindow | null,
	state: EditWindowState,
): Promise<ProjectEditWindowResult | TerminalEditWindowResult | null> {
	const preloadPath = path.join(__dirname, 'preload.mjs');
	const windowIconPath = getWindowIconPath();
	const height = state.kind === 'project' ? 700 : 640;

	return new Promise((resolve) => {
		const editWindow = new BrowserWindow({
			parent: parentWindow ?? undefined,
			modal: true,
			icon: windowIconPath,
			useContentSize: true,
			width: 500,
			height,
			minWidth: 500,
			maxWidth: 500,
			minHeight: height,
			maxHeight: height,
			title:
				state.kind === 'project' ? 'Edit Project Tab' : 'Edit Terminal Tab',
			// On macOS, 'panel' prevents the window from becoming a "sheet"
			// while modal: true is set, allowing for a native title bar.
			type: process.platform === 'darwin' ? 'panel' : undefined,
			titleBarStyle: 'default',
			autoHideMenuBar: shouldAutoHideMenuBar(),
			backgroundColor: '#0d0f12',
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			resizable: true,
			show: false,
			webPreferences: {
				preload: preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
				webviewTag: false,
			},
		});
		securePrimaryWindow(editWindow);
		attachAuxiliaryServerConnection(editWindow);
		const editWindowWebContentsId = editWindow.webContents.id;

		const settle = (
			result: ProjectEditWindowResult | TerminalEditWindowResult | null,
		) => {
			const pending = pendingEditWindows.get(editWindowWebContentsId);
			if (!pending || pending.settled) {
				return;
			}

			pending.settled = true;
			pendingEditWindows.delete(editWindowWebContentsId);
			resolve(result);
			setImmediate(() => {
				if (parentWindow !== null && !parentWindow.isDestroyed())
					parentWindow.focus();
			});
		};

		pendingEditWindows.set(editWindowWebContentsId, {
			resolve: settle,
			settled: false,
			state,
			window: editWindow,
		});

		editWindow.once('ready-to-show', () => {
			editWindow.show();
		});

		const lifecycle = bindAuxiliaryWindowLifecycle(editWindow, () =>
			settle(null),
		);

		if (VITE_DEV_SERVER_URL) {
			lifecycle.observeLoad(editWindow.loadURL(getEditWindowUrl(state.kind)));
			return;
		}

		lifecycle.observeLoad(
			editWindow.loadFile(getEditWindowUrl(state.kind), {
				query: {
					kind: state.kind,
					view: 'edit-tab',
				},
			}),
		);
	});
}

function setDockIcon(): void {
	if (process.platform !== 'darwin') {
		return;
	}

	const iconPath =
		getBrandAssetPath('icon.icns') ?? getBrandAssetPath('terminay.png');

	if (!iconPath) {
		return;
	}

	const icon = nativeImage.createFromPath(iconPath);
	if (icon.isEmpty()) {
		return;
	}

	app.dock?.setIcon(icon);
}

function readTerminalRecordingStartMetadata(
	value: unknown,
): TerminalRecordingStartMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	const input = value as Record<string, unknown>;
	const metadata: TerminalRecordingStartMetadata = {};
	for (const key of [
		'color',
		'emoji',
		'projectColor',
		'projectEmoji',
		'projectId',
		'projectTitle',
		'title',
	] as const) {
		const field = input[key];
		if (typeof field === 'string') {
			metadata[key] = field;
		}
	}

	if (typeof input.inheritsProjectColor === 'boolean') {
		metadata.inheritsProjectColor = input.inheritsProjectColor;
	}

	return metadata;
}

const DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION = 1 as const;

function readRecordingServiceRequest(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new TypeError('recording service host request is invalid');
	}
	const request = value as Record<string, unknown>;
	if (
		request.version !== DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION ||
		Object.keys(request).length !== keys.length ||
		!keys.every((key) => hasOwn(request, key))
	) {
		throw new TypeError('recording service host request is invalid');
	}
	return request;
}

function readOptionalRecordingServiceRequest(
	value: unknown,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
): Record<string, unknown> {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		throw new TypeError('recording service host request is invalid');
	}
	const request = value as Record<string, unknown>;
	const acceptedKeys = new Set([...requiredKeys, ...optionalKeys]);
	if (
		request.version !== DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION ||
		!requiredKeys.every((key) => hasOwn(request, key)) ||
		Object.keys(request).some((key) => !acceptedKeys.has(key))
	) {
		throw new TypeError('recording service host request is invalid');
	}
	return request;
}

function readRecordingServiceId(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 512)
		throw new TypeError(`${label} is invalid`);
	return value;
}

/** A framed renderer client may lose its MessagePort while its BrowserWindow
 * remains alive. Rehydrate only the trusted requesting renderer; this is not
 * a new server/session and never changes PTY ownership. */
ipcMain.handle(
	'server:connection:rehydrate',
	(event, payload?: { serverId?: unknown }) => {
		assertTrustedAppSender(event);
		const authority = serverTerminalAuthority;
		if (
			authority === null ||
			payload?.serverId !== authority.service.serverId
		) {
			throw new Error('The requested server connection is unavailable.');
		}
		postLocalServerConnection(event.sender, true);
	},
);

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

ipcMain.on(
	'desktop:terminal-presentation-host:update-metadata',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('terminal presentation host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 5 ||
			request.version !== 1 ||
			typeof request.serverId !== 'string' ||
			request.serverId.length === 0 ||
			request.serverId.length > 512
		) {
			throw new TypeError('terminal presentation host request is invalid');
		}
		if (request.serverId !== serverTerminalAuthority?.service.serverId) {
			return;
		}
		if (
			typeof request.projectId !== 'string' ||
			request.projectId.length === 0 ||
			request.projectId.length > 128 ||
			typeof request.sessionId !== 'string' ||
			request.sessionId.length === 0 ||
			request.sessionId.length > 512 ||
			typeof request.metadata !== 'object' ||
			request.metadata === null ||
			Array.isArray(request.metadata)
		) {
			throw new TypeError('terminal presentation host request is invalid');
		}
		const metadata = request.metadata as Record<string, unknown>;
		const allowed = new Set([
			'color',
			'emoji',
			'inheritsProjectColor',
			'projectColor',
			'projectEmoji',
			'projectId',
			'projectTitle',
			'title',
			'viewportHeight',
			'viewportWidth',
		]);
		for (const [key, value] of Object.entries(metadata)) {
			if (!allowed.has(key))
				throw new TypeError('terminal presentation metadata is invalid');
			if (key === 'inheritsProjectColor') {
				if (typeof value !== 'boolean')
					throw new TypeError('terminal presentation metadata is invalid');
			} else if (key === 'viewportHeight' || key === 'viewportWidth') {
				if (
					typeof value !== 'number' ||
					!Number.isFinite(value) ||
					value < 0 ||
					value > 100_000
				) {
					throw new TypeError('terminal presentation metadata is invalid');
				}
			} else if (typeof value !== 'string' || value.length > 16_384) {
				throw new TypeError('terminal presentation metadata is invalid');
			}
		}
		const serverSession = serverTerminalAuthority?.get(request.sessionId);
		if (!serverSession || serverSession.projectId !== request.projectId) {
			return;
		}
		recordingService.updateSessionMetadata(request.sessionId, {
			color: typeof metadata.color === 'string' ? metadata.color : undefined,
			cwd: undefined,
			emoji: typeof metadata.emoji === 'string' ? metadata.emoji : undefined,
			projectColor:
				typeof metadata.projectColor === 'string'
					? metadata.projectColor
					: undefined,
			projectEmoji:
				typeof metadata.projectEmoji === 'string'
					? metadata.projectEmoji
					: undefined,
			projectId:
				typeof metadata.projectId === 'string' ? metadata.projectId : undefined,
			projectTitle:
				typeof metadata.projectTitle === 'string'
					? metadata.projectTitle
					: undefined,
			title: typeof metadata.title === 'string' ? metadata.title : undefined,
		});
	},
);

ipcMain.handle('desktop:terminal-presentation-host:get-zoom', (event) => {
	assertTrustedAppSender(event);
	return terminalZoomLevel;
});

ipcMain.handle(
	'desktop:terminal-lifecycle-host:wait-for-inactivity',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('terminal lifecycle host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 3 ||
			request.version !== 1 ||
			typeof request.sessionId !== 'string' ||
			request.sessionId.length === 0 ||
			request.sessionId.length > 512 ||
			typeof request.durationMs !== 'number' ||
			!Number.isSafeInteger(request.durationMs) ||
			request.durationMs < 0 ||
			request.durationMs > 86_400_000
		) {
			throw new TypeError('terminal lifecycle host request is invalid');
		}
		const session = serverTerminalAuthority?.get(request.sessionId);
		if (
			!session ||
			session.projectId !== request.projectId ||
			!serverTerminalAuthority.isConsumerAttached(
				session.id,
				request.clientId as string,
			)
		) {
			throw new Error('That terminal is not attached to this server client.');
		}
		await serverTerminalAuthority.waitForInactivity(
			session.id,
			request.durationMs,
		);
	},
);

ipcMain.handle(
	'desktop:recording-service-host:get-state',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readRecordingServiceRequest(payload, [
			'version',
			'sessionId',
		]);
		return recordingService.getState(
			readRecordingServiceId(request.sessionId, 'recording session id'),
		);
	},
);

ipcMain.handle(
	'desktop:recording-service-host:start',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readOptionalRecordingServiceRequest(
			payload,
			['version', 'sessionId'],
			['metadata'],
		);
		const sessionId = readRecordingServiceId(
			request.sessionId,
			'recording session id',
		);
		const session = serverTerminalAuthority?.get(sessionId);
		if (session?.status !== 'running') {
			throw new Error('That terminal session no longer exists.');
		}
		if (
			!serverTerminalAuthority.isRendererAttached(session.id, event.sender.id)
		) {
			throw new Error('That terminal is not attached to this renderer.');
		}

		// CWD can follow a foreground child process, while the shell must remain
		// the immutable launch shell captured by the authority at creation time.
		const cwd = (await resolveTerminalProcessCwd(session.pid)) ?? session.cwd;
		return recordingService.start(sessionId, {
			...readTerminalRecordingStartMetadata(request.metadata),
			cwd,
			projectId: session.projectId,
			shell: session.shellPath,
		});
	},
);

ipcMain.handle(
	'desktop:recording-service-host:stop',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readRecordingServiceRequest(payload, [
			'version',
			'sessionId',
		]);
		const sessionId = readRecordingServiceId(
			request.sessionId,
			'recording session id',
		);
		const session = serverTerminalAuthority?.get(sessionId);
		if (session?.status !== 'running') {
			throw new Error('That terminal session no longer exists.');
		}
		if (
			!serverTerminalAuthority.isRendererAttached(session.id, event.sender.id)
		) {
			throw new Error('That terminal is not attached to this renderer.');
		}
		const state = recordingService.finalize(sessionId, null);
		if (readTerminalSettings().recording.openTimelineAfterSaving) {
			openRecordingsWindow();
		}
		return state;
	},
);

ipcMain.handle(
	'desktop:recording-service-host:list',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		readRecordingServiceRequest(payload, ['version']);
		return recordingService.listRecordings();
	},
);

ipcMain.handle(
	'desktop:recording-service-host:read-chunk',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readOptionalRecordingServiceRequest(
			payload,
			['version', 'recordingId'],
			['start', 'maxBytes'],
		);
		const recordingId = readRecordingServiceId(
			request.recordingId,
			'recording id',
		);
		for (const key of ['start', 'maxBytes'] as const) {
			const value = request[key];
			if (
				value !== undefined &&
				(typeof value !== 'number' ||
					!Number.isSafeInteger(value) ||
					value < 0 ||
					value > 16 * 1024 * 1024)
			) {
				throw new TypeError(`recording chunk ${key} is invalid`);
			}
		}
		return recordingService.readRecordingChunk({
			...(request.maxBytes === undefined
				? {}
				: { maxBytes: request.maxBytes as number }),
			...(request.start === undefined
				? {}
				: { start: request.start as number }),
			recordingId,
		});
	},
);

ipcMain.handle(
	'desktop:recording-service-host:delete',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readRecordingServiceRequest(payload, [
			'version',
			'recordingId',
		]);
		return recordingService.deleteRecordingById(
			readRecordingServiceId(request.recordingId, 'recording id'),
		);
	},
);

ipcMain.handle(
	'desktop:recording-service-host:reveal',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		const request = readRecordingServiceRequest(payload, [
			'version',
			'recordingId',
		]);
		shell.showItemInFolder(
			await recordingService.resolveRevealPathById(
				readRecordingServiceId(request.recordingId, 'recording id'),
			),
		);
	},
);

ipcMain.handle(
	'desktop:file-explorer-host:get-home-path',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 1 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('Invalid file explorer host request');
		}
		return app.getPath('home');
	},
);

ipcMain.handle(
	'fs:list-directory',
	async (event, payload: { dirPath: string }) => {
		assertTrustedAppSender(event);
		return readDirectoryEntries(payload.dirPath);
	},
);

ipcMain.handle(
	'fs:search-files',
	async (
		event,
		payload: { rootPath: string; query: string; limit?: number },
	) => {
		assertTrustedAppSender(event);
		return searchFiles(payload.rootPath, payload.query, payload.limit);
	},
);

ipcMain.handle(
	'fs:calculate-folder-size',
	(event, payload: { jobId: string; path: string }) => {
		assertTrustedAppSender(event);
		return runFolderSizeJob(event.sender, payload);
	},
);

ipcMain.handle('fs:cancel-folder-size', (event, payload: { jobId: string }) => {
	assertTrustedAppSender(event);
	const job = folderSizeJobs.get(payload.jobId);
	if (job) {
		job.cancelled = true;
	}
});

ipcMain.handle(
	'fs:rename',
	async (event, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
		assertTrustedAppSender(event);
		await rename(oldPath, newPath);
	},
);

ipcMain.handle('fs:delete', async (event, { path }: { path: string }) => {
	assertTrustedAppSender(event);
	await rm(path, { recursive: true, force: true });
});

ipcMain.handle('fs:mkdir', async (event, { path }: { path: string }) => {
	assertTrustedAppSender(event);
	await mkdir(path, { recursive: true });
});

ipcMain.handle(
	'fs:watch-directory',
	async (event, { path }: { path: string }) => {
		assertTrustedAppSender(event);
		fileExplorerWatchService.watchDirectory(event.sender.id, path);
	},
);

ipcMain.handle(
	'fs:unwatch-directory',
	async (event, { path }: { path: string }) => {
		assertTrustedAppSender(event);
		fileExplorerWatchService.unwatchDirectory(event.sender.id, path);
	},
);

ipcMain.handle('settings:get-terminal', (event) => {
	assertTrustedAppSender(event);
	return readTerminalSettings();
});

ipcMain.handle(
	'settings:update-terminal',
	async (event, payload: TerminalSettings) => {
		assertTrustedAppSender(event);
		const settings = writeTerminalSettings(payload);
		broadcastTerminalSettings(settings);
		createAppMenu(settings);
		applyControlServerSetting();
		await applyAgentIntegrationSetting(settings);
		return settings;
	},
);

ipcMain.handle('settings:reset-terminal', async (event) => {
	assertTrustedAppSender(event);
	const settings = writeTerminalSettings(defaultTerminalSettings);
	broadcastTerminalSettings(settings);
	createAppMenu(settings);
	applyControlServerSetting();
	await applyAgentIntegrationSetting(settings);
	return settings;
});

ipcMain.handle('macros:get', (event) => {
	assertTrustedAppSender(event);
	return readMacros();
});

ipcMain.handle('macros:update', (event, payload: MacroDefinition[]) => {
	assertTrustedAppSender(event);
	const macros = writeMacros(payload);
	broadcastMacros(macros);
	return macros;
});

ipcMain.handle('macros:reset', (event) => {
	assertTrustedAppSender(event);
	const macros = writeMacros(defaultMacros);
	broadcastMacros(macros);
	return macros;
});

// --- Multi-window project tabs (tear-off, re-merge) -----------------------

function isWorkspaceTransferPayload(
	value: unknown,
): value is AdoptedProjectPayload {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		Object.getPrototypeOf(value) !== Object.prototype
	) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (
		!hasOwn(candidate, 'project') ||
		!hasOwn(candidate, 'terminals') ||
		typeof candidate.project !== 'object' ||
		candidate.project === null ||
		Array.isArray(candidate.project) ||
		Object.getPrototypeOf(candidate.project) !== Object.prototype ||
		!Array.isArray(candidate.terminals) ||
		candidate.terminals.length > 512
	)
		return false;
	if (
		candidate.activeSessionId !== undefined &&
		candidate.activeSessionId !== null &&
		(typeof candidate.activeSessionId !== 'string' ||
			candidate.activeSessionId.length > 512)
	)
		return false;
	return candidate.terminals.every((terminal) => {
		if (
			typeof terminal !== 'object' ||
			terminal === null ||
			Array.isArray(terminal) ||
			Object.getPrototypeOf(terminal) !== Object.prototype
		)
			return false;
		const sessionId = (terminal as Record<string, unknown>).sessionId;
		return (
			typeof sessionId === 'string' &&
			sessionId.length > 0 &&
			sessionId.length <= 512
		);
	});
}

// A freshly torn-off window pulls its adopted project once on boot.
ipcMain.handle(
	'desktop:workspace-transfer-host:bind-view',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1 ||
			typeof (payload as { viewId?: unknown }).viewId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(
				(payload as { viewId: string }).viewId,
			)
		)
			throw new TypeError('desktop workspace view binding is invalid');
		workspaceViewByWebContents.set(
			event.sender.id,
			(payload as { viewId: string }).viewId,
		);
	},
);

ipcMain.handle(
	'desktop:workspace-transfer-host:get-adopted-project',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 1 ||
			(payload as { version?: unknown }).version !== 1
		)
			throw new TypeError('desktop workspace transfer host request is invalid');
		const adoptedProject = pendingAdoptedProjects.get(event.sender.id);
		if (adoptedProject !== undefined) {
			pendingAdoptedProjects.delete(event.sender.id);
		}
		return adoptedProject ?? null;
	},
);

// Pop a project tab out into its own window near the drop point.
ipcMain.handle(
	'desktop:workspace-transfer-host:popout-project',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 5 ||
			(payload as { version?: unknown }).version !== 1
		)
			throw new TypeError('desktop workspace transfer host request is invalid');
		const request = payload as Record<string, unknown>;
		if (
			!isWorkspaceTransferPayload(request.project) ||
			typeof request.targetViewId !== 'string' ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.targetViewId) ||
			typeof request.x !== 'number' ||
			!Number.isFinite(request.x) ||
			Math.abs(request.x) > 100_000 ||
			typeof request.y !== 'number' ||
			!Number.isFinite(request.y) ||
			Math.abs(request.y) > 100_000
		)
			throw new TypeError('desktop workspace transfer host request is invalid');
		const project = request.project;
		if (
			!serverTerminalAuthority ||
			!project.terminals.every(
				(terminal) =>
					serverTerminalAuthority.get(terminal.sessionId) !== undefined,
			)
		) {
			return { ok: false };
		}
		const window = createWindow({
			bounds: { x: request.x, y: request.y },
			workspaceViewId: request.targetViewId,
		});
		if (!window) return { ok: false };

		for (const terminal of project.terminals) {
			reassignSessionOwner(
				terminal.sessionId,
				event.sender.id,
				window.webContents.id,
			);
		}
		return { ok: true, windowId: window.webContents.id };
	},
);

// Move a project tab into an already-open window's tab bar.
ipcMain.handle(
	'desktop:workspace-transfer-host:merge-project',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 3 ||
			(payload as { version?: unknown }).version !== 1
		)
			throw new TypeError('desktop workspace transfer host request is invalid');
		const request = payload as Record<string, unknown>;
		if (
			!isWorkspaceTransferPayload(request.project) ||
			typeof request.targetWindowId !== 'number' ||
			!Number.isSafeInteger(request.targetWindowId) ||
			request.targetWindowId < 1 ||
			request.targetWindowId > 2_147_483_647
		)
			throw new TypeError('desktop workspace transfer host request is invalid');
		const project = request.project;
		const target = webContents.fromId(request.targetWindowId);
		if (!target || target.isDestroyed()) return { ok: false };
		if (
			!serverTerminalAuthority ||
			!project.terminals.every(
				(terminal) =>
					serverTerminalAuthority.get(terminal.sessionId) !== undefined,
			)
		) {
			return { ok: false };
		}

		for (const terminal of project.terminals) {
			reassignSessionOwner(terminal.sessionId, event.sender.id, target.id);
		}
		if (!workspaceViewByWebContents.has(target.id)) {
			target.send('app:adopt-project', project);
		}
		BrowserWindow.fromWebContents(target)?.focus();
		return { ok: true };
	},
);

// Closing the native window is a bounded lifecycle operation rather than a
// broad application renderer capability.
ipcMain.handle(
	'desktop:window-lifecycle-host:close-current',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('desktop window lifecycle host request is invalid');
		}
		const confirmedRunningWork = (payload as { confirmedRunningWork?: unknown })
			.confirmedRunningWork;
		if (typeof confirmedRunningWork !== 'boolean') {
			throw new TypeError('desktop window lifecycle confirmation is invalid');
		}
		const target = BrowserWindow.fromWebContents(event.sender);
		if (!target || target.isDestroyed()) return;
		if (confirmedRunningWork) {
			confirmedWindowCloseWebContents.add(event.sender.id);
		}
		target.close();
	},
);

ipcMain.handle(
	'desktop:window-lifecycle-host:publish-running-terminals',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1 ||
			!Array.isArray((payload as { sessionIds?: unknown }).sessionIds)
		)
			throw new TypeError('desktop running terminal publication is invalid');
		const sessionIds = (payload as { sessionIds: unknown[] }).sessionIds;
		if (
			sessionIds.length > 4_096 ||
			sessionIds.some(
				(value) =>
					typeof value !== 'string' ||
					!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value),
			)
		)
			throw new TypeError('desktop running terminal session ids are invalid');
		runningTerminalSessionsByWindow.set(
			event.sender.id,
			new Set(sessionIds as string[]),
		);
	},
);

ipcMain.handle(
	'desktop:window-lifecycle-host:confirm-close',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 3 ||
			(payload as { version?: unknown }).version !== 1
		)
			throw new TypeError('desktop close confirmation request is invalid');
		const { kind, runningTerminalCount } = payload as {
			kind: unknown;
			runningTerminalCount: unknown;
		};
		if (
			(kind !== 'terminal' && kind !== 'project') ||
			typeof runningTerminalCount !== 'number' ||
			!Number.isSafeInteger(runningTerminalCount) ||
			runningTerminalCount < 1 ||
			runningTerminalCount > 4_096
		)
			throw new TypeError('desktop close confirmation scope is invalid');
		const target = BrowserWindow.fromWebContents(event.sender);
		if (!target || target.isDestroyed()) return false;
		const result = await dialog.showMessageBox(
			target,
			createCloseConfirmationDialog(
				kind as DestructiveCloseKind,
				runningTerminalCount,
			),
		);
		return result.response === 0;
	},
);

// Each project-host window may publish only its own bounded tab-bar geometry.
ipcMain.handle(
	'desktop:project-tab-host:publish-bar-rect',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1 ||
			!hasOwn(payload, 'rect')
		) {
			throw new TypeError('desktop project-tab host request is invalid');
		}
		const rect = (payload as { rect: unknown }).rect;
		if (rect === null) {
			tabBarRectsByWebContents.delete(event.sender.id);
			return;
		}
		if (
			typeof rect !== 'object' ||
			Array.isArray(rect) ||
			Object.getPrototypeOf(rect) !== Object.prototype ||
			Object.keys(rect).length !== 4 ||
			!['height', 'width', 'x', 'y'].every((key) => hasOwn(rect, key))
		) {
			throw new TypeError('desktop project-tab host rectangle is invalid');
		}
		const candidate = rect as Record<string, unknown>;
		if (
			typeof candidate.x !== 'number' ||
			!Number.isFinite(candidate.x) ||
			Math.abs(candidate.x) > 100_000 ||
			typeof candidate.y !== 'number' ||
			!Number.isFinite(candidate.y) ||
			Math.abs(candidate.y) > 100_000 ||
			typeof candidate.width !== 'number' ||
			!Number.isFinite(candidate.width) ||
			candidate.width < 0 ||
			candidate.width > 100_000 ||
			typeof candidate.height !== 'number' ||
			!Number.isFinite(candidate.height) ||
			candidate.height < 0 ||
			candidate.height > 100_000
		) {
			throw new TypeError('desktop project-tab host rectangle is invalid');
		}
		tabBarRectsByWebContents.set(event.sender.id, {
			height: candidate.height,
			width: candidate.width,
			x: candidate.x,
			y: candidate.y,
		});
	},
);

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
// Transparent padding around the ghost card so its drop shadow isn't clipped.
const GHOST_PADDING = 24;
const GHOST_HEIGHT = 56;

let projectDragPollTimer: ReturnType<typeof setInterval> | null = null;
let projectDragSourceWebContentsId: number | null = null;
let projectDragHoverTargetId: number | null = null;
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
		const rect = tabBarRectsByWebContents.get(webContentsId);
		if (!rect) {
			return null;
		}
		const content = window.getContentBounds();
		return {
			x: content.x + rect.x,
			y: content.y + rect.y,
			width: rect.width,
			height: rect.height,
		};
	}
	return null;
}

function getAppWindowByWebContentsId(
	webContentsId: number,
): BrowserWindow | null {
	for (const window of appWindows) {
		if (!window.isDestroyed() && window.webContents.id === webContentsId) {
			return window;
		}
	}
	return null;
}

function getActiveRemoteConnection(
	sender: Electron.WebContents,
): RemoteHttpConnection | null {
	return activeRemoteByteConnectionsByWebContents.get(sender.id) ?? null;
}

function getRemoteConnectionWindow(profileId: string): BrowserWindow | null {
	const pendingWindow = pendingRemoteConnectionWindowsByProfile.get(profileId);
	if (
		pendingWindow !== undefined &&
		!pendingWindow.isDestroyed() &&
		appWindows.has(pendingWindow)
	) {
		return pendingWindow;
	}
	if (pendingWindow !== undefined) {
		pendingRemoteConnectionWindowsByProfile.delete(profileId);
	}
	for (const [
		webContentsId,
		connection,
	] of activeRemoteByteConnectionsByWebContents) {
		if (connection.profileId !== profileId) continue;
		const window = getAppWindowByWebContentsId(webContentsId);
		if (window !== null) return window;
	}
	return null;
}

function isPendingRemoteConnectionWindow(window: BrowserWindow): boolean {
	for (const pendingWindow of pendingRemoteConnectionWindowsByProfile.values()) {
		if (pendingWindow === window) return true;
	}
	return false;
}

function getLocalConnectionWindow(): BrowserWindow | null {
	for (const window of appWindows) {
		if (
			!window.isDestroyed() &&
			!isPendingRemoteConnectionWindow(window) &&
			!activeRemoteByteConnectionsByWebContents.has(window.webContents.id)
		) {
			return window;
		}
	}
	return null;
}

async function closeRemoteConnectionsForProfile(
	profileId: string,
): Promise<void> {
	const pendingWindow = pendingRemoteConnectionWindowsByProfile.get(profileId);
	pendingRemoteConnectionWindowsByProfile.delete(profileId);
	if (pendingWindow !== undefined && !pendingWindow.isDestroyed()) {
		pendingWindow.close();
	}
	const closing: Array<Promise<void>> = [];
	for (const [
		webContentsId,
		connection,
	] of activeRemoteByteConnectionsByWebContents) {
		if (connection.profileId !== profileId) continue;
		activeRemoteByteConnectionsByWebContents.delete(webContentsId);
		closing.push(connection.close());
	}
	await Promise.all(closing);
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

// Clears the in-bar drop placeholder on whichever window previously had it, and
// remembers the new hover target. The per-tick "active" message (with the live
// cursor X for the insertion index) is sent from the poll loop, not here.
function setProjectDragHoverTarget(targetId: number | null): void {
	if (targetId === projectDragHoverTargetId) {
		return;
	}

	if (projectDragHoverTargetId !== null) {
		const previous = webContents.fromId(projectDragHoverTargetId);
		if (previous && !previous.isDestroyed()) {
			previous.send('app:project-drag-hover', { active: false });
		}
	}

	projectDragHoverTargetId = targetId;
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

function hideTabGhostWindow(): void {
	if (
		tabGhostWindow &&
		!tabGhostWindow.isDestroyed() &&
		tabGhostWindow.isVisible()
	) {
		tabGhostWindow.hide();
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
		source?.send('app:project-tab-torn-off', { active: true });
	} else {
		destroyTabGhostWindow();
		setProjectDragHoverTarget(null);
		source?.send('app:project-tab-torn-off', { active: false });
	}
}

function stopProjectDragTracking(): void {
	if (projectDragPollTimer) {
		clearInterval(projectDragPollTimer);
		projectDragPollTimer = null;
	}
	setProjectDragHoverTarget(null);
	destroyTabGhostWindow();
	projectDragTornOff = false;
	projectDragSourceWebContentsId = null;
	projectDragPreview = null;
}

ipcMain.handle(
	'desktop:project-tab-host:start-drag',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1 ||
			!hasOwn(payload, 'preview')
		) {
			throw new TypeError('desktop project-tab host request is invalid');
		}
		const preview = (payload as { preview: unknown }).preview;
		if (
			typeof preview !== 'object' ||
			preview === null ||
			Array.isArray(preview) ||
			Object.getPrototypeOf(preview) !== Object.prototype ||
			Object.keys(preview).length !== 4 ||
			!['color', 'emoji', 'title', 'width'].every((key) => hasOwn(preview, key))
		) {
			throw new TypeError('desktop project-tab drag preview is invalid');
		}
		const candidate = preview as Record<string, unknown>;
		if (
			typeof candidate.title !== 'string' ||
			candidate.title.length > 512 ||
			typeof candidate.emoji !== 'string' ||
			candidate.emoji.length > 64 ||
			typeof candidate.color !== 'string' ||
			!/^#[0-9a-fA-F]{3,8}$/.test(candidate.color) ||
			typeof candidate.width !== 'number' ||
			!Number.isFinite(candidate.width) ||
			candidate.width < 80 ||
			candidate.width > 2_000
		) {
			throw new TypeError('desktop project-tab drag preview is invalid');
		}
		projectDragSourceWebContentsId = event.sender.id;
		projectDragPreview = {
			color: candidate.color,
			emoji: candidate.emoji,
			title: candidate.title,
			width: candidate.width,
		};
		projectDragTornOff = false;
		if (projectDragPollTimer) {
			clearInterval(projectDragPollTimer);
		}
		projectDragPollTimer = setInterval(() => {
			const point = screen.getCursorScreenPoint();
			const sourceId = projectDragSourceWebContentsId;
			const sourceBar = getBarScreenRect(sourceId);

			if (!projectDragTornOff) {
				// Still docked: tear off only once the cursor is dragged far enough away
				// from the source tab bar.
				if (
					sourceBar &&
					distanceToRect(point, sourceBar) > PROJECT_TAB_TEAR_OFF_DISTANCE
				) {
					setProjectTabTornOff(true);
				}
				return;
			}

			// Torn off: re-dock if the cursor returns to the source bar.
			if (sourceBar && pointInRect(point, sourceBar)) {
				setProjectTabTornOff(false);
				return;
			}

			const hit = findAppWindowTabBarAtPoint(point);
			const target = hit !== null && hit !== sourceId ? hit : null;
			setProjectDragHoverTarget(target);

			if (target !== null) {
				// Over another window's bar: hide the floating ghost and let that window
				// render a real in-bar placeholder at the cursor's insertion point, so the
				// user can slot it into the exact position (Chrome-style). Forward the
				// cursor as a viewport-relative X for that window's index calculation.
				hideTabGhostWindow();
				const targetWindow = getAppWindowByWebContentsId(target);
				const viewportX = targetWindow
					? point.x - targetWindow.getContentBounds().x
					: point.x;
				targetWindow?.webContents.send('app:project-drag-hover', {
					active: true,
					clientX: viewportX,
					preview: projectDragPreview,
				});
				return;
			}

			moveTabGhostToCursor(point);
		}, 16);
	},
);

ipcMain.handle(
	'desktop:project-tab-host:end-drag',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype ||
			Object.keys(payload).length !== 1 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('desktop project-tab host request is invalid');
		}
		const sourceId = projectDragSourceWebContentsId;
		const wasTornOff = projectDragTornOff;
		const hoverTargetId = projectDragHoverTargetId;
		if (projectDragPollTimer) {
			clearInterval(projectDragPollTimer);
			projectDragPollTimer = null;
		}
		destroyTabGhostWindow();
		projectDragTornOff = false;
		projectDragSourceWebContentsId = null;
		projectDragPreview = null;
		projectDragHoverTargetId = null;

		const point = screen.getCursorScreenPoint();
		const hit = findAppWindowTabBarAtPoint(point);
		const source = webContents.fromId(sourceId ?? -1);

		const clearPlaceholder = (id: number | null) => {
			if (id === null) {
				return;
			}
			const wc = webContents.fromId(id);
			if (wc && !wc.isDestroyed()) {
				wc.send('app:project-drag-hover', { active: false });
			}
		};

		// Never torn off, or dropped back on its own bar — a plain reorder.
		if (!wasTornOff || hit === sourceId) {
			clearPlaceholder(hoverTargetId);
			source?.send('app:project-tab-torn-off', { active: false });
			return { action: 'reorder' as const };
		}

		// Merge: leave the drop target's in-bar placeholder up so adoptProject can
		// replace it in place (no flicker). Clear any other stale placeholder.
		if (hit !== null) {
			const targetViewId = workspaceViewByWebContents.get(hit);
			if (targetViewId === undefined) {
				clearPlaceholder(hit);
				source?.send('app:project-tab-torn-off', { active: false });
				return { action: 'reorder' as const };
			}
			if (hoverTargetId !== hit) {
				clearPlaceholder(hoverTargetId);
			}
			return { action: 'merge' as const, targetWindowId: hit, targetViewId };
		}

		clearPlaceholder(hoverTargetId);
		return { action: 'popout' as const, x: point.x, y: point.y };
	},
);

/**
 * Narrow, versioned host capability used by the production workspace for
 * explicit release/documentation links. This is the sole renderer route to
 * the native shell; app services never receive shell authority.
 */
ipcMain.handle(
	'desktop:external-host:open',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('desktop external host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 2 ||
			request.version !== 1 ||
			typeof request.url !== 'string'
		) {
			throw new TypeError('desktop external host request is invalid');
		}
		await openInBrowser(request.url);
	},
);

/**
 * Versioned native clipboard capability. Clipboard access is native-host
 * presentation state, never an application-service capability.
 */
ipcMain.handle('desktop:clipboard-host:read', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError('desktop clipboard host request is invalid');
	}
	const request = payload as Record<string, unknown>;
	if (Object.keys(request).length !== 1 || request.version !== 1) {
		throw new TypeError('desktop clipboard host request is invalid');
	}
	return smartPasteClipboardContents();
});

ipcMain.handle('desktop:clipboard-host:write', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError('desktop clipboard host request is invalid');
	}
	const request = payload as Record<string, unknown>;
	if (
		Object.keys(request).length !== 2 ||
		request.version !== 1 ||
		typeof request.text !== 'string' ||
		request.text.length === 0 ||
		request.text.length > 1_048_576
	) {
		throw new TypeError('desktop clipboard host request is invalid');
	}
	clipboard.writeText(request.text);
});

/**
 * Versioned, least-authority bridge for the current-server picker.  The
 * current Desktop renderer reaches this separately exposed native-host
 * capability rather than the broad preload object.
 */
ipcMain.handle(
	'desktop:connection-host:open',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('desktop connection host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			(Object.keys(request).length !== 2 &&
				Object.keys(request).length !== 3) ||
			request.version !== 1 ||
			typeof request.url !== 'string' ||
			request.url.length === 0 ||
			request.url.length > 16_384
		) {
			throw new TypeError('desktop connection host request is invalid');
		}
		if (
			request.pairingPin !== undefined &&
			(typeof request.pairingPin !== 'string' || request.pairingPin.length > 32)
		) {
			throw new TypeError('desktop connection host request is invalid');
		}
		return connectRemoteServer(
			event,
			request.url,
			request.pairingPin as string | undefined,
		);
	},
);

ipcMain.handle('desktop:connection-host:list', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload) ||
		Object.keys(payload).length !== 1 ||
		(payload as { version?: unknown }).version !== 1
	) {
		throw new TypeError('desktop connection host request is invalid');
	}
	const localServerId = serverTerminalAuthority?.service.serverId;
	const activeRemoteConnection = getActiveRemoteConnection(event.sender);
	loadRememberedRemoteConnections();
	const profiles: Array<{
		id: string;
		isLocal?: boolean;
		label: string;
		origin: string;
		serverId: string;
		selected: boolean;
		status: string;
	}> = [];
	if (localServerId !== undefined) {
		profiles.push({
			id: localServerId,
			isLocal: true,
			label: 'Local',
			origin: 'http://127.0.0.1',
			serverId: localServerId,
			selected: activeRemoteConnection === null,
			status: 'connected',
		});
	}
	for (const profile of rememberedRemoteConnections.values()) {
		const active = activeRemoteConnection?.profileId === profile.id;
		profiles.push({
			id: profile.id,
			label: profile.label,
			origin: profile.origin,
			serverId: profile.id,
			selected: active,
			status:
				profile.kind === 'standalone'
					? 'needs setup'
					: active
						? 'connected'
						: 'offline',
		});
	}
	return Object.freeze({ profiles: Object.freeze(profiles) });
});

ipcMain.handle(
	'desktop:connection-host:select',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('desktop connection host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 2 ||
			request.version !== 1 ||
			typeof request.profileId !== 'string' ||
			request.profileId.length === 0 ||
			request.profileId.length > 512
		) {
			throw new TypeError('desktop connection host request is invalid');
		}
		const localServerId = serverTerminalAuthority?.service.serverId;
		if (request.profileId === localServerId) {
			const localWindow = getLocalConnectionWindow() ?? createWindow();
			if (localWindow !== null) {
				localWindow.focus();
			}
			return;
		}
		const existingWindow = getRemoteConnectionWindow(request.profileId);
		if (existingWindow !== null) {
			existingWindow.focus();
			return;
		}
		loadRememberedRemoteConnections();
		const profile = rememberedRemoteConnections.get(request.profileId);
		if (profile === undefined) {
			throw new Error('The requested connection profile is unavailable.');
		}
		if (profile.kind !== 'device') {
			throw new Error(
				'This saved connection was created without reconnect credentials. Add it again with a fresh server URL to make it switchable.',
			);
		}
		const targetWindow = createWindow({ initialServerConnection: 'deferred' });
		if (targetWindow === null) {
			throw new Error('Unable to open a window for the requested connection.');
		}
		pendingRemoteConnectionWindowsByProfile.set(profile.id, targetWindow);
		targetWindow.focus();
		try {
			await reconnectRememberedRemoteProfile(targetWindow.webContents, profile);
		} catch (error) {
			if (
				!targetWindow.isDestroyed() &&
				getActiveRemoteConnection(targetWindow.webContents) === null
			) {
				targetWindow.close();
			}
			throw error;
		} finally {
			if (
				pendingRemoteConnectionWindowsByProfile.get(profile.id) === targetWindow
			) {
				pendingRemoteConnectionWindowsByProfile.delete(profile.id);
			}
		}
	},
);

function requireMutableDesktopConnectionProfile(payload: unknown): {
	profileId: string;
} {
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError('desktop connection host request is invalid');
	}
	const request = payload as Record<string, unknown>;
	if (
		request.version !== 1 ||
		typeof request.profileId !== 'string' ||
		request.profileId.length === 0 ||
		request.profileId.length > 512
	) {
		throw new TypeError('desktop connection host request is invalid');
	}
	const localServerId = serverTerminalAuthority?.service.serverId;
	if (request.profileId === localServerId) {
		throw new Error('Local profile is immutable');
	}
	loadRememberedRemoteConnections();
	if (!rememberedRemoteConnections.has(request.profileId)) {
		throw new Error('The requested connection profile is unavailable.');
	}
	return { profileId: request.profileId };
}

ipcMain.handle('desktop:connection-host:rename', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	const request = requireMutableDesktopConnectionProfile(payload);
	const value = payload as Record<string, unknown>;
	if (
		Object.keys(value).length !== 3 ||
		typeof value.label !== 'string' ||
		value.label.trim().length === 0 ||
		value.label.length > 128
	) {
		throw new TypeError('desktop connection host request is invalid');
	}
	const profile = rememberedRemoteConnections.get(request.profileId);
	if (profile === undefined)
		throw new Error('The requested connection profile is unavailable.');
	profile.label = value.label.trim();
	for (const connection of activeRemoteByteConnectionsByWebContents.values()) {
		if (connection.profileId === request.profileId) {
			connection.label = profile.label;
		}
	}
	saveRememberedRemoteConnections();
});

ipcMain.handle(
	'desktop:connection-host:forget',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		requireMutableDesktopConnectionProfile(payload);
		if (Object.keys(payload as Record<string, unknown>).length !== 2) {
			throw new TypeError('desktop connection host request is invalid');
		}
		const request = payload as { profileId: string };
		await closeRemoteConnectionsForProfile(request.profileId);
		rememberedRemoteConnections.delete(request.profileId);
		saveRememberedRemoteConnections();
	},
);

ipcMain.handle(
	'desktop:connection-host:revoke',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		requireMutableDesktopConnectionProfile(payload);
		if (Object.keys(payload as Record<string, unknown>).length !== 2) {
			throw new TypeError('desktop connection host request is invalid');
		}
		const request = payload as { profileId: string };
		const profile = rememberedRemoteConnections.get(request.profileId);
		if (profile !== undefined) {
			const credentialStore = createDesktopDeviceCredentialStore();
			await Promise.all([
				closeRemoteConnectionsForProfile(request.profileId),
				credentialStore.remove(profile.origin),
			]);
			rememberedRemoteConnections.delete(profile.id);
			saveRememberedRemoteConnections();
		}
	},
);

/**
 * Native file reveal is deliberately a narrow workspace capability. A server
 * bundle never receives the broad compatibility preload object, and malformed
 * or relative paths cannot reach the operating-system shell.
 */
ipcMain.handle('desktop:reveal-host:reveal', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError('desktop reveal host request is invalid');
	}
	const request = payload as Record<string, unknown>;
	if (
		Object.keys(request).length !== 2 ||
		request.version !== 1 ||
		typeof request.filePath !== 'string' ||
		request.filePath.length === 0 ||
		request.filePath.length > 32_768 ||
		!path.isAbsolute(request.filePath)
	) {
		throw new TypeError('desktop reveal host request is invalid');
	}
	shell.showItemInFolder(request.filePath);
});

ipcMain.handle(
	'desktop:update-host:get-status',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('desktop update host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 2 ||
			request.version !== 1 ||
			typeof request.force !== 'boolean'
		) {
			throw new TypeError('desktop update host request is invalid');
		}
		return getAppUpdateStatus({ force: request.force });
	},
);

ipcMain.handle(
	'desktop:project-edit-host:open',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		) {
			throw new TypeError('desktop project edit host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			Object.keys(request).length !== 3 ||
			request.version !== 1 ||
			typeof request.projectId !== 'string' ||
			request.projectId.length === 0 ||
			request.projectId.length > 128 ||
			typeof request.draft !== 'object' ||
			request.draft === null ||
			Array.isArray(request.draft)
		) {
			throw new TypeError('desktop project edit host request is invalid');
		}
		const draft = request.draft as Record<string, unknown>;
		if (
			Object.keys(draft).length !== 10 ||
			typeof draft.color !== 'string' ||
			draft.color.length > 128 ||
			(draft.defaultShellProfileId !== null &&
				(typeof draft.defaultShellProfileId !== 'string' ||
					draft.defaultShellProfileId.length === 0 ||
					draft.defaultShellProfileId.length > 128)) ||
			typeof draft.environmentLabel !== 'string' ||
			draft.environmentLabel.length === 0 ||
			draft.environmentLabel.length > 512 ||
			typeof draft.environmentStatus !== 'string' ||
			draft.environmentStatus.length === 0 ||
			draft.environmentStatus.length > 128 ||
			(draft.environmentDefaultRoot !== null &&
				(typeof draft.environmentDefaultRoot !== 'string' ||
					draft.environmentDefaultRoot.length > 32_768)) ||
			typeof draft.projectEnvironmentId !== 'string' ||
			draft.projectEnvironmentId.length === 0 ||
			draft.projectEnvironmentId.length > 128 ||
			typeof draft.emoji !== 'string' ||
			draft.emoji.length > 64 ||
			typeof draft.rootFolder !== 'string' ||
			draft.rootFolder.length > 32_768 ||
			!Array.isArray(draft.shellProfileOptions) ||
			draft.shellProfileOptions.length > 65 ||
			draft.shellProfileOptions.some(
				(option) =>
					typeof option !== 'object' ||
					option === null ||
					Array.isArray(option) ||
					Object.keys(option).length !== 3 ||
					typeof (option as Record<string, unknown>).id !== 'string' ||
					((option as Record<string, unknown>).id as string).length === 0 ||
					((option as Record<string, unknown>).id as string).length > 128 ||
					typeof (option as Record<string, unknown>).name !== 'string' ||
					((option as Record<string, unknown>).name as string).length === 0 ||
					((option as Record<string, unknown>).name as string).length > 128 ||
					typeof (option as Record<string, unknown>).available !== 'boolean',
			) ||
			new Set(
				draft.shellProfileOptions.map(
					(option) => (option as Record<string, unknown>).id,
				),
			).size !== draft.shellProfileOptions.length ||
			typeof draft.title !== 'string' ||
			draft.title.length > 512
		) {
			throw new TypeError('desktop project edit host request is invalid');
		}
		const parentWindow =
			BrowserWindow.fromWebContents(event.sender) ??
			BrowserWindow.getFocusedWindow() ??
			null;
		const result = await openEditWindow(parentWindow, {
			draft: draft as ProjectEditWindowDraft,
			kind: 'project',
			projectId: request.projectId as string,
		});

		if (!result) {
			return null;
		}

		return result as ProjectEditWindowResult;
	},
);

ipcMain.handle(
	'app:open-terminal-edit',
	async (event, draft: TerminalEditWindowDraft) => {
		assertTrustedAppSender(event);
		const parentWindow =
			BrowserWindow.fromWebContents(event.sender) ??
			BrowserWindow.getFocusedWindow() ??
			null;
		const result = await openEditWindow(parentWindow, {
			draft,
			kind: 'terminal',
		});

		if (!result) {
			return null;
		}

		return result as TerminalEditWindowResult;
	},
);

ipcMain.handle('app:get-edit-window-state', (event) => {
	assertTrustedAppSender(event);
	const pending = pendingEditWindows.get(event.sender.id);
	return pending?.state ?? null;
});

ipcMain.handle(
	'app:submit-edit-window-result',
	async (event, result: EditWindowResult) => {
		assertTrustedAppSender(event);
		const pending = pendingEditWindows.get(event.sender.id);
		if (!pending) {
			return;
		}

		if (pending.state.kind !== result.kind) {
			throw new Error(
				`Mismatched edit window result kind: expected ${pending.state.kind}, received ${result.kind}.`,
			);
		}
		if (result.kind === 'project') {
			const candidate = result.result as unknown;
			if (
				typeof candidate !== 'object' ||
				candidate === null ||
				Array.isArray(candidate)
			)
				throw new TypeError('project edit result is invalid');
			const value = candidate as Record<string, unknown>;
			if (
				Object.keys(value).length !== 5 ||
				typeof value.color !== 'string' ||
				value.color.length > 128 ||
				(value.defaultShellProfileId !== null &&
					(typeof value.defaultShellProfileId !== 'string' ||
						value.defaultShellProfileId.length === 0 ||
						value.defaultShellProfileId.length > 128)) ||
				typeof value.emoji !== 'string' ||
				value.emoji.length > 64 ||
				typeof value.rootFolder !== 'string' ||
				value.rootFolder.length > 32_768 ||
				typeof value.title !== 'string' ||
				value.title.length > 512
			)
				throw new TypeError('project edit result is invalid');
			const shellProfileOptions =
				pending.state.kind === 'project'
					? pending.state.draft.shellProfileOptions
					: [];
			const originalProfileId =
				pending.state.kind === 'project'
					? pending.state.draft.defaultShellProfileId
					: null;
			if (
				value.defaultShellProfileId !== null &&
				!shellProfileOptions.some(
					(profile) =>
						profile.id === value.defaultShellProfileId &&
						(profile.available || profile.id === originalProfileId),
				)
			)
				throw new TypeError('project shell profile selection is invalid');
		}

		pending.resolve(result.result);
		if (!pending.window.isDestroyed()) {
			pending.window.close();
		}
	},
);

ipcMain.handle('remote:get-status', async (event) => {
	assertTrustedAppSender(event);
	return currentRemoteAccessStatus();
});

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

function broadcastRemoteAccessStatus(): void {
	const status = currentRemoteAccessStatus();
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed() && !window.webContents.isDestroyed())
			window.webContents.send('remote:status-changed', status);
	}
}

ipcMain.handle('remote:toggle-server', async (event) => {
	assertTrustedAppSender(event);
	let status: RemoteAccessStatus;
	if (usesPrivilegedWebRtcExposure()) {
		for (const session of serverTerminalAuthority?.list() ?? []) {
			if (!privilegedWebRtcSessions.has(session.id)) {
				privilegedWebRtcSessions.add(session.id);
				privilegedWebRtcExposure!.service.ensureSession(session.id);
			}
			const dimensions = serverTerminalAuthority?.service.getSession(
				session.id,
			)?.dimensions;
			if (dimensions !== undefined)
				privilegedWebRtcExposure!.service.updateSessionSize(
					session.id,
					dimensions.cols,
					dimensions.rows,
				);
		}
		status = await privilegedWebRtcExposure!.toggle();
	} else {
		status = await desktopRemoteExposure.toggle();
	}
	broadcastRemoteAccessStatus();
	return status;
});

ipcMain.handle('remote:toggle-direct-listener', async (event) => {
	assertTrustedAppSender(event);
	await desktopDirectNetworkExposure.toggle();
	const status = currentRemoteAccessStatus();
	broadcastRemoteAccessStatus();
	return status;
});

ipcMain.handle(
	'remote:revoke-device',
	async (event, payload: { deviceId: string }) => {
		assertTrustedAppSender(event);
		const status = usesPrivilegedWebRtcExposure()
			? await privilegedWebRtcExposure!.service.revokeDevice(payload.deviceId)
			: await desktopRemoteExposure.revokeDevice(payload.deviceId);
		broadcastRemoteAccessStatus();
		return status;
	},
);

ipcMain.handle(
	'remote:close-connection',
	async (event, payload: { connectionId: string }) => {
		assertTrustedAppSender(event);
		const status = usesPrivilegedWebRtcExposure()
			? await privilegedWebRtcExposure!.service.closeConnection(
					payload.connectionId,
				)
			: desktopRemoteExposure.closeConnection(payload.connectionId);
		broadcastRemoteAccessStatus();
		return status;
	},
);

ipcMain.handle(
	'remote:set-pairing-address',
	async (event, payload: { address: string }) => {
		assertTrustedAppSender(event);
		if (!desktopDirectNetworkExposure.getStatus().isRunning) {
			desktopDirectNetworkExposure.setPairingAddress(payload.address);
		}
		usesPrivilegedWebRtcExposure()
			? await privilegedWebRtcExposure!.service.setPairingAddress(
					payload.address,
				)
			: desktopRemoteExposure.setPairingAddress(payload.address);
		const status = currentRemoteAccessStatus();
		broadcastRemoteAccessStatus();
		return status;
	},
);

ipcMain.handle('remote:set-pairing-pin', (event, payload: { pin: string }) => {
	assertTrustedAppSender(event);
	const currentSettings = readTerminalSettings();
	const pairingPinHash = createPairingPinHash(payload.pin);
	writeRemotePairingPinVerifier(pairingPinHash);
	const settings = writeTerminalSettings({
		...currentSettings,
		remoteAccess: {
			...currentSettings.remoteAccess,
			pairingPinHash,
		},
	});
	broadcastTerminalSettings(settings);
	privilegedWebRtcExposure?.service.notifyStatusChanged();
	createAppMenu(settings);
	return settings;
});

ipcMain.handle('remote:get-pairing-pin-status', (event) => {
	assertTrustedAppSender(event);
	return readTerminalSettings().remoteAccess.pairingPinHash.trim().length > 0;
});

ipcMain.handle(
	'desktop:settings-window-host:open',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype
		) {
			throw new TypeError('desktop settings window host request is invalid');
		}
		const request = payload as Record<string, unknown>;
		if (
			request.version !== 1 ||
			!Object.keys(request).every(
				(key) => key === 'version' || key === 'sectionId',
			) ||
			(request.sectionId !== undefined &&
				(typeof request.sectionId !== 'string' ||
					request.sectionId.length > 128))
		) {
			throw new TypeError('desktop settings window host request is invalid');
		}
		await openSettingsWindow(request.sectionId, event.sender);
	},
);

ipcMain.handle(
	'desktop:project-environments-host:open',
	async (event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.getPrototypeOf(payload) !== Object.prototype
		)
			throw new TypeError(
				'desktop project environments host request is invalid',
			);
		const request = payload as Record<string, unknown>;
		if (
			(Object.keys(request).length !== 1 &&
				Object.keys(request).length !== 2) ||
			request.version !== 1
		)
			throw new TypeError(
				'desktop project environments host request is invalid',
			);
		let intent: ProjectEnvironmentWindowIntent | undefined;
		if (request.intent !== undefined) {
			if (
				typeof request.intent !== 'object' ||
				request.intent === null ||
				Array.isArray(request.intent)
			)
				throw new TypeError(
					'desktop project environments host request is invalid',
				);
			const value = request.intent as Record<string, unknown>;
			if (
				!['profile', 'environment'].includes(String(value.mode)) ||
				typeof value.providerId !== 'string' ||
				value.providerId.length > 256 ||
				(value.profileId !== undefined &&
					(typeof value.profileId !== 'string' || value.profileId.length > 256))
			)
				throw new TypeError(
					'desktop project environments host request is invalid',
				);
			intent = {
				providerId: value.providerId,
				mode: value.mode as 'profile' | 'environment',
				...(value.profileId === undefined
					? {}
					: { profileId: value.profileId as string }),
			};
		}
		await openProjectEnvironmentsWindow(event.sender, intent);
	},
);

ipcMain.handle('desktop:recordings-host:open', (event, payload: unknown) => {
	assertTrustedAppSender(event);
	if (
		typeof payload !== 'object' ||
		payload === null ||
		Array.isArray(payload)
	) {
		throw new TypeError('desktop recordings host request is invalid');
	}
	const request = payload as Record<string, unknown>;
	if (Object.keys(request).length !== 1 || request.version !== 1) {
		throw new TypeError('desktop recordings host request is invalid');
	}
	void openRecordingsWindow(event.sender);
});

if (process.env.TERMINAY_TEST === '1') {
	ipcMain.handle('test:list-remote-protocol-connections', (event) => {
		assertTrustedAppSender(event);
		return embeddedLanExposure.testProtocolConnectionIds();
	});

	ipcMain.handle(
		'test:fail-remote-protocol-connection',
		async (event, payload?: { connectionId?: unknown }) => {
			assertTrustedAppSender(event);
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
			assertTrustedAppSender(event);
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
			const token =
				controlTokensBySession.get(terminalSessionId) ??
				registerControlToken(terminalSessionId, event.sender.id);
			return {
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
			assertTrustedAppSender(event);
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
			assertTrustedAppSender(event);
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

ipcMain.handle(
	'desktop:mcp-install-host:get-status',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.keys(payload).length !== 1 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('MCP install host request is invalid');
		}
		return getMcpInstallStatus();
	},
);

ipcMain.handle(
	'desktop:mcp-install-host:install',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('MCP install host request is invalid');
		}
		const agent = (payload as { agent?: unknown }).agent;
		if (agent !== 'claudeCode' && agent !== 'codex')
			throw new TypeError('MCP install agent is invalid');
		return installMcpAgent(agent, getMcpServerCommand());
	},
);

ipcMain.handle(
	'desktop:mcp-install-host:uninstall',
	(event, payload: unknown) => {
		assertTrustedAppSender(event);
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload) ||
			Object.keys(payload).length !== 2 ||
			(payload as { version?: unknown }).version !== 1
		) {
			throw new TypeError('MCP install host request is invalid');
		}
		const agent = (payload as { agent?: unknown }).agent;
		if (agent !== 'claudeCode' && agent !== 'codex')
			throw new TypeError('MCP install agent is invalid');
		return uninstallMcpAgent(agent);
	},
);

const rendererRootDiagnosticKeys = new Map<number, Set<string>>();

function readTerminalRecoveryDiagnosticPayload(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return undefined;
	const payload = value as Record<string, unknown>;
	if (
		Object.keys(payload).some(
			(key) =>
				![
					'attempt',
					'durationMs',
					'fromPosition',
					'outputPosition',
					'phase',
					'reason',
					'replayFrom',
					'version',
				].includes(key),
		)
	)
		return undefined;
	const optionalPosition = (candidate: unknown) =>
		candidate === undefined ||
		(Number.isSafeInteger(candidate) && (candidate as number) >= 0);
	if (
		payload.version !== 1 ||
		!['started', 'retrying', 'recovered', 'failed'].includes(
			String(payload.phase),
		) ||
		!Number.isSafeInteger(payload.attempt) ||
		(payload.attempt as number) <= 0 ||
		(payload.attempt as number) > 1_000_000 ||
		!optionalPosition(payload.durationMs) ||
		!optionalPosition(payload.fromPosition) ||
		!optionalPosition(payload.replayFrom) ||
		!optionalPosition(payload.outputPosition) ||
		(payload.reason !== undefined &&
			!['congestion', 'attach-error', 'deadline'].includes(
				String(payload.reason),
			))
	)
		return undefined;
	return payload;
}

const terminalRecoveryEventNames = {
	started: 'terminal.recovery.started',
	retrying: 'terminal.recovery.retrying',
	recovered: 'terminal.recovery.recovered',
	failed: 'terminal.recovery.failed',
} as const;

function readRendererRootDiagnosticPayload(value: unknown):
	| {
			readonly phase: 'bootstrap-import' | 'react-root';
			readonly name: string;
			readonly message: string;
			readonly stack?: string;
			readonly componentStack?: string;
	  }
	| undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return undefined;
	const payload = value as Record<string, unknown>;
	if (
		Object.keys(payload).some(
			(key) =>
				![
					'componentStack',
					'message',
					'name',
					'phase',
					'stack',
					'version',
				].includes(key),
		)
	)
		return undefined;
	const bounded = (candidate: unknown, maxBytes: number, optional = false) =>
		(optional && candidate === undefined) ||
		(typeof candidate === 'string' &&
			Buffer.byteLength(candidate, 'utf8') <= maxBytes);
	if (
		payload.version !== 1 ||
		(payload.phase !== 'bootstrap-import' && payload.phase !== 'react-root') ||
		!bounded(payload.name, 128) ||
		!bounded(payload.message, 2_048) ||
		!bounded(payload.stack, 6_144, true) ||
		!bounded(payload.componentStack, 3_072, true)
	)
		return undefined;
	return payload as {
		readonly phase: 'bootstrap-import' | 'react-root';
		readonly name: string;
		readonly message: string;
		readonly stack?: string;
		readonly componentStack?: string;
	};
}

ipcMain.on(
	'desktop:diagnostics-host:report-root-error',
	(event, value: unknown) => {
		assertTrustedAppSender(event);
		const payload = readRendererRootDiagnosticPayload(value);
		if (payload === undefined) return;
		let keys = rendererRootDiagnosticKeys.get(event.sender.id);
		if (keys === undefined) {
			keys = new Set();
			rendererRootDiagnosticKeys.set(event.sender.id, keys);
		}
		const deduplicationKey = JSON.stringify(payload);
		if (keys.has(deduplicationKey)) return;
		if (keys.size >= 64) {
			const oldest = keys.values().next().value;
			if (oldest !== undefined) keys.delete(oldest);
		}
		keys.add(deduplicationKey);
		void desktopDiagnostics.record(
			{
				component: 'renderer',
				event: 'renderer.root-error',
				fields: {
					componentStack: payload.componentStack,
					name: payload.name,
					phase: payload.phase,
				},
				message: payload.message,
				severity: 'error',
				source: `renderer-${event.sender.id}`,
				stack: payload.stack,
			},
			{ channel: 'lifecycle' },
		);
	},
);

ipcMain.on(
	'desktop:diagnostics-host:report-terminal-recovery',
	(event, value: unknown) => {
		assertTrustedAppSender(event);
		const payload = readTerminalRecoveryDiagnosticPayload(value);
		if (payload === undefined) return;
		const phase = payload.phase as keyof typeof terminalRecoveryEventNames;
		const { version: _version, ...fields } = payload;
		void desktopDiagnostics.record(
			{
				component: 'renderer',
				event: terminalRecoveryEventNames[phase],
				fields,
				severity:
					phase === 'failed'
						? 'error'
						: phase === 'recovered'
							? 'info'
							: 'warning',
				source: `renderer-${event.sender.id}`,
			},
			{ channel: 'lifecycle' },
		);
	},
);

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
	bindWebContentsDiagnostics({
		app,
		contents,
		diagnostics: desktopDiagnostics,
	});
	bindAppShortcuts(contents);

	contents.once('destroyed', () => {
		if (contents.id === projectDragSourceWebContentsId) {
			stopProjectDragTracking();
		}
		tabBarRectsByWebContents.delete(contents.id);
		rendererRootDiagnosticKeys.delete(contents.id);
		detachSessionsForWebContents(contents.id);
		fileExplorerWatchService.disposeSubscriber(contents.id);
		fileWatchService.disposeSubscriber(contents.id);
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
			const remoteConnections = [
				...activeRemoteByteConnectionsByWebContents.values(),
			];
			activeRemoteByteConnectionsByWebContents.clear();
			await Promise.all([
				...remoteConnections.map((connection) => connection.close()),
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

registerAiTabMetadataIpcHandlers({
	assertTrustedSender: assertTrustedAppSender,
	aiTabMetadataService,
	ipcMain,
});

registerDictationIpcHandlers({
	assertTrustedSender: assertTrustedAppSender,
	clearOpenAiKey: clearDictationOpenAiKey,
	dictationService,
	getParakeetStatus: () => parakeetRuntime.getStatus(),
	installParakeet: () => parakeetRuntime.install(),
	getMicrophonePermissionStatus: getDictationMicrophonePermissionStatus,
	getOpenAiKeyStatus: getDictationOpenAiKeyStatus,
	ipcMain,
	requestMicrophonePermission: requestDictationMicrophonePermission,
	saveOpenAiKey: saveDictationOpenAiKey,
});

registerQuickPushIpcHandlers({
	assertTrustedSender: assertTrustedAppSender,
	quickPushService,
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

app.whenReady().then(async () => {
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
	createWindow();
	applyControlServerSetting();
});
