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
	const message = boundedLaunchError(options.error);
	await options.onDiagnostic(message);
	const retryNavigation = (event: Event, target: string) => {
		if (target !== 'https://terminay.invalid/retry') return;
		event.preventDefault();
		options.onRecoveryState(false);
		options.window.webContents.off('will-navigate', retryNavigation);
		void options.retry();
	};
	options.window.webContents.on('will-navigate', retryNavigation);
	options.onRecoveryState(true);
	await options.window.loadURL(launchRecoveryDocument(message));
}
