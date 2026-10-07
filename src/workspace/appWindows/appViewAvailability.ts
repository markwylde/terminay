/**
 * Whether this host can run an app window's view (ADR-0038).
 *
 * A view runs inside the sandbox proxy document shipped with the workspace
 * bundle. The workspace proves the proxy answers before it offers app windows:
 * on a host that cannot frame it, windows are reported unavailable rather than
 * run any other way.
 */

export const APP_VIEW_PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
/** What the workspace sends the proxy: the document its view is to run. */
export const APP_VIEW_RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';
/** Marks what the proxy itself says about its view, which a view cannot send. */
export const APP_VIEW_PROXY_KEY = 'terminayProxy';
export const APP_VIEW_SANDBOX = 'allow-scripts allow-forms';
const PROBE_TIMEOUT_MS = 4000;

/** The proxy document's URL, beside the workspace document. */
export function appViewProxyUrl(base: string = document.baseURI): string {
	return new URL('app-view.html', base).toString();
}

export interface AppViewProbeEnvironment {
	createFrame(): {
		readonly contentWindow: unknown;
		setAttribute(name: string, value: string): void;
		remove(): void;
		src: string;
		style: { cssText: string };
	};
	mount(frame: unknown): void;
	onMessage(listener: (event: { source: unknown; data: unknown }) => void): () => void;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	proxyUrl: string;
}

/** Load the proxy once, out of sight, and report whether it answered. */
export function probeAppView(environment: AppViewProbeEnvironment): Promise<boolean> {
	return new Promise((resolve) => {
		const frame = environment.createFrame();
		let settled = false;
		const finish = (available: boolean): void => {
			if (settled) return;
			settled = true;
			environment.clearTimeout(timer);
			stop();
			frame.remove();
			resolve(available);
		};
		const stop = environment.onMessage((event) => {
			if (event.source !== frame.contentWindow) return;
			const data = event.data as { method?: unknown } | null;
			if (data !== null && typeof data === 'object' && data.method === APP_VIEW_PROXY_READY)
				finish(true);
		});
		const timer = environment.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
		frame.setAttribute('sandbox', APP_VIEW_SANDBOX);
		frame.setAttribute('aria-hidden', 'true');
		frame.setAttribute('tabindex', '-1');
		frame.style.cssText =
			'position:fixed;width:1px;height:1px;left:-10px;top:-10px;border:0;visibility:hidden';
		frame.src = environment.proxyUrl;
		try {
			environment.mount(frame);
		} catch {
			finish(false);
		}
	});
}

let availability: Promise<boolean> | undefined;

/** Probed once per workspace document. */
export function appViewAvailable(): Promise<boolean> {
	availability ??= probeAppView({
		createFrame: () => document.createElement('iframe'),
		mount: (frame) => document.body.append(frame as HTMLIFrameElement),
		onMessage: (listener) => {
			const handler = (event: MessageEvent): void =>
				listener({ source: event.source, data: event.data });
			window.addEventListener('message', handler);
			return () => window.removeEventListener('message', handler);
		},
		setTimeout: (callback, ms) => window.setTimeout(callback, ms),
		clearTimeout: (handle) => window.clearTimeout(handle as number),
		proxyUrl: appViewProxyUrl(),
	});
	return availability;
}
