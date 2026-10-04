/**
 * Builds the document an app window's view runs (ADR-0038).
 *
 * The workspace, not the sandbox proxy, decides what a view may load: it embeds
 * a content security policy chosen from the window's source at the very start
 * of the document, before any of the view's own markup can run. An
 * agent-authored view also gets a small bootstrap so plain HTML works without
 * the author knowing the MCP Apps protocol.
 */

import { MIRROR_LOADER_SCRIPT } from './mirror/mirrorProtocol.ts';

export type ViewSource =
	| { readonly kind: 'agent' }
	| { readonly kind: 'mcp-app' };

export interface ViewCsp {
	readonly connectDomains?: readonly string[];
	readonly resourceDomains?: readonly string[];
	readonly frameDomains?: readonly string[];
	readonly baseUriDomains?: readonly string[];
}

export interface ViewDocumentInput {
	readonly html: string;
	readonly source: ViewSource;
	readonly csp?: ViewCsp;
	readonly permissions?: Readonly<Record<string, unknown>>;
}

export interface ViewDocument {
	readonly html: string;
	/** The `allow` attribute for the view's frame. */
	readonly allow: string;
}

/** What an agent-authored view may reach: any `https` origin. */
const AGENT_POLICY = [
	"default-src 'none'",
	"script-src 'unsafe-inline' https: blob:",
	"style-src 'unsafe-inline' https:",
	'img-src data: blob: https:',
	'font-src data: https:',
	'media-src data: blob: https:',
	'connect-src https: wss:',
	'frame-src https:',
	'worker-src blob:',
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join('; ');

/**
 * An origin an MCP App may declare. Anything else is dropped, so a declared
 * value can never smuggle a second directive or a keyword into the policy.
 */
const DECLARED_ORIGIN =
	/^(?:https|wss):\/\/(?:\*\.)?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?$/u;
const MAX_DECLARED_ORIGINS = 32;

function origins(values: readonly string[] | undefined): string[] {
	if (values === undefined) return [];
	return values
		.filter((value) => typeof value === 'string' && DECLARED_ORIGIN.test(value))
		.slice(0, MAX_DECLARED_ORIGINS);
}

/** The policy for one view. An MCP App gets only what its resource declared. */
export function viewContentSecurityPolicy(
	source: ViewSource,
	csp: ViewCsp = {},
): string {
	if (source.kind === 'agent') return AGENT_POLICY;
	const resource = origins(csp.resourceDomains);
	const connect = origins(csp.connectDomains);
	const frame = origins(csp.frameDomains);
	const base = origins(csp.baseUriDomains);
	const list = (fixed: string, extra: readonly string[]): string =>
		[fixed, ...extra].filter((part) => part.length > 0).join(' ');
	return [
		"default-src 'none'",
		`script-src ${list("'unsafe-inline'", resource)}`,
		`style-src ${list("'unsafe-inline'", resource)}`,
		`img-src ${list('data: blob:', resource)}`,
		`font-src ${list('data:', resource)}`,
		`media-src ${list('data: blob:', resource)}`,
		`connect-src ${connect.length === 0 ? "'none'" : connect.join(' ')}`,
		`frame-src ${frame.length === 0 ? "'none'" : frame.join(' ')}`,
		"object-src 'none'",
		`base-uri ${base.length === 0 ? "'none'" : base.join(' ')}`,
		"form-action 'none'",
		// `connect-src` does not govern WebRTC, which reaches a peer directly. An
		// MCP App cannot declare peers, so it asks for none. Chromium does not
		// enforce this directive (measured on 153), so today it states intent;
		// the gap is recorded in the spec and the evidence file.
		"webrtc 'block'",
	].join('; ');
}

const PERMISSION_FEATURES: Readonly<Record<string, string>> = {
	camera: 'camera',
	microphone: 'microphone',
	geolocation: 'geolocation',
	clipboardWrite: 'clipboard-write',
};

/** Permission-policy features a view's resource asked for. */
export function viewAllowAttribute(
	source: ViewSource,
	permissions: Readonly<Record<string, unknown>> | undefined,
): string {
	if (source.kind !== 'mcp-app' || permissions === undefined) return '';
	return Object.keys(PERMISSION_FEATURES)
		.filter((key) => Object.hasOwn(permissions, key))
		.map((key) => PERMISSION_FEATURES[key])
		.join('; ');
}

/**
 * Runs inside an agent-authored view. It performs the MCP Apps handshake,
 * reports the content's size, applies the host theme, and offers
 * `window.terminay` so a button can reply with one call.
 */
export const AGENT_VIEW_BOOTSTRAP = `(() => {
	const pending = new Map();
	let next = 0;
	const request = (method, params) => new Promise((resolve, reject) => {
		const id = 'terminay-' + (++next);
		pending.set(id, { resolve, reject });
		parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
	});
	const notify = (method, params) => parent.postMessage({ jsonrpc: '2.0', method, params }, '*');
	const apply = (context) => {
		const variables = context && context.styles && context.styles.variables;
		if (variables) for (const name of Object.keys(variables)) {
			if (/^--[a-z0-9-]+$/.test(name) && typeof variables[name] === 'string')
				document.documentElement.style.setProperty(name, variables[name]);
		}
		const dimensions = context && context.containerDimensions;
		if (dimensions) document.documentElement.classList.toggle('terminay-fill', 'height' in dimensions);
	};
	addEventListener('message', (event) => {
		const message = event.data;
		if (event.source !== parent || !message || message.jsonrpc !== '2.0') return;
		if (typeof message.method === 'string') {
			if (message.method === 'ui/notifications/host-context-changed') apply(message.params);
			if (message.id !== undefined) parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, '*');
			return;
		}
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.reject(new Error(String(message.error.message || 'request failed')));
		else waiter.resolve(message.result);
	});
	const text = (value) => ({ type: 'text', text: String(value) });
	Object.defineProperty(window, 'terminay', { value: Object.freeze({
		sendMessage: (value) => request('ui/message', { role: 'user', content: text(value) }),
		updateContext: (value) => request('ui/update-model-context', { content: [text(value)] }),
		openLink: (url) => request('ui/open-link', { url: String(url) }),
		close: () => request('ui/request-close', {}),
	}) });
	let reported = -1;
	const report = () => {
		const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
		if (height === reported || height <= 0) return;
		reported = height;
		notify('ui/notifications/size-changed', { width: Math.ceil(document.documentElement.scrollWidth), height });
	};
	const start = () => {
		request('ui/initialize', {
			protocolVersion: '2026-01-26',
			appInfo: { name: 'terminay-agent-window', version: '1' },
			appCapabilities: { availableDisplayModes: ['pip', 'fullscreen'] },
		}).then((result) => {
			apply(result && result.hostContext);
			new ResizeObserver(report).observe(document.documentElement);
			if (document.body) new ResizeObserver(report).observe(document.body);
			report();
			notify('ui/notifications/initialized', {});
		}, () => {});
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', start, { once: true });
	else start();
})();`;

/** Readable defaults for plain HTML; everything here yields to the author's CSS. */
const AGENT_VIEW_BASE_STYLE =
	':root{color-scheme:dark light}' +
	':where(html.terminay-fill),:where(html.terminay-fill body){height:100%}' +
	':where(body){margin:0;padding:14px 16px;box-sizing:border-box;' +
	'font:13px/1.5 var(--font-sans,system-ui,sans-serif);' +
	'color:var(--color-text-primary,#e6e6e6);background:var(--color-background-primary,#16181c)}';

function escapeAttribute(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

/**
 * Runs first in every view. A view's frame may hold only the document it was
 * given, so a link that navigated would end the view. Links are therefore
 * handled here, and still do what they were for: a link to a place in the page
 * scrolls there, and a link to a web page is handed to the host, which opens it
 * in the person's browser if they really clicked it.
 *
 * This is for the person's benefit, not a boundary: a view that sets its own
 * location is not stopped here (a sandboxed frame gets no navigation events to
 * cancel). The proxy refuses to load the destination and removes the frame.
 */
export const VIEW_LINK_HANDLER = `(() => {
	const post = window.parent.postMessage;
	const host = window.parent;
	const apply = Reflect.apply;
	let opened = 0;
	window.addEventListener('click', (event) => {
		const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
		let anchor = null;
		for (const node of path) {
			if (node && node.nodeType === 1 && (node.localName === 'a' || node.localName === 'area') && node.hasAttribute('href')) { anchor = node; break; }
		}
		if (!anchor) return;
		const raw = String(anchor.getAttribute('href')).trim();
		if (raw.charAt(0) === '#') {
			event.preventDefault();
			let id = raw.slice(1);
			try { id = decodeURIComponent(id); } catch {}
			const target = id === '' ? document.documentElement : (document.getElementById(id) || document.getElementsByName(id)[0]);
			if (target) target.scrollIntoView();
			return;
		}
		let url = '';
		try { url = String(new URL(raw, document.baseURI)); } catch { return; }
		if (!/^https?:/i.test(url)) return;
		event.preventDefault();
		opened += 1;
		apply(post, host, [{ jsonrpc: '2.0', id: 'terminay-link-' + opened, method: 'ui/open-link', params: { url } }, '*']);
	}, true);
})();`;

/**
 * The view document: the author's HTML with Terminay's policy, and for an
 * agent-authored view its bootstrap, placed ahead of everything the author
 * wrote. The policy cannot be undone by later markup: a second policy can only
 * narrow the first.
 */
export function buildViewDocument(input: ViewDocumentInput): ViewDocument {
	const policy = viewContentSecurityPolicy(input.source, input.csp);
	const head =
		`<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">` +
		`<script>${VIEW_LINK_HANDLER}</script>` +
		(input.source.kind === 'agent'
			? `<meta charset="utf-8"><style>${AGENT_VIEW_BASE_STYLE}</style><script>${AGENT_VIEW_BOOTSTRAP}</script>`
			: '') +
		// Present in every view and inert until someone watches it (ADR-0039).
		`<script>${MIRROR_LOADER_SCRIPT}</script>`;
	// A doctype must stay first or the view renders in quirks mode. Nothing
	// else may precede the policy, so it goes directly after the doctype rather
	// than inside whatever <head> the author wrote.
	const doctype = /^\s*<!doctype[^>]*>/iu.exec(input.html);
	const html =
		doctype === null
			? `<!doctype html>${head}${input.html}`
			: `${doctype[0]}${head}${input.html.slice(doctype[0].length)}`;
	return { html, allow: viewAllowAttribute(input.source, input.permissions) };
}
