import type { BrowserWindow, Event, WebContents } from 'electron';
import {
	isStateUnreadableError,
	type StateStoreName,
	type StateUnreadableError,
	startStateFresh,
} from '../packages/server-core/src/durableFile.ts';

const RETRY_URL = 'https://terminay.invalid/retry';
const START_FRESH_URL = 'https://terminay.invalid/start-fresh';

/** What each canonical store holds, in the user's words. Never a path. */
const STORE_DESCRIPTIONS: Record<StateStoreName, string> = {
	workspace: 'workspace: your projects, tabs and layout',
	'desktop-identity': 'device identity',
	'server-settings': 'settings',
	'device-settings': 'terminal settings for this device',
	'remote-access-settings': 'remote access settings',
	macros: 'macros',
	automations: 'automations',
	'connected-servers': 'connected MCP servers',
	'connection-profiles': 'saved connections',
	'window-layout': 'window layout',
	extensions: 'extension choices',
};

/** The recovery text for a corrupt store with no good copy. */
export function stateUnreadableMessage(store: StateStoreName): string {
	return `Terminay's saved ${STORE_DESCRIPTIONS[store] ?? 'state'} is damaged, and there is no earlier copy to restore. Start fresh to begin it empty; the damaged file is kept beside it. Retry checks again without changing anything.`;
}

/** Enough for a general failure. A message that has to name paths asks for
 * more. */
const DEFAULT_MESSAGE_LIMIT = 320;

function boundedLaunchError(error: unknown, limit: number): string {
	const message = error instanceof Error ? error.message : String(error);
	return Array.from(message, (character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127 ? ' ' : character;
	})
		.join('')
		.slice(0, limit);
}

function launchRecoveryDocument(message: string, offerStartFresh: boolean): string {
	const escaped = message
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
	const html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Terminay recovery</title><style>html{color-scheme:dark;font:15px system-ui;background:#0e1319;color:#edf2f8}body{min-height:100vh;margin:0;display:grid;place-items:center}.panel{width:min(560px,calc(100vw - 48px));padding:28px;border:1px solid #334050;border-radius:12px;background:#151c24}h1{font-size:22px;margin:0 0 10px}p{color:#aeb9c8;line-height:1.5}a{display:inline-block;margin:12px 10px 0 0;padding:10px 18px;border-radius:7px;background:#1687f8;color:white;text-decoration:none;font-weight:650}a.secondary{background:#26313d}</style></head><body><main class="panel" role="alert"><h1>Terminay could not open this workspace</h1><p>${escaped}</p>${offerStartFresh ? `<a href="${START_FRESH_URL}">Start fresh</a><a class="secondary" href="${RETRY_URL}">Retry</a>` : `<a href="${RETRY_URL}">Retry</a>`}</main></body></html>`;
	return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

/** Overlapping `loadURL` calls leave Chromium pending on macOS/Linux CI. Stop
 * the current document first so recovery can replace the startup loader. */
async function settleInFlightNavigation(
	webContents: WebContents,
): Promise<void> {
	try {
		if (!webContents.isDestroyed() && webContents.isLoading()) {
			webContents.stop();
		}
	} catch {
		// Native teardown has already retired the document.
	}
	await new Promise<void>((resolve) => {
		setImmediate(resolve);
	});
}

export async function showCanonicalLaunchRecovery(
	options: Readonly<{
		window: BrowserWindow;
		error: unknown;
		/** How much of the message is shown. A few hundred characters unless
		 * the message has to carry paths. */
		messageLimit?: number;
		retry: () => Promise<void>;
		onDiagnostic: (message: string) => Promise<void> | void;
		onRecoveryState: (active: boolean) => void;
	}>,
): Promise<void> {
	if (options.window.isDestroyed()) return;
	// Retain the Electron handle while the window is live. A later asynchronous
	// failure can race native destruction, where reading `window.webContents`
	// again is itself an Electron exception.
	const targetWebContents = options.window.webContents;
	// A corrupt store with no good copy is the user's call (ADR-0088): offer
	// Start fresh beside Retry, and name the store, never its file.
	const unreadable: StateUnreadableError | undefined = isStateUnreadableError(
		options.error,
	)
		? (options.error as StateUnreadableError)
		: undefined;
	const message =
		unreadable === undefined
			? boundedLaunchError(options.error, options.messageLimit ?? DEFAULT_MESSAGE_LIMIT)
			: stateUnreadableMessage(unreadable.store);
	// Diagnostics are evidence, never a prerequisite for a usable recovery
	// document. In particular, a full or unavailable diagnostics volume must not
	// turn a caught bootstrap failure back into an unhandled main-process
	// rejection.
	try {
		await options.onDiagnostic(message);
	} catch {
		// The caller's normal stderr/fatal diagnostics path remains available.
	}

	let recoveryActive = false;
	const setRecoveryState = (active: boolean) => {
		if (recoveryActive === active) return;
		recoveryActive = active;
		try {
			options.onRecoveryState(active);
		} catch {
			// State observation cannot be allowed to prevent recovery rendering.
		}
	};
	const retryNavigation = (event: Event, target: string) => {
		const startFresh = unreadable !== undefined && target === START_FRESH_URL;
		if (target !== RETRY_URL && !startFresh) return;
		event.preventDefault();
		if (startFresh) {
			try {
				startStateFresh(unreadable);
			} catch {
				// The files could not be moved aside; the retry below fails the
				// same check and shows this document again.
			}
		}
		setRecoveryState(false);
		try {
			targetWebContents.off('will-navigate', retryNavigation);
		} catch {
			// Native teardown has already retired the document.
		}
		// Let Electron finish cancelling the synthetic navigation before retrying.
		// Loading the recovery document again from inside `will-navigate` leaves the
		// webContents in a permanently pending navigation state on macOS/Linux CI.
		setImmediate(() => {
			void Promise.resolve()
				.then(options.retry)
				.catch((error) => showCanonicalLaunchRecovery({ ...options, error }));
		});
	};
	try {
		targetWebContents.on('will-navigate', retryNavigation);
		setRecoveryState(true);
		await settleInFlightNavigation(targetWebContents);
		if (options.window.isDestroyed() || targetWebContents.isDestroyed()) {
			throw new Error('recovery window destroyed');
		}
		await options.window.loadURL(
			launchRecoveryDocument(message, unreadable !== undefined),
		);
		if (!options.window.isDestroyed()) options.window.show();
	} catch {
		// A WebContents can be destroyed while this asynchronous recovery document
		// is loading. Remove the listener and contain that race: Electron must not
		// surface an uncaught rejection or a second native error dialog.
		try {
			targetWebContents.off('will-navigate', retryNavigation);
		} catch {
			// Native teardown has already retired the document.
		}
		setRecoveryState(false);
	}
}
