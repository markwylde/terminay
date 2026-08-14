import type { BrowserWindow, Event } from 'electron';

function boundedLaunchError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return Array.from(message, (character) => {
		const code = character.codePointAt(0) ?? 0;
		return code < 32 || code === 127 ? ' ' : character;
	})
		.join('')
		.slice(0, 320);
}

function launchRecoveryDocument(message: string): string {
	const escaped = message
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
	const html = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Terminay recovery</title><style>html{color-scheme:dark;font:15px system-ui;background:#0e1319;color:#edf2f8}body{min-height:100vh;margin:0;display:grid;place-items:center}.panel{width:min(560px,calc(100vw - 48px));padding:28px;border:1px solid #334050;border-radius:12px;background:#151c24}h1{font-size:22px;margin:0 0 10px}p{color:#aeb9c8;line-height:1.5}a{display:inline-block;margin-top:12px;padding:10px 18px;border-radius:7px;background:#1687f8;color:white;text-decoration:none;font-weight:650}</style></head><body><main class="panel" role="alert"><h1>Terminay could not open this workspace</h1><p>${escaped}</p><a href="https://terminay.invalid/retry">Retry</a></main></body></html>`;
	return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}

export async function showCanonicalLaunchRecovery(
	options: Readonly<{
		window: BrowserWindow;
		error: unknown;
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
	const message = boundedLaunchError(options.error);
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
		if (target !== 'https://terminay.invalid/retry') return;
		event.preventDefault();
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
				.catch((error) =>
					showCanonicalLaunchRecovery({ ...options, error }),
				);
		});
	};
	try {
		targetWebContents.on('will-navigate', retryNavigation);
		setRecoveryState(true);
		await options.window.loadURL(launchRecoveryDocument(message));
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
