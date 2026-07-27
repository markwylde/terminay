import { createHash, randomBytes } from 'node:crypto';
import {
	BrowserWindow,
	type BrowserWindowConstructorOptions,
	type DownloadItem,
	type Event,
	type IpcMainInvokeEvent,
	ipcMain,
	type WebContents,
} from 'electron';
import type {
	ServerUiHostAction,
	ServerUiHostContext,
} from './serverUiHostContract';

const SERVER_UI_GET_CONTEXT_CHANNEL = 'server-ui-host:get-context';
const SERVER_UI_REQUEST_ACTION_CHANNEL = 'server-ui-host:request-action';
const OPAQUE_PARTITION_KEY_PATTERN = /^[a-zA-Z0-9_-]{22,128}$/;
const PROFILE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

type ServerUiBinding = {
	context: ServerUiHostContext;
	expectedOrigin: string;
	onHostAction?: (
		action: ServerUiHostAction,
		context: ServerUiHostContext,
	) => Promise<void> | void;
	window: BrowserWindow;
};

export type CreateServerUiWindowOptions = {
	expectedOrigin: string;
	height?: number;
	hostPartitionKey: string;
	initialUrl: string;
	label: string;
	onHostAction?: ServerUiBinding['onHostAction'];
	preloadPath: string;
	profileId: string;
	show?: boolean;
	title?: string;
	width?: number;
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
	const isLoopbackHttp =
		url.protocol === 'http:' &&
		(url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname === 'localhost');
	if (!isSecureRemote && !isLoopbackHttp) {
		throw new Error(
			`${name} must use HTTPS, except for an embedded loopback server.`,
		);
	}

	return url.origin;
}

function normalizeProfile(
	profileId: string,
	label: string,
): ServerUiHostContext['profile'] {
	if (!PROFILE_ID_PATTERN.test(profileId)) {
		throw new Error('The host profile id is invalid.');
	}

	const normalizedLabel = label.trim();
	if (!normalizedLabel || normalizedLabel.length > 160) {
		throw new Error('The host profile label is invalid.');
	}

	return Object.freeze({
		id: profileId,
		label: normalizedLabel,
	});
}

function normalizeAction(value: unknown): ServerUiHostAction {
	if (!value || typeof value !== 'object') {
		throw new Error('A host action is required.');
	}

	const action = value as Record<string, unknown>;
	const keys = Object.keys(action).sort();
	if (
		(action.type === 'close-window' || action.type === 'manage-connections') &&
		keys.length === 1 &&
		keys[0] === 'type'
	) {
		return Object.freeze({ type: action.type });
	}

	if (
		action.type === 'open-connection' &&
		keys.length === 2 &&
		keys[0] === 'profileId' &&
		keys[1] === 'type' &&
		typeof action.profileId === 'string' &&
		PROFILE_ID_PATTERN.test(action.profileId)
	) {
		return Object.freeze({
			profileId: action.profileId,
			type: action.type,
		});
	}

	throw new Error('That host action is not allowed.');
}

function bindingForEvent(event: IpcMainInvokeEvent): ServerUiBinding {
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
			const action = normalizeAction(value);
			await binding.onHostAction?.(action, binding.context);
		},
	);
}

function isAllowedNavigation(target: string, expectedOrigin: string): boolean {
	try {
		return new URL(target).origin === expectedOrigin;
	} catch {
		return false;
	}
}

function denyDownloadForWindow(
	targetWebContents: WebContents,
	event: Event,
	item: DownloadItem,
	sourceWebContents: WebContents,
): void {
	if (sourceWebContents.id !== targetWebContents.id) {
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
	installIpcHandlers();

	const expectedOrigin = parseOrigin(
		options.expectedOrigin,
		'The expected server origin',
	);
	const initialUrl = new URL(options.initialUrl);
	if (initialUrl.origin !== expectedOrigin) {
		throw new Error('The initial server UI URL must use the expected origin.');
	}

	const context: ServerUiHostContext = Object.freeze({
		hostKind: 'desktop',
		profile: normalizeProfile(options.profileId, options.label),
	});
	const windowOptions: BrowserWindowConstructorOptions = {
		height: options.height ?? 900,
		show: options.show ?? true,
		title: options.title ?? `Terminay — ${context.profile.label}`,
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
	const targetWebContents = window.webContents;
	const binding: ServerUiBinding = {
		context,
		expectedOrigin,
		onHostAction: options.onHostAction,
		window,
	};
	bindings.set(targetWebContents.id, binding);

	targetWebContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	targetWebContents.on('will-attach-webview', (event) => {
		event.preventDefault();
	});
	targetWebContents.on('will-frame-navigate', (event) => {
		if (!isAllowedNavigation(event.url, expectedOrigin)) {
			event.preventDefault();
		}
	});
	targetWebContents.on('will-navigate', (event, target) => {
		if (!isAllowedNavigation(target, expectedOrigin)) {
			event.preventDefault();
		}
	});
	targetWebContents.on('will-redirect', (event, target) => {
		if (!isAllowedNavigation(target, expectedOrigin)) {
			event.preventDefault();
		}
	});

	const denyDownload = (
		event: Event,
		item: DownloadItem,
		sourceWebContents: WebContents,
	) => denyDownloadForWindow(targetWebContents, event, item, sourceWebContents);
	targetWebContents.session.on('will-download', denyDownload);
	targetWebContents.session.setPermissionCheckHandler(() => false);
	targetWebContents.session.setPermissionRequestHandler(
		(_webContents, _permission, callback) => callback(false),
	);

	targetWebContents.once('destroyed', () => {
		bindings.delete(targetWebContents.id);
		targetWebContents.session.off('will-download', denyDownload);
	});

	void window.loadURL(initialUrl.toString());
	return window;
}
