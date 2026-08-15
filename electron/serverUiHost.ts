import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	parseTerminayHostActionRequest,
	parseTerminayHostContext,
	requiredTerminayHostCapability,
	type TerminayHostActionRequest,
	type TerminayHostContext,
} from '@terminay/protocol';
import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	type DownloadItem,
	type Event,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	ipcMain,
	type WebContents,
	type WebContentsWillFrameNavigateEventParams,
	type WebContentsWillNavigateEventParams,
	type WebContentsWillRedirectEventParams,
} from 'electron';
import {
	DesktopDocumentLifecycle,
	type DesktopDocumentLifecycleDiagnostic,
	type DesktopDocumentReleaseReason,
} from '../apps/terminay-desktop/src/main/documentLifecycle';

const SERVER_UI_GET_CONTEXT_CHANNEL = 'server-ui-host:get-context';
const SERVER_UI_REQUEST_ACTION_CHANNEL = 'server-ui-host:request-action';
const SERVER_UI_READ_TERMINAL_CLIPBOARD_CHANNEL =
	'server-ui-host:read-terminal-clipboard';
const OPAQUE_PARTITION_KEY_PATTERN = /^[a-zA-Z0-9_-]{22,128}$/;

type ServerUiBinding = {
	context: TerminayHostContext;
	expectedOrigin: string;
	allowedFileRoot?: string;
	onHostAction?: (
		action: TerminayHostActionRequest,
		context: TerminayHostContext,
	) => Promise<unknown> | unknown;
	readTerminalClipboard?: () => Promise<string> | string;
	window: BrowserWindow;
	lifecycle: DesktopDocumentLifecycle;
};

export type CreateServerUiWindowOptions = {
	expectedOrigin: string;
	height?: number;
	hostPartitionKey: string;
	initialUrl: string;
	context: TerminayHostContext;
	onHostAction?: ServerUiBinding['onHostAction'];
	readTerminalClipboard?: ServerUiBinding['readTerminalClipboard'];
	onLifecycleDiagnostic?: (event: DesktopDocumentLifecycleDiagnostic) => void;
	preloadPath: string;
	show?: boolean;
	title?: string;
	width?: number;
};

export type BindServerUiWindowOptions = CreateServerUiWindowOptions & {
	window: BrowserWindow;
};

const bindings = new Map<number, ServerUiBinding>();
let ipcInstalled = false;

function parseOrigin(value: string, name: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be an absolute URL.`);
	}

	const isSecureRemote = url.protocol === 'https:';
	const isEmbeddedFile = url.protocol === 'file:';
	const isLoopbackHttp =
		url.protocol === 'http:' &&
		(url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname === 'localhost');
	if (!isSecureRemote && !isLoopbackHttp && !isEmbeddedFile) {
		throw new Error(
			`${name} must use HTTPS, except for an embedded loopback server.`,
		);
	}

	return url.origin;
}

function bindingForEvent(
	event: IpcMainEvent | IpcMainInvokeEvent,
): ServerUiBinding {
	const binding = bindings.get(event.sender.id);
	if (!binding || binding.window.isDestroyed()) {
		throw new Error('This server UI is not bound to a desktop profile.');
	}

	const senderFrame = event.senderFrame;
	if (!senderFrame) {
		throw new Error('This server UI sender has no bound frame.');
	}
	const senderOrigin = parseOrigin(senderFrame.url, 'The server UI sender');
	if (
		senderOrigin !== binding.expectedOrigin ||
		senderFrame !== event.sender.mainFrame
	) {
		throw new Error('This server UI sender is outside its bound origin.');
	}

	return binding;
}

/** Validate host IPC against the same closed document binding used by host
 * action invocations. Server UI documents deliberately have a different
 * origin from the application shell. */
export function assertBoundServerUiEvent(
	event: IpcMainEvent | IpcMainInvokeEvent,
): void {
	bindingForEvent(event);
}

function installIpcHandlers(): void {
	if (ipcInstalled) {
		return;
	}
	ipcInstalled = true;

	ipcMain.handle(SERVER_UI_GET_CONTEXT_CHANNEL, (event) => {
		return bindingForEvent(event).context;
	});
	ipcMain.handle(
		SERVER_UI_REQUEST_ACTION_CHANNEL,
		async (event, value: unknown) => {
			const binding = bindingForEvent(event);
			const action = parseTerminayHostActionRequest(value, binding.context);
			const capability = requiredTerminayHostCapability(action.action);
			if (
				capability !== undefined &&
				binding.context.capabilities[capability] === undefined
			)
				throw new Error(`Host capability is unavailable: ${capability}`);
			return binding.onHostAction?.(action, binding.context);
		},
	);
	ipcMain.handle(SERVER_UI_READ_TERMINAL_CLIPBOARD_CHANNEL, async (event) => {
		const binding = bindingForEvent(event);
		return (await binding.readTerminalClipboard?.()) ?? '';
	});
}

function isAllowedNavigation(
	target: string,
	expectedOrigin: string,
	allowedFileRoot?: string,
): boolean {
	try {
		const url = new URL(target);
		if (allowedFileRoot !== undefined) {
			if (url.protocol !== 'file:') return false;
			const candidate = path.resolve(fileURLToPath(url));
			const relative = path.relative(allowedFileRoot, candidate);
			return (
				relative === '' ||
				(!relative.startsWith(`..${path.sep}`) &&
					relative !== '..' &&
					!path.isAbsolute(relative))
			);
		}
		return url.origin === expectedOrigin;
	} catch {
		return false;
	}
}

function denyDownloadForWindow(
	targetWebContentsId: number,
	event: Event,
	item: DownloadItem,
	sourceWebContents: WebContents,
): void {
	if (sourceWebContents.id !== targetWebContentsId) {
		return;
	}
	event.preventDefault();
	item.cancel();
}

export function createServerUiPartitionKey(): string {
	return randomBytes(24).toString('base64url');
}

export function getServerUiPartitionName(hostPartitionKey: string): string {
	if (!OPAQUE_PARTITION_KEY_PATTERN.test(hostPartitionKey)) {
		throw new Error(
			'The server UI partition key must be an opaque host-generated value.',
		);
	}

	const digest = createHash('sha256')
		.update(hostPartitionKey)
		.digest('base64url')
		.slice(0, 32);
	return `persist:terminay-server-${digest}`;
}

export function createServerUiWindow(
	options: CreateServerUiWindowOptions,
): BrowserWindow {
	const expectedOrigin = parseOrigin(
		options.expectedOrigin,
		'The expected server origin',
	);
	const initialUrl = new URL(options.initialUrl);
	if (initialUrl.origin !== expectedOrigin) {
		throw new Error('The initial server UI URL must use the expected origin.');
	}

	const context = parseTerminayHostContext(options.context);
	const windowOptions: BrowserWindowConstructorOptions = {
		height: options.height ?? 900,
		show: options.show ?? true,
		title: options.title ?? `Terminay — ${context.profileId}`,
		webPreferences: {
			allowRunningInsecureContent: false,
			contextIsolation: true,
			nodeIntegration: false,
			partition: getServerUiPartitionName(options.hostPartitionKey),
			preload: options.preloadPath,
			sandbox: true,
			webSecurity: true,
			webviewTag: false,
		},
		width: options.width ?? 1400,
	};
	const window = new BrowserWindow(windowOptions);
	bindServerUiWindow({ ...options, window });
	void window.loadURL(initialUrl.toString());
	return window;
}

/** Bind an already-created native shell to the same canonical server-UI
 * policy. This lets normal Desktop startup retain native lifecycle ownership
 * while using the exact verified bundle and narrow preload. */
export function bindServerUiWindow(
	options: BindServerUiWindowOptions,
): BrowserWindow {
	installIpcHandlers();
	const window = options.window;
	const expectedOrigin = parseOrigin(
		options.expectedOrigin,
		'The expected server origin',
	);
	const initialUrl = new URL(options.initialUrl);
	if (initialUrl.origin !== expectedOrigin)
		throw new Error('The initial server UI URL must use the expected origin.');
	const context = parseTerminayHostContext(options.context);
	const targetWebContents = window.webContents;
	const webContentsId = targetWebContents.id;
	const targetSession = targetWebContents.session;
	let targetWebContentsDestroyed = false;
	releaseServerUiWindowBinding(webContentsId, 'server-switch');
	const lifecycle = new DesktopDocumentLifecycle(options.onLifecycleDiagnostic);
	const allowedFileRoot =
		initialUrl.protocol === 'file:'
			? path.dirname(path.resolve(fileURLToPath(initialUrl)))
			: undefined;
	const binding: ServerUiBinding = {
		context,
		expectedOrigin,
		...(allowedFileRoot === undefined ? {} : { allowedFileRoot }),
		onHostAction: options.onHostAction,
		window,
		lifecycle,
	};
	bindings.set(webContentsId, binding);
	lifecycle.add('host-binding', () => {
		if (bindings.get(webContentsId) === binding) bindings.delete(webContentsId);
	});

	targetWebContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	const denyWebviewAttachment = (event: Event) => {
		event.preventDefault();
	};
	const restrictFrameNavigation = (
		event: Event<WebContentsWillFrameNavigateEventParams>,
	) => {
		if (!isAllowedNavigation(event.url, expectedOrigin, allowedFileRoot)) {
			event.preventDefault();
		}
	};
	const restrictNavigation = (
		event: Event<WebContentsWillNavigateEventParams>,
		target: string,
	) => {
		if (!isAllowedNavigation(target, expectedOrigin, allowedFileRoot)) {
			event.preventDefault();
		}
	};
	const restrictRedirect = (
		event: Event<WebContentsWillRedirectEventParams>,
		target: string,
	) => {
		if (!isAllowedNavigation(target, expectedOrigin, allowedFileRoot)) {
			event.preventDefault();
		}
	};
	targetWebContents.on('will-attach-webview', denyWebviewAttachment);
	targetWebContents.on('will-frame-navigate', restrictFrameNavigation);
	targetWebContents.on('will-navigate', restrictNavigation);
	targetWebContents.on('will-redirect', restrictRedirect);
	// A BrowserWindow can switch only after its old server-UI policy is fully
	// retired. Leaving these listeners attached made the former file-root deny
	// a verified bundle from the newly selected server, leaving the old
	// Connections dialog visible indefinitely.
	lifecycle.add('navigation-policy', () => {
		// Electron has already invalidated this object when the destroyed
		// callback releases the lifecycle. Its listeners disappear with it, so
		// there is nothing left to detach and no safe WebContents API to call.
		if (targetWebContentsDestroyed) return;
		targetWebContents.off('will-attach-webview', denyWebviewAttachment);
		targetWebContents.off('will-frame-navigate', restrictFrameNavigation);
		targetWebContents.off('will-navigate', restrictNavigation);
		targetWebContents.off('will-redirect', restrictRedirect);
	});

	const denyDownload = (
		event: Event,
		item: DownloadItem,
		sourceWebContents: WebContents,
	) => denyDownloadForWindow(webContentsId, event, item, sourceWebContents);
	targetSession.on('will-download', denyDownload);
	lifecycle.add('download-listener', () => {
		targetSession.off('will-download', denyDownload);
	});
	targetSession.setPermissionCheckHandler(() => false);
	targetSession.setPermissionRequestHandler(
		(_webContents, _permission, callback) => callback(false),
	);
	lifecycle.add('permission-handlers', () => {
		targetSession.setPermissionCheckHandler(null);
		targetSession.setPermissionRequestHandler(null);
	});

	// Capture every Electron-owned object above. A destroyed callback must never
	// reach back through WebContents to obtain its id, Session, or listener API.
	targetWebContents.once('destroyed', () => {
		targetWebContentsDestroyed = true;
		lifecycle.release('window-close');
	});
	window.once('closed', () => lifecycle.release('window-close'));

	return window;
}

/** Explicit cleanup for failed launch, profile switch, reload, and quit paths.
 * Repeated native events are harmless and cannot release another binding that
 * subsequently reused the same WebContents id. */
export function releaseServerUiWindowBinding(
	webContentsId: number,
	reason: DesktopDocumentReleaseReason,
): boolean {
	return bindings.get(webContentsId)?.lifecycle.release(reason) ?? false;
}
