import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { MacroDefinition } from '../src/types/macros';
import type { TerminalSettings } from '../src/types/settings';
import type {
	AdoptedProjectPayload,
	AiTabMetadataGenerateResult,
	AiTabMetadataModel,
	AiTabMetadataProvider,
	AppCommand,
	DictationKeyStatus,
	DictationMicrophonePermissionStatus,
	DictationTranscribeRequest,
	DictationTranscribeResult,
	EditWindowResult,
	EditWindowState,
	FileExplorerEntry,
	FileExplorerWatchEvent,
	FileSearchResult,
	FileViewerByteRange,
	FileViewerFileInfo,
	FileViewerGitDiff,
	FileViewerGitRepoInfo,
	FileViewerPreviewSource,
	FileViewerSaveRequest,
	FileViewerSaveResult,
	FileViewerSparseFileSaveRequest,
	FileViewerTextEncoding,
	FileViewerTextMetadata,
	FileViewerTextRange,
	FileViewerTextWindow,
	FileViewerWatchEvent,
	FolderSizeProgress,
	FolderSizeResult,
	MacrosChangeMessage,
	McpInstallActionResult,
	McpInstallStatus,
	ProjectEditWindowResult,
	ProjectTabDragHoverMessage,
	ProjectTabDragResult,
	QuickPushApplyRequest,
	QuickPushApplyResult,
	QuickPushGenerateRequest,
	QuickPushPlan,
	RemoteAccessStatus,
	SettingsChangeMessage,
	TerminalEditWindowDraft,
	TerminalEditWindowResult,
	TerminalRecordingChangeMessage,
	TerminalRecordingChunk,
	TerminalRecordingListItem,
	TerminalRecordingState,
	TerminalRemoteSizeOverrideMessage,
	TerminalZoomMessage,
	TerminayTestApi,
} from '../src/types/terminay';

type ElectronListener<T> = (
	_event: Electron.IpcRendererEvent,
	payload: T,
) => void;

type ServerConnectionMessage = {
	readonly serverId: string;
	readonly label?: string;
	readonly replacement?: boolean;
};
type ServerConnectionListener = (message: ServerConnectionMessage) => void;
type ServerFrameListener = (frame: Uint8Array | null) => void;

function hasOwn(value: object, key: PropertyKey): boolean {
	// ES2021 is the desktop compiler target, so Object.hasOwn is unavailable here.
	// biome-ignore lint/suspicious/noPrototypeBuiltins: calling the prototype method explicitly is safe for arbitrary objects.
	return Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * The connection picker is a native-host concern.  Keep its renderer surface
 * separate from the historical application-wide `terminay` compatibility API
 * so server/workspace UI cannot acquire unrelated privileged methods merely
 * to select a connection.
 */
const DESKTOP_CONNECTION_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_EXTERNAL_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_UPDATE_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_CLIPBOARD_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_TERMINAL_PRESENTATION_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_TERMINAL_LIFECYCLE_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_REVEAL_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_MCP_INSTALL_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_RECORDINGS_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_FILE_EXPLORER_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_PROJECT_EDIT_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_TERMINAL_EDIT_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_DICTATION_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_WINDOW_LIFECYCLE_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_SETTINGS_WINDOW_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_APP_COMMAND_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_REMOTE_ACCESS_STATUS_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_SERVER_CONNECTION_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_TERMINAL_SETTINGS_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_MACRO_SETTINGS_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_AI_METADATA_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_EDIT_WINDOW_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_QUICK_PUSH_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;
const DESKTOP_REMOTE_PAIRING_PIN_COMPATIBILITY_HOST_BRIDGE_VERSION = 1 as const;

let pendingServerConnection: ServerConnectionMessage | null = null;
const serverConnectionListeners = new Set<ServerConnectionListener>();
const serverPorts = new Map<string, MessagePort>();
const serverFrameListeners = new Map<string, Set<ServerFrameListener>>();
const terminalPresentationProjectIds = new Map<string, string>();

/** MessagePort payloads may cross Electron's isolated-world boundary, where
 * `instanceof Uint8Array` is not reliable. Normalize accepted typed-array
 * views before passing protocol bytes to the unprivileged renderer. */
function asServerFrame(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (!ArrayBuffer.isView(value)) return undefined;
	return new Uint8Array(
		value.buffer,
		value.byteOffset,
		value.byteLength,
	).slice();
}

function isWorkspaceTransferPayload(
	value: unknown,
): value is AdoptedProjectPayload {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const candidate = value as Record<string, unknown>;
	if (
		!hasOwn(candidate, 'project') ||
		!hasOwn(candidate, 'terminals') ||
		typeof candidate.project !== 'object' ||
		candidate.project === null ||
		Array.isArray(candidate.project) ||
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
			Array.isArray(terminal)
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

const APP_COMMANDS = new Set<string>([
	'clear-terminal',
	'close-active',
	'new-project',
	'new-terminal',
	'open-command-bar',
	'open-recordings',
	'popout-active',
	'save-active',
	'set-project-root-folder-to-working-directory',
	'split-horizontal',
	'split-vertical',
	'start-dictation',
	'toggle-file-explorer-sidebar',
]);

function isAppCommand(value: unknown): value is AppCommand {
	return typeof value === 'string' && APP_COMMANDS.has(value);
}

// Install this listener during preload evaluation so a fast did-finish-load
// message cannot arrive before React has mounted its useEffect subscription.
ipcRenderer.on(
	'server:connection',
	(
		event,
		message: { serverId?: unknown; label?: unknown; replacement?: unknown },
	) => {
		const port = event.ports?.[0];
		if (!port || typeof message?.serverId !== 'string') return;
		const connection = {
			serverId: message.serverId,
			...(typeof message.label === 'string' &&
			message.label.length > 0 &&
			message.label.length <= 128 &&
			!/[\r\n\0]/u.test(message.label)
				? { label: message.label }
				: {}),
		};
		const replacement = message.replacement === true;
		// A did-finish-load duplicate can arrive after the renderer has attached.
		// Keeping the existing port is essential: replacing it here closes the
		// transport beneath every live terminal before the renderer can reject the
		// duplicate connection notification. A real renderer reload has a fresh
		// preload realm, so it never has an existing port to preserve.
		if (serverPorts.has(connection.serverId) && !replacement) {
			port.close();
			return;
		}
		if (replacement) {
			serverPorts.get(connection.serverId)?.close();
		}
		serverPorts.set(connection.serverId, port);
		const notifyPortClosed = () => {
			// A delayed close from a replaced generation must not remove or fail the
			// currently active port for this server.
			if (serverPorts.get(connection.serverId) !== port) return;
			serverPorts.delete(connection.serverId);
			for (const listener of serverFrameListeners.get(connection.serverId) ??
				[])
				listener(null);
		};
		port.onmessage = (portEvent) => {
			const packet = portEvent.data as {
				readonly type?: unknown;
				readonly version?: unknown;
				readonly serverId?: unknown;
				readonly frame?: unknown;
			};
			const frame = asServerFrame(packet.frame);
			if (
				packet.type !== 'terminay.server-frame' ||
				packet.version !== 1 ||
				packet.serverId !== connection.serverId ||
				frame === undefined ||
				frame.byteLength === 0
			) {
				for (const listener of serverFrameListeners.get(connection.serverId) ??
					[])
					listener(null);
				return;
			}
			for (const listener of serverFrameListeners.get(connection.serverId) ??
				[])
				listener(frame);
		};
		port.onmessageerror = () => {
			for (const listener of serverFrameListeners.get(connection.serverId) ??
				[])
				listener(null);
		};
		(port as MessagePort & { onclose?: (() => void) | null }).onclose =
			notifyPortClosed;
		port.start();
		if (serverConnectionListeners.size === 0) {
			pendingServerConnection = replacement
				? { ...connection, replacement: true }
				: connection;
			return;
		}
		for (const listener of serverConnectionListeners)
			listener(replacement ? { ...connection, replacement: true } : connection);
	},
);

const terminayApi = {
	recordBootstrapDiagnostic: (phase: unknown, count?: unknown) => {
		if (
			process.env.TERMINAY_TEST !== '1' ||
			typeof phase !== 'string' ||
			phase.length === 0 ||
			phase.length > 96
		)
			return;
		if (
			count !== undefined &&
			(!Number.isSafeInteger(count) ||
				(count as number) < 0 ||
				(count as number) > 1_000_000)
		)
			return;
		ipcRenderer.send('test:renderer-bootstrap-diagnostic', {
			phase,
			...(count === undefined ? {} : { count }),
		});
	},
	listDirectory: (dirPath: string) =>
		ipcRenderer.invoke('fs:list-directory', { dirPath }) as Promise<
			FileExplorerEntry[]
		>,
	calculateFolderSize: (payload: { jobId: string; path: string }) =>
		ipcRenderer.invoke(
			'fs:calculate-folder-size',
			payload,
		) as Promise<FolderSizeResult>,
	cancelFolderSize: (jobId: string) =>
		ipcRenderer.invoke('fs:cancel-folder-size', { jobId }) as Promise<void>,
	searchFiles: (options: { rootPath: string; query: string; limit?: number }) =>
		ipcRenderer.invoke('fs:search-files', options) as Promise<
			FileSearchResult[]
		>,
	getFileInfo: (filePath: string) =>
		ipcRenderer.invoke('file:get-info', {
			path: filePath,
		}) as Promise<FileViewerFileInfo>,
	readFileBytes: (options: { path: string; start: number; length: number }) =>
		ipcRenderer.invoke(
			'file:read-bytes',
			options,
		) as Promise<FileViewerByteRange>,
	readFileText: (options: {
		path: string;
		start: number;
		length: number;
		encoding?: FileViewerTextEncoding;
	}) =>
		ipcRenderer.invoke(
			'file:read-text',
			options,
		) as Promise<FileViewerTextRange>,
	getFileTextMetadata: (options: { path: string; projectRoot: string }) =>
		ipcRenderer.invoke(
			'file:get-text-metadata',
			options,
		) as Promise<FileViewerTextMetadata>,
	readFileTextLines: (options: {
		lineCount: number;
		path: string;
		projectRoot: string;
		startLine: number;
	}) =>
		ipcRenderer.invoke(
			'file:read-text-lines',
			options,
		) as Promise<FileViewerTextWindow>,
	saveSparseFile: (payload: FileViewerSparseFileSaveRequest) =>
		ipcRenderer.invoke(
			'file:save-sparse',
			payload,
		) as Promise<FileViewerSaveResult>,
	saveFile: (payload: FileViewerSaveRequest) =>
		ipcRenderer.invoke('file:save', payload) as Promise<FileViewerSaveResult>,
	renameEntry: (oldPath: string, newPath: string) =>
		ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
	deleteEntry: (path: string) => ipcRenderer.invoke('fs:delete', { path }),
	mkdir: (path: string) => ipcRenderer.invoke('fs:mkdir', { path }),
	watchDirectory: (dirPath: string) =>
		ipcRenderer.invoke('fs:watch-directory', {
			path: dirPath,
		}) as Promise<void>,
	unwatchDirectory: (dirPath: string) =>
		ipcRenderer.invoke('fs:unwatch-directory', {
			path: dirPath,
		}) as Promise<void>,
	watchFile: (filePath: string) =>
		ipcRenderer.invoke('file:watch', { path: filePath }) as Promise<void>,
	unwatchFile: (filePath: string) =>
		ipcRenderer.invoke('file:unwatch', { path: filePath }) as Promise<void>,
	getFilePreviewSource: (filePath: string) =>
		ipcRenderer.invoke('file:get-preview-source', {
			path: filePath,
		}) as Promise<FileViewerPreviewSource>,
	getGitRepoInfo: (filePath: string) =>
		ipcRenderer.invoke('file:get-git-repo-info', {
			path: filePath,
		}) as Promise<FileViewerGitRepoInfo>,
	getGitDiff: (filePath: string) =>
		ipcRenderer.invoke('file:get-git-diff', {
			path: filePath,
		}) as Promise<FileViewerGitDiff>,
	getPathForFile: (file: File) => webUtils.getPathForFile(file),
	getTerminalSettings: () =>
		ipcRenderer.invoke('settings:get-terminal') as Promise<TerminalSettings>,
	updateTerminalSettings: (settings: TerminalSettings) =>
		ipcRenderer.invoke(
			'settings:update-terminal',
			settings,
		) as Promise<TerminalSettings>,
	resetTerminalSettings: () =>
		ipcRenderer.invoke('settings:reset-terminal') as Promise<TerminalSettings>,
	listAiTabMetadataModels: (provider: AiTabMetadataProvider) =>
		ipcRenderer.invoke('ai-tab-metadata:list-models', { provider }) as Promise<
			AiTabMetadataModel[]
		>,
	getDictationOpenAiKeyStatus: () =>
		ipcRenderer.invoke(
			'dictation:get-openai-key-status',
		) as Promise<DictationKeyStatus>,
	saveDictationOpenAiKey: (apiKey: string) =>
		ipcRenderer.invoke('dictation:save-openai-key', {
			apiKey,
		}) as Promise<DictationKeyStatus>,
	clearDictationOpenAiKey: () =>
		ipcRenderer.invoke(
			'dictation:clear-openai-key',
		) as Promise<DictationKeyStatus>,
	getDictationMicrophonePermissionStatus: () =>
		ipcRenderer.invoke(
			'dictation:get-microphone-permission-status',
		) as Promise<DictationMicrophonePermissionStatus>,
	requestDictationMicrophonePermission: () =>
		ipcRenderer.invoke(
			'dictation:request-microphone-permission',
		) as Promise<DictationMicrophonePermissionStatus>,
	transcribeDictation: (request: DictationTranscribeRequest) =>
		ipcRenderer.invoke(
			'dictation:transcribe',
			request,
		) as Promise<DictationTranscribeResult>,
	generateQuickPushPlan: (payload: QuickPushGenerateRequest) =>
		ipcRenderer.invoke(
			'quick-push:generate-plan',
			payload,
		) as Promise<QuickPushPlan>,
	applyQuickPush: (payload: QuickPushApplyRequest) =>
		ipcRenderer.invoke(
			'quick-push:apply',
			payload,
		) as Promise<QuickPushApplyResult>,

	getMacros: () =>
		ipcRenderer.invoke('macros:get') as Promise<MacroDefinition[]>,
	updateMacros: (macros: MacroDefinition[]) =>
		ipcRenderer.invoke('macros:update', macros) as Promise<MacroDefinition[]>,
	resetMacros: () =>
		ipcRenderer.invoke('macros:reset') as Promise<MacroDefinition[]>,

	getSecrets: () => ipcRenderer.invoke('secrets:get'),
	saveSecret: (name: string, value: string) =>
		ipcRenderer.invoke('secrets:save', { name, value }),
	deleteSecret: (id: string) => ipcRenderer.invoke('secrets:delete', id),
	getDecryptedSecret: (id: string) =>
		ipcRenderer.invoke('secrets:get-decrypted', id),

	openTerminalEditWindow: (draft: TerminalEditWindowDraft) =>
		ipcRenderer.invoke(
			'app:open-terminal-edit',
			draft,
		) as Promise<TerminalEditWindowResult | null>,
	getEditWindowState: () =>
		ipcRenderer.invoke(
			'app:get-edit-window-state',
		) as Promise<EditWindowState | null>,
	submitEditWindowResult: (result: EditWindowResult) =>
		ipcRenderer.invoke(
			'app:submit-edit-window-result',
			result,
		) as Promise<void>,
	getRemoteAccessStatus: () => ipcRenderer.invoke('remote:get-status'),
	toggleRemoteAccessServer: () => ipcRenderer.invoke('remote:toggle-server'),
	revokeRemoteAccessDevice: (deviceId: string) =>
		ipcRenderer.invoke('remote:revoke-device', { deviceId }),
	closeRemoteAccessConnection: (connectionId: string) =>
		ipcRenderer.invoke('remote:close-connection', { connectionId }),
	setRemoteAccessPairingAddress: (address: string) =>
		ipcRenderer.invoke('remote:set-pairing-address', { address }),
	setRemoteAccessPairingPin: (pin: string) =>
		ipcRenderer.invoke('remote:set-pairing-pin', {
			pin,
		}) as Promise<TerminalSettings>,
};
const {
	applyQuickPush,
	calculateFolderSize: _unusedBroadCalculateFolderSize,
	clearDictationOpenAiKey: _unusedBroadClearDictationOpenAiKey,
	closeRemoteAccessConnection: _unusedBroadCloseRemoteAccessConnection,
	deleteEntry,
	deleteSecret,
	generateQuickPushPlan,
	getDecryptedSecret,
	getDictationMicrophonePermissionStatus:
		_unusedBroadGetDictationMicrophonePermissionStatus,
	getDictationOpenAiKeyStatus: _unusedBroadGetDictationOpenAiKeyStatus,
	getEditWindowState,
	getFileInfo,
	getFilePreviewSource,
	getFileTextMetadata,
	getGitDiff,
	getGitRepoInfo,
	getMacros,
	getPathForFile: _unusedBroadGetPathForFile,
	getRemoteAccessStatus: _unusedBroadGetRemoteAccessStatus,
	getSecrets,
	getTerminalSettings: getCompatibilityTerminalSettings,
	listAiTabMetadataModels: _unusedBroadListAiTabMetadataModels,
	listDirectory,
	mkdir,
	openTerminalEditWindow: _unusedBroadTerminalEditWindow,
	readFileBytes,
	readFileText,
	readFileTextLines,
	renameEntry,
	requestDictationMicrophonePermission:
		_unusedBroadRequestDictationMicrophonePermission,
	resetMacros,
	resetTerminalSettings,
	revokeRemoteAccessDevice: _unusedBroadRevokeRemoteAccessDevice,
	saveFile,
	saveDictationOpenAiKey: _unusedBroadSaveDictationOpenAiKey,
	saveSecret,
	saveSparseFile,
	searchFiles: _unusedBroadSearchFiles,
	setRemoteAccessPairingAddress: _unusedBroadSetRemoteAccessPairingAddress,
	setRemoteAccessPairingPin,
	submitEditWindowResult,
	cancelFolderSize: _unusedBroadCancelFolderSize,
	toggleRemoteAccessServer: _unusedBroadToggleRemoteAccessServer,
	transcribeDictation: _unusedBroadTranscribeDictation,
	unwatchDirectory: _unusedBroadUnwatchDirectory,
	unwatchFile,
	updateMacros,
	updateTerminalSettings,
	watchDirectory: _unusedBroadWatchDirectory,
	watchFile,
} = terminayApi;

contextBridge.exposeInMainWorld(
	'terminayFileViewerCompatibilityHost',
	Object.freeze({
		deleteEntry,
		getFileInfo,
		getFilePreviewSource,
		getFileTextMetadata,
		getGitDiff,
		getGitRepoInfo,
		listDirectory,
		mkdir,
		onFileWatchEvent: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('file watch listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					!['changed', 'deleted', 'error', 'renamed'].includes(
						String(message.event),
					) ||
					typeof message.exists !== 'boolean' ||
					typeof message.path !== 'string' ||
					message.path.length === 0 ||
					message.path.length > 32_768 ||
					(message.message !== undefined &&
						(typeof message.message !== 'string' ||
							message.message.length > 4_096))
				)
					return;
				(listener as (message: FileViewerWatchEvent) => void)(
					message as FileViewerWatchEvent,
				);
			};
			ipcRenderer.on('file:watch-event', wrapper);
			return () => ipcRenderer.off('file:watch-event', wrapper);
		},
		readFileBytes,
		readFileText,
		readFileTextLines,
		renameEntry,
		saveFile,
		saveSparseFile,
		unwatchFile,
		watchFile,
	}),
);

contextBridge.exposeInMainWorld(
	'terminayTerminalSettingsCompatibilityHost',
	Object.freeze({
		version: DESKTOP_TERMINAL_SETTINGS_COMPATIBILITY_HOST_BRIDGE_VERSION,
		getTerminalSettings: terminayApi.getTerminalSettings,
		updateTerminalSettings,
		resetTerminalSettings,
		onTerminalSettingsChanged: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('terminal settings listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					Object.keys(message).length !== 1 ||
					typeof message.settings !== 'object' ||
					message.settings === null ||
					Array.isArray(message.settings)
				)
					return;
				let serialized: string;
				try {
					serialized = JSON.stringify(message.settings);
				} catch {
					return;
				}
				if (serialized.length === 0 || serialized.length > 1_048_576) return;
				(listener as (message: SettingsChangeMessage) => void)(
					Object.freeze({
						settings: Object.freeze({ ...(message.settings as object) }),
					}) as SettingsChangeMessage,
				);
			};
			ipcRenderer.on('settings:terminal-changed', wrapper);
			return () => ipcRenderer.off('settings:terminal-changed', wrapper);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayMacroSettingsCompatibilityHost',
	Object.freeze({
		version: DESKTOP_MACRO_SETTINGS_COMPATIBILITY_HOST_BRIDGE_VERSION,
		deleteSecret,
		getDecryptedSecret,
		getMacros,
		getSecrets,
		resetMacros,
		saveSecret,
		updateMacros,
		onMacrosChanged: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('macro settings listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					Object.keys(message).length !== 1 ||
					!Array.isArray(message.macros) ||
					message.macros.length > 10_000
				)
					return;
				let serialized: string;
				try {
					serialized = JSON.stringify(message.macros);
				} catch {
					return;
				}
				if (serialized.length > 4_194_304) return;
				(listener as (message: MacrosChangeMessage) => void)(
					Object.freeze({
						macros: Object.freeze([...message.macros]),
					}) as unknown as MacrosChangeMessage,
				);
			};
			ipcRenderer.on('settings:macros-changed', wrapper);
			return () => ipcRenderer.off('settings:macros-changed', wrapper);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayAiMetadataHost',
	Object.freeze({
		version: DESKTOP_AI_METADATA_COMPATIBILITY_HOST_BRIDGE_VERSION,
		listAiTabMetadataModels: (provider: unknown) => {
			if (provider !== 'claudeCode' && provider !== 'codex') {
				throw new TypeError('AI metadata provider is invalid');
			}
			return ipcRenderer.invoke('ai-tab-metadata:list-models', {
				provider,
			}) as Promise<AiTabMetadataModel[]>;
		},
		generateAiTabMetadata: (value: unknown) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				throw new TypeError('AI metadata request is invalid');
			}
			const request = value as Record<string, unknown>;
			const context = request.context;
			if (
				Object.keys(request).length !== 4 ||
				(request.provider !== 'claudeCode' && request.provider !== 'codex') ||
				(request.target !== 'title' && request.target !== 'note') ||
				typeof request.model !== 'string' ||
				request.model.length === 0 ||
				request.model.length > 512 ||
				typeof context !== 'object' ||
				context === null ||
				Array.isArray(context)
			)
				throw new TypeError('AI metadata request is invalid');
			const serialized = JSON.stringify(context);
			if (serialized.length === 0 || serialized.length > 1_048_576) {
				throw new TypeError('AI metadata context is invalid');
			}
			return ipcRenderer.invoke(
				'ai-tab-metadata:generate',
				request,
			) as Promise<AiTabMetadataGenerateResult>;
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayEditWindowHost',
	Object.freeze({
		version: DESKTOP_EDIT_WINDOW_COMPATIBILITY_HOST_BRIDGE_VERSION,
		getEditWindowState,
		submitEditWindowResult: (value: unknown) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				throw new TypeError('edit window result is invalid');
			}
			const serialized = JSON.stringify(value);
			if (serialized.length === 0 || serialized.length > 1_048_576) {
				throw new TypeError('edit window result is invalid');
			}
			return submitEditWindowResult(value as EditWindowResult);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayQuickPushHost',
	Object.freeze({
		version: DESKTOP_QUICK_PUSH_COMPATIBILITY_HOST_BRIDGE_VERSION,
		generateQuickPushPlan: (value: unknown) => {
			if (
				typeof value !== 'object' ||
				value === null ||
				Array.isArray(value) ||
				JSON.stringify(value).length > 65_536
			)
				throw new TypeError('quick-push request is invalid');
			return generateQuickPushPlan(value as QuickPushGenerateRequest);
		},
		applyQuickPush: (value: unknown) => {
			if (
				typeof value !== 'object' ||
				value === null ||
				Array.isArray(value) ||
				JSON.stringify(value).length > 4_194_304
			)
				throw new TypeError('quick-push apply request is invalid');
			return applyQuickPush(value as QuickPushApplyRequest);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayRemotePairingPinHost',
	Object.freeze({
		version: DESKTOP_REMOTE_PAIRING_PIN_COMPATIBILITY_HOST_BRIDGE_VERSION,
		getTerminalSettings: getCompatibilityTerminalSettings,
		setRemoteAccessPairingPin: (pin: unknown) => {
			if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
				throw new TypeError('remote pairing PIN is invalid');
			}
			return setRemoteAccessPairingPin(pin);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayRemoteAccessStatusHost',
	Object.freeze({
		version: DESKTOP_REMOTE_ACCESS_STATUS_HOST_BRIDGE_VERSION,
		getStatus: () =>
			ipcRenderer.invoke('remote:get-status') as Promise<RemoteAccessStatus>,
		toggleServer: () =>
			ipcRenderer.invoke('remote:toggle-server') as Promise<RemoteAccessStatus>,
		revokeDevice: (deviceId: unknown) => {
			if (
				typeof deviceId !== 'string' ||
				deviceId.length === 0 ||
				deviceId.length > 512 ||
				deviceId.includes('\0')
			) {
				throw new TypeError('remote access device id is invalid');
			}
			return ipcRenderer.invoke('remote:revoke-device', {
				deviceId,
			}) as Promise<RemoteAccessStatus>;
		},
		closeConnection: (connectionId: unknown) => {
			if (
				typeof connectionId !== 'string' ||
				connectionId.length === 0 ||
				connectionId.length > 512 ||
				connectionId.includes('\0')
			) {
				throw new TypeError('remote access connection id is invalid');
			}
			return ipcRenderer.invoke('remote:close-connection', {
				connectionId,
			}) as Promise<RemoteAccessStatus>;
		},
		setPairingAddress: (address: unknown) => {
			if (
				typeof address !== 'string' ||
				address.length === 0 ||
				address.length > 2_048 ||
				address.includes('\0')
			) {
				throw new TypeError('remote access pairing address is invalid');
			}
			return ipcRenderer.invoke('remote:set-pairing-address', {
				address,
			}) as Promise<RemoteAccessStatus>;
		},
		subscribe: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('remote access status listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const status = value as Record<string, unknown>;
				if (
					typeof status.isRunning !== 'boolean' ||
					(status.pairingMode !== 'lan' && status.pairingMode !== 'webrtc') ||
					!['error', 'not-configured', 'pairing-ready', 'registering'].includes(
						String(status.webRtcStatus),
					) ||
					typeof status.activeConnectionCount !== 'number' ||
					!Number.isSafeInteger(status.activeConnectionCount) ||
					status.activeConnectionCount < 0 ||
					typeof status.pendingWebRtcConnectionCount !== 'number' ||
					!Number.isSafeInteger(status.pendingWebRtcConnectionCount) ||
					status.pendingWebRtcConnectionCount < 0 ||
					!Array.isArray(status.connections) ||
					status.connections.length > 1_024 ||
					!Array.isArray(status.pairedDevices) ||
					status.pairedDevices.length > 1_024 ||
					!Array.isArray(status.auditEvents) ||
					status.auditEvents.length > 10_000 ||
					!Array.isArray(status.availableAddresses) ||
					status.availableAddresses.length > 256
				)
					return;
				(listener as (status: RemoteAccessStatus) => void)(
					status as RemoteAccessStatus,
				);
			};
			ipcRenderer.on('remote:status-changed', wrapper);
			return () => ipcRenderer.off('remote:status-changed', wrapper);
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayServerConnectionHost',
	Object.freeze({
		version: DESKTOP_SERVER_CONNECTION_HOST_BRIDGE_VERSION,
		onServerConnection: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('server connection listener is invalid');
			const validatedListener: ServerConnectionListener = (message) => {
				if (
					typeof message.serverId !== 'string' ||
					message.serverId.length === 0 ||
					message.serverId.length > 512 ||
					(message.label !== undefined &&
						(typeof message.label !== 'string' || message.label.length > 512))
				)
					return;
				(listener as ServerConnectionListener)(Object.freeze({ ...message }));
			};
			serverConnectionListeners.add(validatedListener);
			const pending = pendingServerConnection;
			pendingServerConnection = null;
			if (pending !== null)
				queueMicrotask(() => {
					if (serverConnectionListeners.has(validatedListener))
						validatedListener(pending);
				});
			return () => serverConnectionListeners.delete(validatedListener);
		},
		requestServerConnection: (serverId: unknown) => {
			if (
				typeof serverId !== 'string' ||
				serverId.length === 0 ||
				serverId.length > 512
			) {
				throw new TypeError('server id is invalid');
			}
			return ipcRenderer.invoke('server:connection:rehydrate', {
				serverId,
			}) as Promise<void>;
		},
		sendServerFrame: (serverId: unknown, frame: unknown) => {
			if (
				typeof serverId !== 'string' ||
				serverId.length === 0 ||
				serverId.length > 512
			) {
				throw new TypeError('server id is invalid');
			}
			const port = serverPorts.get(serverId);
			if (port === undefined)
				throw new Error(`No server port is available for ${serverId}`);
			const bytes = asServerFrame(frame);
			if (
				bytes === undefined ||
				bytes.byteLength === 0 ||
				bytes.byteLength > 16_777_216
			) {
				throw new TypeError('server frame must be bounded non-empty bytes');
			}
			port.postMessage({
				type: 'terminay.server-frame',
				version: 1,
				serverId,
				frame: bytes,
			});
		},
		onServerFrame: (serverId: unknown, listener: unknown) => {
			if (
				typeof serverId !== 'string' ||
				serverId.length === 0 ||
				serverId.length > 512
			) {
				throw new TypeError('server id is invalid');
			}
			if (typeof listener !== 'function')
				throw new TypeError('server frame listener is invalid');
			const listeners =
				serverFrameListeners.get(serverId) ?? new Set<ServerFrameListener>();
			const validatedListener: ServerFrameListener = (frame) => {
				if (frame === null) {
					(listener as ServerFrameListener)(null);
					return;
				}
				const bytes = asServerFrame(frame);
				if (
					bytes !== undefined &&
					bytes.byteLength > 0 &&
					bytes.byteLength <= 16_777_216
				) {
					(listener as ServerFrameListener)(bytes);
				}
			};
			listeners.add(validatedListener);
			serverFrameListeners.set(serverId, listeners);
			return () => {
				listeners.delete(validatedListener);
				if (listeners.size === 0) serverFrameListeners.delete(serverId);
			};
		},
	}),
);

const fileExplorerHostText = (
	value: unknown,
	label: string,
	maxLength = 32_768,
): string => {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maxLength ||
		value.includes('\0')
	) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
};

contextBridge.exposeInMainWorld(
	'terminayFileExplorerHost',
	Object.freeze({
		version: DESKTOP_FILE_EXPLORER_HOST_BRIDGE_VERSION,
		subscribeWatchEvents: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('file explorer watch listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					(message.event !== 'changed' && message.event !== 'error') ||
					typeof message.path !== 'string' ||
					message.path.length === 0 ||
					message.path.length > 32_768 ||
					(message.entryName !== undefined &&
						message.entryName !== null &&
						(typeof message.entryName !== 'string' ||
							message.entryName.length > 4_096)) ||
					(message.message !== undefined &&
						(typeof message.message !== 'string' ||
							message.message.length > 4_096))
				)
					return;
				(listener as (message: FileExplorerWatchEvent) => void)(
					message as FileExplorerWatchEvent,
				);
			};
			ipcRenderer.on('file-explorer:watch-event', wrapper);
			return () => ipcRenderer.off('file-explorer:watch-event', wrapper);
		},
		subscribeFolderSizeProgress: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('folder-size progress listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					Object.keys(message).length !== 3 ||
					typeof message.jobId !== 'string' ||
					message.jobId.length === 0 ||
					message.jobId.length > 512 ||
					typeof message.entryCount !== 'number' ||
					!Number.isSafeInteger(message.entryCount) ||
					message.entryCount < 0 ||
					typeof message.size !== 'number' ||
					!Number.isSafeInteger(message.size) ||
					message.size < 0
				)
					return;
				(listener as (message: FolderSizeProgress) => void)(
					message as FolderSizeProgress,
				);
			};
			ipcRenderer.on('folder-size:progress', wrapper);
			return () => ipcRenderer.off('folder-size:progress', wrapper);
		},
		getHomePath: () =>
			ipcRenderer.invoke('desktop:file-explorer-host:get-home-path', {
				version: DESKTOP_FILE_EXPLORER_HOST_BRIDGE_VERSION,
			}) as Promise<string>,
		calculateFolderSize: (request: unknown) => {
			if (
				typeof request !== 'object' ||
				request === null ||
				Array.isArray(request)
			) {
				throw new TypeError('folder-size request is invalid');
			}
			const value = request as Record<string, unknown>;
			return ipcRenderer.invoke('fs:calculate-folder-size', {
				jobId: fileExplorerHostText(value.jobId, 'folder-size job id', 512),
				path: fileExplorerHostText(value.path, 'folder-size path'),
			}) as Promise<FolderSizeResult>;
		},
		cancelFolderSize: (jobId: unknown) =>
			ipcRenderer.invoke('fs:cancel-folder-size', {
				jobId: fileExplorerHostText(jobId, 'folder-size job id', 512),
			}) as Promise<void>,
		resolveDroppedFilePath: (file: unknown) => {
			if (typeof file !== 'object' || file === null)
				throw new TypeError('dropped file is invalid');
			return fileExplorerHostText(
				webUtils.getPathForFile(file as File),
				'dropped file path',
			);
		},
		searchFiles: (request: unknown) => {
			if (
				typeof request !== 'object' ||
				request === null ||
				Array.isArray(request)
			) {
				throw new TypeError('file search request is invalid');
			}
			const value = request as Record<string, unknown>;
			if (
				typeof value.limit !== 'number' ||
				!Number.isSafeInteger(value.limit) ||
				value.limit < 1 ||
				value.limit > 500
			)
				throw new TypeError('file search limit is invalid');
			return ipcRenderer.invoke('fs:search-files', {
				rootPath: fileExplorerHostText(value.rootPath, 'file search root'),
				query: fileExplorerHostText(value.query, 'file search query', 4_096),
				limit: value.limit,
			}) as Promise<FileSearchResult[]>;
		},
		watchDirectory: (path: unknown) =>
			ipcRenderer.invoke('fs:watch-directory', {
				path: fileExplorerHostText(path, 'watched directory path'),
			}) as Promise<void>,
		unwatchDirectory: (path: unknown) =>
			ipcRenderer.invoke('fs:unwatch-directory', {
				path: fileExplorerHostText(path, 'watched directory path'),
			}) as Promise<void>,
	}),
);

/**
 * Project editing opens a native modal window. Keep this bounded host action
 * separate from the legacy application compatibility preload API.
 */
contextBridge.exposeInMainWorld(
	'terminayProjectEditHost',
	Object.freeze({
		version: DESKTOP_PROJECT_EDIT_HOST_BRIDGE_VERSION,
		open: (draft: unknown) => {
			if (
				typeof draft !== 'object' ||
				draft === null ||
				Array.isArray(draft) ||
				Object.keys(draft).length !== 7
			) {
				throw new TypeError('project edit draft is invalid');
			}
			const candidate = draft as Record<string, unknown>;
			if (
				typeof candidate.color !== 'string' ||
				candidate.color.length > 128 ||
				(candidate.defaultShellProfileId !== null && (typeof candidate.defaultShellProfileId !== 'string' || candidate.defaultShellProfileId.length === 0 || candidate.defaultShellProfileId.length > 128)) ||
				typeof candidate.projectId !== 'string' ||
				candidate.projectId.length > 128 ||
				typeof candidate.emoji !== 'string' ||
				candidate.emoji.length > 64 ||
				typeof candidate.rootFolder !== 'string' ||
				candidate.rootFolder.length > 32_768 ||
				!Array.isArray(candidate.shellProfileOptions) ||
				candidate.shellProfileOptions.length > 65 ||
				candidate.shellProfileOptions.some((option) => typeof option !== 'object' || option === null || Array.isArray(option) || Object.keys(option).length !== 3 || typeof (option as Record<string, unknown>).id !== 'string' || ((option as Record<string, unknown>).id as string).length === 0 || ((option as Record<string, unknown>).id as string).length > 128 || typeof (option as Record<string, unknown>).name !== 'string' || ((option as Record<string, unknown>).name as string).length === 0 || ((option as Record<string, unknown>).name as string).length > 128 || typeof (option as Record<string, unknown>).available !== 'boolean') ||
				new Set(candidate.shellProfileOptions.map((option) => (option as Record<string, unknown>).id)).size !== candidate.shellProfileOptions.length ||
				typeof candidate.title !== 'string' ||
				candidate.title.length > 512
			) {
				throw new TypeError('project edit draft is invalid');
			}
			return ipcRenderer.invoke('desktop:project-edit-host:open', {
				draft: {
					color: candidate.color,
					defaultShellProfileId: candidate.defaultShellProfileId,
					emoji: candidate.emoji,
					rootFolder: candidate.rootFolder,
					shellProfileOptions: candidate.shellProfileOptions,
					title: candidate.title,
				},
				projectId: candidate.projectId,
				version: DESKTOP_PROJECT_EDIT_HOST_BRIDGE_VERSION,
			}) as Promise<ProjectEditWindowResult | null>;
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayTerminalEditHost',
	Object.freeze({
		version: DESKTOP_TERMINAL_EDIT_HOST_BRIDGE_VERSION,
		open: (draft: unknown) => {
			if (
				typeof draft !== 'object' ||
				draft === null ||
				Array.isArray(draft) ||
				Object.keys(draft).length !== 6
			)
				throw new TypeError('terminal edit draft is invalid');
			const candidate = draft as Record<string, unknown>;
			if (
				typeof candidate.activityIndicatorsEnabled !== 'boolean' ||
				typeof candidate.color !== 'string' ||
				candidate.color.length > 128 ||
				typeof candidate.emoji !== 'string' ||
				candidate.emoji.length > 64 ||
				typeof candidate.inheritsProjectColor !== 'boolean' ||
				typeof candidate.projectColor !== 'string' ||
				candidate.projectColor.length > 128 ||
				typeof candidate.title !== 'string' ||
				candidate.title.length > 512
			)
				throw new TypeError('terminal edit draft is invalid');
			return ipcRenderer.invoke(
				'app:open-terminal-edit',
				candidate,
			) as Promise<TerminalEditWindowResult | null>;
		},
	}),
);

const dictationHostText = (
	value: unknown,
	label: string,
	maxLength: number,
): string => {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > maxLength ||
		value.includes('\0')
	) {
		throw new TypeError(`${label} is invalid`);
	}
	return value;
};

/**
 * Microphone permission and host-keystore-backed OpenAI credentials are
 * Desktop capabilities. Keep them outside the broad application preload API.
 */
contextBridge.exposeInMainWorld(
	'terminayDictationHost',
	Object.freeze({
		version: DESKTOP_DICTATION_HOST_BRIDGE_VERSION,
		getKeyStatus: () =>
			ipcRenderer.invoke(
				'dictation:get-openai-key-status',
			) as Promise<DictationKeyStatus>,
		saveKey: (apiKey: unknown) =>
			ipcRenderer.invoke('dictation:save-openai-key', {
				apiKey: dictationHostText(apiKey, 'dictation API key', 32_768),
			}) as Promise<DictationKeyStatus>,
		clearKey: () =>
			ipcRenderer.invoke(
				'dictation:clear-openai-key',
			) as Promise<DictationKeyStatus>,
		getMicrophonePermissionStatus: () =>
			ipcRenderer.invoke(
				'dictation:get-microphone-permission-status',
			) as Promise<DictationMicrophonePermissionStatus>,
		requestMicrophonePermission: () =>
			ipcRenderer.invoke(
				'dictation:request-microphone-permission',
			) as Promise<DictationMicrophonePermissionStatus>,
		transcribe: (request: unknown) => {
			if (
				typeof request !== 'object' ||
				request === null ||
				Array.isArray(request)
			) {
				throw new TypeError('dictation transcription request is invalid');
			}
			const value = request as Record<string, unknown>;
			const optionalText = (
				key: 'language' | 'model' | 'prompt',
				maxLength: number,
			): string | undefined => {
				const candidate = value[key];
				if (candidate === undefined) return undefined;
				if (
					typeof candidate !== 'string' ||
					candidate.length > maxLength ||
					candidate.includes('\0')
				) {
					throw new TypeError(`dictation ${key} is invalid`);
				}
				return candidate;
			};
			const language = optionalText('language', 128);
			const model = optionalText('model', 128);
			const prompt = optionalText('prompt', 16_384);
			return ipcRenderer.invoke('dictation:transcribe', {
				audioBase64: dictationHostText(
					value.audioBase64,
					'dictation audio',
					36_000_000,
				),
				fileName: dictationHostText(value.fileName, 'dictation file name', 512),
				mimeType: dictationHostText(value.mimeType, 'dictation MIME type', 256),
				...(language === undefined ? {} : { language }),
				...(model === undefined ? {} : { model }),
				...(prompt === undefined ? {} : { prompt }),
			}) as Promise<DictationTranscribeResult>;
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayConnectionHost',
	Object.freeze({
		version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
		list: () =>
			ipcRenderer.invoke('desktop:connection-host:list', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
			}) as Promise<{
				profiles: Array<{
					id: string;
					isLocal?: boolean;
					label: string;
					origin: string;
					serverId: string;
					selected: boolean;
					status: string;
				}>;
			}>,
		open: (url: unknown, pairingPin?: unknown) => {
			if (typeof url !== 'string' || url.length === 0 || url.length > 16_384) {
				throw new TypeError('remote connection URL is invalid');
			}
			if (
				pairingPin !== undefined &&
				(typeof pairingPin !== 'string' || pairingPin.length > 32)
			) {
				throw new TypeError('remote pairing PIN is invalid');
			}
			return ipcRenderer.invoke('desktop:connection-host:open', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
				url,
				...(pairingPin === undefined ? {} : { pairingPin }),
			}) as Promise<void>;
		},
		select: (profileId: unknown) => {
			if (
				typeof profileId !== 'string' ||
				profileId.length === 0 ||
				profileId.length > 512
			) {
				throw new TypeError('connection profile id is invalid');
			}
			return ipcRenderer.invoke('desktop:connection-host:select', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
				profileId,
			}) as Promise<void>;
		},
		rename: (profileId: unknown, label: unknown) => {
			if (
				typeof profileId !== 'string' ||
				profileId.length === 0 ||
				profileId.length > 512 ||
				typeof label !== 'string' ||
				label.trim().length === 0 ||
				label.length > 128
			) {
				throw new TypeError('connection rename request is invalid');
			}
			return ipcRenderer.invoke('desktop:connection-host:rename', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
				profileId,
				label: label.trim(),
			}) as Promise<void>;
		},
		forget: (profileId: unknown) => {
			if (
				typeof profileId !== 'string' ||
				profileId.length === 0 ||
				profileId.length > 512
			) {
				throw new TypeError('connection profile id is invalid');
			}
			return ipcRenderer.invoke('desktop:connection-host:forget', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
				profileId,
			}) as Promise<void>;
		},
		revoke: (profileId: unknown) => {
			if (
				typeof profileId !== 'string' ||
				profileId.length === 0 ||
				profileId.length > 512
			) {
				throw new TypeError('connection profile id is invalid');
			}
			return ipcRenderer.invoke('desktop:connection-host:revoke', {
				version: DESKTOP_CONNECTION_HOST_BRIDGE_VERSION,
				profileId,
			}) as Promise<void>;
		},
	}),
);

/**
 * Opening a link is an operating-system action, not a workspace service. Keep
 * the current Desktop workspace off the broad compatibility preload surface
 * while Electron remains the only code that can invoke the shell.
 */
contextBridge.exposeInMainWorld(
	'terminayExternalHost',
	Object.freeze({
		version: DESKTOP_EXTERNAL_HOST_BRIDGE_VERSION,
		open: (url: unknown) => {
			if (typeof url !== 'string' || url.length === 0 || url.length > 8_192) {
				throw new TypeError('external URL is invalid');
			}
			return ipcRenderer.invoke('desktop:external-host:open', {
				version: DESKTOP_EXTERNAL_HOST_BRIDGE_VERSION,
				url,
			}) as Promise<void>;
		},
	}),
);

/**
 * Update availability is native-host presentation state.  Expose only the
 * bounded refresh request rather than granting the workspace renderer the
 * historical application-wide preload API.
 */
contextBridge.exposeInMainWorld(
	'terminayUpdateHost',
	Object.freeze({
		version: DESKTOP_UPDATE_HOST_BRIDGE_VERSION,
		getStatus: (force: unknown = false) => {
			if (typeof force !== 'boolean') {
				throw new TypeError('update refresh flag is invalid');
			}
			return ipcRenderer.invoke('desktop:update-host:get-status', {
				force,
				version: DESKTOP_UPDATE_HOST_BRIDGE_VERSION,
			});
		},
	}),
);

/**
 * Terminal selection and paste are native clipboard operations, not terminal
 * application services. Keep the workspace terminal off the broad legacy
 * preload surface while Electron remains the only process that reads or
 * writes the operating-system clipboard.
 */
contextBridge.exposeInMainWorld(
	'terminayClipboardHost',
	Object.freeze({
		version: DESKTOP_CLIPBOARD_HOST_BRIDGE_VERSION,
		subscribeCopyRequest: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('clipboard copy-request listener is invalid');
			const wrapper = () => (listener as () => void)();
			ipcRenderer.on('terminal:copy-requested', wrapper);
			return () => ipcRenderer.off('terminal:copy-requested', wrapper);
		},
		readText: () =>
			ipcRenderer.invoke('desktop:clipboard-host:read', {
				version: DESKTOP_CLIPBOARD_HOST_BRIDGE_VERSION,
			}) as Promise<string>,
		writeText: (text: unknown) => {
			if (
				typeof text !== 'string' ||
				text.length === 0 ||
				text.length > 1_048_576
			) {
				throw new TypeError('clipboard text is invalid');
			}
			return ipcRenderer.invoke('desktop:clipboard-host:write', {
				text,
				version: DESKTOP_CLIPBOARD_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
	}),
);

/**
 * Terminal zoom is host-owned presentation state, not terminal application
 * state. Keep this read-only capability separate from the legacy broad
 * compatibility API so a workspace renderer cannot acquire unrelated host
 * operations merely to render its terminal at the selected native zoom.
 */
contextBridge.exposeInMainWorld(
	'terminayTerminalPresentationHost',
	Object.freeze({
		version: DESKTOP_TERMINAL_PRESENTATION_HOST_BRIDGE_VERSION,
		subscribeZoom: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('terminal zoom listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (
					typeof value === 'object' &&
					value !== null &&
					!Array.isArray(value) &&
					Object.keys(value).length === 1 &&
					typeof (value as Record<string, unknown>).zoomLevel === 'number' &&
					Number.isFinite((value as Record<string, unknown>).zoomLevel)
				) {
					(listener as (message: TerminalZoomMessage) => void)(
						value as TerminalZoomMessage,
					);
				}
			};
			ipcRenderer.on('terminal:zoom-changed', wrapper);
			return () => ipcRenderer.off('terminal:zoom-changed', wrapper);
		},
		subscribeRemoteSizeOverride: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('terminal remote-size listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (
					typeof message.active !== 'boolean' ||
					typeof message.id !== 'string' ||
					message.id.length === 0 ||
					message.id.length > 512
				)
					return;
				if (message.active) {
					if (
						Object.keys(message).length !== 4 ||
						typeof message.cols !== 'number' ||
						!Number.isSafeInteger(message.cols) ||
						message.cols < 2 ||
						message.cols > 10_000 ||
						typeof message.rows !== 'number' ||
						!Number.isSafeInteger(message.rows) ||
						message.rows < 1 ||
						message.rows > 10_000
					)
						return;
				} else if (Object.keys(message).length !== 2) {
					return;
				}
				(listener as (message: TerminalRemoteSizeOverrideMessage) => void)(
					message as TerminalRemoteSizeOverrideMessage,
				);
			};
			ipcRenderer.on('terminal:remote-size-override', wrapper);
			return () => ipcRenderer.off('terminal:remote-size-override', wrapper);
		},
		getZoom: () =>
			ipcRenderer.invoke(
				'desktop:terminal-presentation-host:get-zoom',
			) as Promise<number>,
		updateMetadata: (sessionId: unknown, metadata: unknown) => {
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			) {
				throw new TypeError('terminal session id is invalid');
			}
			if (
				typeof metadata !== 'object' ||
				metadata === null ||
				Array.isArray(metadata)
			) {
				throw new TypeError('terminal presentation metadata is invalid');
			}
			const metadataProjectId = (metadata as Record<string, unknown>).projectId;
			if (
				typeof metadataProjectId === 'string' &&
				metadataProjectId.length > 0 &&
				metadataProjectId.length <= 128
			) {
				terminalPresentationProjectIds.set(sessionId, metadataProjectId);
			}
			const projectId = terminalPresentationProjectIds.get(sessionId);
			const serverId = serverPorts.keys().next().value;
			if (
				typeof serverId !== 'string' ||
				serverId.length === 0 ||
				serverId.length > 128 ||
				typeof projectId !== 'string' ||
				projectId.length === 0 ||
				projectId.length > 128
			) {
				return;
			}
			ipcRenderer.send('desktop:terminal-presentation-host:update-metadata', {
				metadata,
				projectId,
				serverId,
				sessionId,
				version: DESKTOP_TERMINAL_PRESENTATION_HOST_BRIDGE_VERSION,
			});
		},
	}),
);

/**
 * Waiting for a terminal to become idle is scoped to an already attached
 * server terminal.  Do not retain the historical broad application preload
 * capability merely for this one bounded lifecycle wait.
 */
contextBridge.exposeInMainWorld(
	'terminayTerminalLifecycleHost',
	Object.freeze({
		version: DESKTOP_TERMINAL_LIFECYCLE_HOST_BRIDGE_VERSION,
		waitForInactivity: (identity: unknown, durationMs: unknown) => {
			if (
				typeof identity !== 'object' ||
				identity === null ||
				Array.isArray(identity)
			) {
				throw new TypeError('terminal identity is invalid');
			}
			const value = identity as Record<string, unknown>;
			if (
				typeof value.serverId !== 'string' ||
				value.serverId.length === 0 ||
				value.serverId.length > 128 ||
				typeof value.projectId !== 'string' ||
				value.projectId.length === 0 ||
				value.projectId.length > 128 ||
				typeof value.sessionId !== 'string' ||
				value.sessionId.length === 0 ||
				value.sessionId.length > 512 ||
				typeof value.clientId !== 'string' ||
				value.clientId.length === 0 ||
				value.clientId.length > 128
			) {
				throw new TypeError('terminal identity is invalid');
			}
			if (
				typeof durationMs !== 'number' ||
				!Number.isSafeInteger(durationMs) ||
				durationMs < 0 ||
				durationMs > 86_400_000
			) {
				throw new TypeError('terminal inactivity duration is invalid');
			}
			return ipcRenderer.invoke(
				'desktop:terminal-lifecycle-host:wait-for-inactivity',
				{
					durationMs,
					serverId: value.serverId,
					projectId: value.projectId,
					sessionId: value.sessionId,
					clientId: value.clientId,
					version: DESKTOP_TERMINAL_LIFECYCLE_HOST_BRIDGE_VERSION,
				},
			) as Promise<void>;
		},
	}),
);

/**
 * Revealing a server-authorized workspace item is a native shell action. Keep
 * the production workspace off the broad compatibility preload surface while
 * the privileged host validates the exact request envelope.
 */
contextBridge.exposeInMainWorld(
	'terminayRevealHost',
	Object.freeze({
		version: DESKTOP_REVEAL_HOST_BRIDGE_VERSION,
		reveal: (filePath: unknown) => {
			if (
				typeof filePath !== 'string' ||
				filePath.length === 0 ||
				filePath.length > 32_768
			) {
				throw new TypeError('reveal path is invalid');
			}
			return ipcRenderer.invoke('desktop:reveal-host:reveal', {
				filePath,
				version: DESKTOP_REVEAL_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
	}),
);

/**
 * Installing the local MCP entry changes a host-owned agent configuration.
 * Keep its three bounded operations out of the legacy application preload so
 * an embedded workspace cannot inherit unrelated filesystem/app authority.
 */
contextBridge.exposeInMainWorld(
	'terminayMcpInstallHost',
	Object.freeze({
		version: DESKTOP_MCP_INSTALL_HOST_BRIDGE_VERSION,
		getStatus: () =>
			ipcRenderer.invoke('desktop:mcp-install-host:get-status', {
				version: DESKTOP_MCP_INSTALL_HOST_BRIDGE_VERSION,
			}) as Promise<McpInstallStatus>,
		install: (agent: unknown) => {
			if (agent !== 'claudeCode' && agent !== 'codex')
				throw new TypeError('MCP agent is invalid');
			return ipcRenderer.invoke('desktop:mcp-install-host:install', {
				agent,
				version: DESKTOP_MCP_INSTALL_HOST_BRIDGE_VERSION,
			}) as Promise<McpInstallActionResult>;
		},
		uninstall: (agent: unknown) => {
			if (agent !== 'claudeCode' && agent !== 'codex')
				throw new TypeError('MCP agent is invalid');
			return ipcRenderer.invoke('desktop:mcp-install-host:uninstall', {
				agent,
				version: DESKTOP_MCP_INSTALL_HOST_BRIDGE_VERSION,
			}) as Promise<McpInstallActionResult>;
		},
	}),
);

contextBridge.exposeInMainWorld(
	'terminayRecordingsHost',
	Object.freeze({
		version: DESKTOP_RECORDINGS_HOST_BRIDGE_VERSION,
		open: () =>
			ipcRenderer.invoke('desktop:recordings-host:open', {
				version: DESKTOP_RECORDINGS_HOST_BRIDGE_VERSION,
			}) as Promise<void>,
	}),
);

/**
 * Recording data and lifecycle are a separate Desktop service capability.
 * Do not put these operations back on the ambient `terminay` preload object:
 * the shared recordings client receives only this frozen, named bridge.
 */
contextBridge.exposeInMainWorld(
	'terminayRecordingServiceHost',
	Object.freeze({
		version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
		getTerminalRecordingState: (sessionId: unknown) => {
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			)
				throw new TypeError('recording session id is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:get-state', {
				sessionId,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<TerminalRecordingState>;
		},
		startTerminalRecording: (sessionId: unknown, metadata?: unknown) => {
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			)
				throw new TypeError('recording session id is invalid');
			if (
				metadata !== undefined &&
				(typeof metadata !== 'object' ||
					metadata === null ||
					Array.isArray(metadata))
			)
				throw new TypeError('recording metadata is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:start', {
				...(metadata === undefined ? {} : { metadata }),
				sessionId,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<TerminalRecordingState>;
		},
		stopTerminalRecording: (sessionId: unknown) => {
			if (
				typeof sessionId !== 'string' ||
				sessionId.length === 0 ||
				sessionId.length > 512
			)
				throw new TypeError('recording session id is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:stop', {
				sessionId,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<TerminalRecordingState>;
		},
		listTerminalRecordings: () =>
			ipcRenderer.invoke('desktop:recording-service-host:list', {
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<TerminalRecordingListItem[]>,
		readTerminalRecordingChunk: (request: unknown) => {
			if (
				typeof request !== 'object' ||
				request === null ||
				Array.isArray(request)
			)
				throw new TypeError('recording chunk request is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:read-chunk', {
				...request,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<TerminalRecordingChunk>;
		},
		deleteTerminalRecordingById: (recordingId: unknown) => {
			if (
				typeof recordingId !== 'string' ||
				recordingId.length === 0 ||
				recordingId.length > 512
			)
				throw new TypeError('recording id is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:delete', {
				recordingId,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
		revealTerminalRecordingById: (recordingId: unknown) => {
			if (
				typeof recordingId !== 'string' ||
				recordingId.length === 0 ||
				recordingId.length > 512
			)
				throw new TypeError('recording id is invalid');
			return ipcRenderer.invoke('desktop:recording-service-host:reveal', {
				recordingId,
				version: DESKTOP_RECORDING_SERVICE_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
		onTerminalRecordingChanged: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('recording listener is invalid');
			const wrapper: ElectronListener<TerminalRecordingChangeMessage> = (
				_event,
				message,
			) => listener(message);
			ipcRenderer.on('terminal-recording:changed', wrapper);
			return () => ipcRenderer.off('terminal-recording:changed', wrapper);
		},
	}),
);

/** Closing the current native window is a bounded lifecycle action. */
contextBridge.exposeInMainWorld(
	'terminayWindowLifecycleHost',
	Object.freeze({
		version: DESKTOP_WINDOW_LIFECYCLE_HOST_BRIDGE_VERSION,
		closeCurrent: () =>
			ipcRenderer.invoke('desktop:window-lifecycle-host:close-current', {
				version: DESKTOP_WINDOW_LIFECYCLE_HOST_BRIDGE_VERSION,
			}) as Promise<void>,
	}),
);

/** Opening a native settings window is deliberately not ambient renderer authority. */
contextBridge.exposeInMainWorld(
	'terminaySettingsWindowHost',
	Object.freeze({
		version: DESKTOP_SETTINGS_WINDOW_HOST_BRIDGE_VERSION,
		subscribeFocusSection: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('settings focus listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (
					typeof value === 'object' &&
					value !== null &&
					!Array.isArray(value) &&
					Object.keys(value).length === 1 &&
					typeof (value as Record<string, unknown>).sectionId === 'string' &&
					((value as Record<string, unknown>).sectionId as string).length > 0 &&
					((value as Record<string, unknown>).sectionId as string).length <= 128
				) {
					(listener as (message: { sectionId: string }) => void)(
						value as { sectionId: string },
					);
				}
			};
			ipcRenderer.on('settings:focus-section', wrapper);
			return () => ipcRenderer.off('settings:focus-section', wrapper);
		},
		open: (sectionId?: unknown) => {
			if (
				sectionId !== undefined &&
				(typeof sectionId !== 'string' || sectionId.length > 128)
			) {
				throw new TypeError('settings section id is invalid');
			}
			return ipcRenderer.invoke('desktop:settings-window-host:open', {
				...(sectionId === undefined ? {} : { sectionId }),
				version: DESKTOP_SETTINGS_WINDOW_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
	}),
);

/**
 * The native tab-bar geometry belongs to the current Desktop window only.
 * The renderer can publish one bounded rectangle; it cannot name another
 * window or access broader project/window lifecycle operations.
 */
contextBridge.exposeInMainWorld(
	'terminayProjectTabHost',
	Object.freeze({
		version: DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION,
		subscribeDragHover: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('project tab drag-hover listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (typeof value !== 'object' || value === null || Array.isArray(value))
					return;
				const message = value as Record<string, unknown>;
				if (typeof message.active !== 'boolean') return;
				if (
					message.clientX !== undefined &&
					(typeof message.clientX !== 'number' ||
						!Number.isFinite(message.clientX))
				)
					return;
				if (message.preview !== undefined && message.preview !== null) {
					if (
						typeof message.preview !== 'object' ||
						Array.isArray(message.preview)
					)
						return;
					const preview = message.preview as Record<string, unknown>;
					if (
						typeof preview.title !== 'string' ||
						typeof preview.emoji !== 'string' ||
						typeof preview.color !== 'string' ||
						typeof preview.width !== 'number' ||
						!Number.isFinite(preview.width)
					)
						return;
				}
				(listener as (message: ProjectTabDragHoverMessage) => void)(
					message as ProjectTabDragHoverMessage,
				);
			};
			ipcRenderer.on('app:project-drag-hover', wrapper);
			return () => ipcRenderer.off('app:project-drag-hover', wrapper);
		},
		subscribeTornOff: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('project tab torn-off listener is invalid');
			const wrapper: ElectronListener<unknown> = (_event, value) => {
				if (
					typeof value === 'object' &&
					value !== null &&
					!Array.isArray(value) &&
					Object.keys(value).length === 1 &&
					typeof (value as Record<string, unknown>).active === 'boolean'
				) {
					(listener as (message: { active: boolean }) => void)(
						value as { active: boolean },
					);
				}
			};
			ipcRenderer.on('app:project-tab-torn-off', wrapper);
			return () => ipcRenderer.off('app:project-tab-torn-off', wrapper);
		},
		publishBarRect: (rect: unknown) => {
			if (rect !== null && (typeof rect !== 'object' || Array.isArray(rect))) {
				throw new TypeError('project tab-bar rectangle is invalid');
			}
			if (rect !== null) {
				const candidate = rect as Record<string, unknown>;
				if (
					Object.keys(candidate).length !== 4 ||
					!['height', 'width', 'x', 'y'].every((key) =>
						hasOwn(candidate, key),
					) ||
					!Object.values(candidate).every(
						(value) => typeof value === 'number' && Number.isFinite(value),
					)
				) {
					throw new TypeError('project tab-bar rectangle is invalid');
				}
			}
			return ipcRenderer.invoke('desktop:project-tab-host:publish-bar-rect', {
				rect,
				version: DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
		startDrag: (preview: unknown) => {
			if (
				typeof preview !== 'object' ||
				preview === null ||
				Array.isArray(preview)
			) {
				throw new TypeError('project tab drag preview is invalid');
			}
			const candidate = preview as Record<string, unknown>;
			if (
				Object.keys(candidate).length !== 4 ||
				!['color', 'emoji', 'title', 'width'].every((key) =>
					hasOwn(candidate, key),
				) ||
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
				throw new TypeError('project tab drag preview is invalid');
			}
			return ipcRenderer.invoke('desktop:project-tab-host:start-drag', {
				preview: candidate,
				version: DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION,
			}) as Promise<void>;
		},
		endDrag: () =>
			ipcRenderer.invoke('desktop:project-tab-host:end-drag', {
				version: DESKTOP_PROJECT_TAB_HOST_BRIDGE_VERSION,
			}) as Promise<ProjectTabDragResult>,
	}),
);

/**
 * Moving a project between native windows is a Desktop shell operation.  The
 * renderer gets only the three transfer actions it needs; it cannot recover
 * the historical application-wide preload object to do so.
 */
contextBridge.exposeInMainWorld(
	'terminayWorkspaceTransferHost',
	Object.freeze({
		version: DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION,
		subscribeAdoptedProject: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('workspace transfer listener is invalid');
			const wrapper: ElectronListener<AdoptedProjectPayload> = (
				_event,
				payload,
			) => {
				if (isWorkspaceTransferPayload(payload)) {
					(listener as (value: AdoptedProjectPayload) => void)(payload);
				}
			};
			ipcRenderer.on('app:adopt-project', wrapper);
			return () => ipcRenderer.off('app:adopt-project', wrapper);
		},
		getAdoptedProject: () =>
			ipcRenderer.invoke(
				'desktop:workspace-transfer-host:get-adopted-project',
				{
					version: DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION,
				},
			) as Promise<AdoptedProjectPayload | null>,
		popoutProject: (project: unknown, x: unknown, y: unknown) => {
			if (
				!isWorkspaceTransferPayload(project) ||
				typeof x !== 'number' ||
				!Number.isFinite(x) ||
				Math.abs(x) > 100_000 ||
				typeof y !== 'number' ||
				!Number.isFinite(y) ||
				Math.abs(y) > 100_000
			) {
				throw new TypeError(
					'workspace transfer popout coordinates are invalid',
				);
			}
			return ipcRenderer.invoke(
				'desktop:workspace-transfer-host:popout-project',
				{
					project,
					version: DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION,
					x,
					y,
				},
			) as Promise<{ ok: boolean; windowId?: number }>;
		},
		mergeProject: (project: unknown, targetWindowId: unknown) => {
			if (
				!isWorkspaceTransferPayload(project) ||
				typeof targetWindowId !== 'number' ||
				!Number.isSafeInteger(targetWindowId) ||
				targetWindowId < 1 ||
				targetWindowId > 2_147_483_647
			) {
				throw new TypeError('workspace transfer target window id is invalid');
			}
			return ipcRenderer.invoke(
				'desktop:workspace-transfer-host:merge-project',
				{
					project,
					targetWindowId,
					version: DESKTOP_WORKSPACE_TRANSFER_HOST_BRIDGE_VERSION,
				},
			) as Promise<{ ok: boolean }>;
		},
	}),
);

/** Native menus and keyboard shortcuts deliver only the closed command union. */
contextBridge.exposeInMainWorld(
	'terminayAppCommandHost',
	Object.freeze({
		version: DESKTOP_APP_COMMAND_HOST_BRIDGE_VERSION,
		subscribe: (listener: unknown) => {
			if (typeof listener !== 'function')
				throw new TypeError('app command listener is invalid');
			const wrapper = (
				_event: Electron.IpcRendererEvent,
				command: unknown,
				requestId?: unknown,
			) => {
				if (!isAppCommand(command)) return;
				void Promise.resolve(
					(listener as (value: AppCommand) => Promise<void> | void)(command),
				).then(
					() => {
						if (typeof requestId === 'string') {
							ipcRenderer.send('test:app-command-complete', requestId, null);
						}
					},
					(error) => {
						if (typeof requestId === 'string') {
							ipcRenderer.send(
								'test:app-command-complete',
								requestId,
								error instanceof Error ? error.message : String(error),
							);
						}
					},
				);
			};
			ipcRenderer.on('app:command', wrapper);
			return () => ipcRenderer.off('app:command', wrapper);
		},
	}),
);

if (process.env.TERMINAY_TEST === '1') {
	contextBridge.exposeInMainWorld(
		'terminayBootstrapDiagnostic',
		Object.freeze({
			record: terminayApi.recordBootstrapDiagnostic,
		}),
	);
	const testApi: TerminayTestApi = {
		createServerTerminal: (options = {}) =>
			ipcRenderer.invoke('test:create-server-terminal', options) as Promise<{
				id: string;
			}>,
		writeServerTerminal: (sessionId, data) =>
			ipcRenderer.invoke('test:write-server-terminal', {
				data,
				sessionId,
			}) as Promise<void>,
		getServerTerminalCwd: (sessionId) =>
			ipcRenderer.invoke('test:get-server-terminal-cwd', {
				sessionId,
			}) as ReturnType<TerminayTestApi['getServerTerminalCwd']>,
		getServerGitWorkspace: (sessionId) =>
			ipcRenderer.invoke('test:get-server-git-workspace', {
				sessionId,
			}) as ReturnType<TerminayTestApi['getServerGitWorkspace']>,
		getServerTerminalActivity: (sessionId) =>
			ipcRenderer.invoke('test:get-server-terminal-activity', {
				sessionId,
			}) as ReturnType<TerminayTestApi['getServerTerminalActivity']>,
		emitAgentHook: (payload) =>
			ipcRenderer.invoke('test:emit-agent-hook', payload) as Promise<number>,
		getMcpControlEnvironment: (terminalSessionId) =>
			ipcRenderer.invoke('test:get-mcp-control-environment', {
				terminalSessionId,
			}) as Promise<{ socketPath: string; token: string }>,
		sendAppCommand: (command) =>
			ipcRenderer.invoke('test:send-app-command', command) as Promise<void>,
		setAiTabMetadataMock: (mock) =>
			ipcRenderer.invoke(
				'test:set-ai-tab-metadata-mock',
				mock,
			) as Promise<void>,
	};

	contextBridge.exposeInMainWorld('terminayTest', testApi);
}
