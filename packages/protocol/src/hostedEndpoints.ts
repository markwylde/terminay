/**
 * The two hosted endpoints (ADR-0136).
 *
 * The **App Server** is the exact origin of the connection manager. The
 * **Session Server** is an origin template whose leftmost DNS label contains
 * `<session>` exactly once; each server's stable session origin is that
 * template filled with its session id. Neither is derived from the other.
 *
 * Terminay Servers are untrusted code, so every session must run at its own
 * origin: validation guarantees the manager never matches the template and
 * that distinct session ids always produce distinct origins.
 */

export const SESSION_PLACEHOLDER = '<session>';

export type HostedEndpoints = Readonly<{
	/** Exact manager origin, for example `https://app.terminay.com`. */
	appServer: string;
	/** Session origin template, for example `https://<session>.terminay.com`. */
	sessionServer: string;
}>;

export type HostedEndpointsField = 'appServer' | 'sessionServer';

export class HostedEndpointsError extends TypeError {
	readonly field: HostedEndpointsField;
	constructor(field: HostedEndpointsField, message: string) {
		super(message);
		this.name = 'HostedEndpointsError';
		this.field = field;
	}
}

/** A session id: one DNS-safe run of 8–63 characters. */
export const SESSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{6,61}[a-z0-9])$/u;
/** Minted session ids are 32 hex characters; the label must still fit. */
const MINTED_SESSION_ID_LENGTH = 32;
const MAX_LABEL_LENGTH = 63;
const LABEL_AFFIX = /^[a-z0-9-]*$/u;
const PLACEHOLDER_SENTINEL = 'terminay-session-placeholder-0';

type CompiledTemplate = Readonly<{
	protocol: string;
	port: string;
	prefix: string;
	suffix: string;
	/** The labels after the leftmost one, without a leading dot ('' if none). */
	rest: string;
}>;

const compiled = new WeakMap<HostedEndpoints, CompiledTemplate>();

export function isLoopbackHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/u, '');
	return (
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host === '127.0.0.1' ||
		host === '[::1]' ||
		host === '::1'
	);
}

function withScheme(value: string, hostForDefault: string): string {
	if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) return value;
	const hostname = hostForDefault.replace(/[:/].*$/u, '');
	return `${isLoopbackHostname(hostname) ? 'http' : 'https'}://${value}`;
}

function parseOriginLike(
	field: HostedEndpointsField,
	label: string,
	raw: string,
): URL {
	let url: URL;
	try {
		url = new URL(withScheme(raw, raw));
	} catch {
		throw new HostedEndpointsError(field, `${label} is not a valid URL.`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new HostedEndpointsError(field, `${label} must use HTTPS.`);
	}
	if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
		throw new HostedEndpointsError(
			field,
			`${label} must use HTTPS unless it is a loopback development host.`,
		);
	}
	if (url.username || url.password) {
		throw new HostedEndpointsError(field, `${label} must not carry credentials.`);
	}
	if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
		throw new HostedEndpointsError(
			field,
			`${label} must be an origin with no path, query, or fragment.`,
		);
	}
	return url;
}

function compileTemplate(raw: string): CompiledTemplate {
	const field = 'sessionServer';
	const label = 'Session Server';
	const value = String(raw ?? '').trim().toLowerCase();
	if (!value) throw new HostedEndpointsError(field, `${label} is required.`);
	if (value.includes(PLACEHOLDER_SENTINEL)) {
		throw new HostedEndpointsError(field, `${label} is not a valid URL.`);
	}
	const occurrences = value.split(SESSION_PLACEHOLDER).length - 1;
	if (occurrences !== 1) {
		throw new HostedEndpointsError(
			field,
			`${label} must contain ${SESSION_PLACEHOLDER} exactly once.`,
		);
	}
	const url = parseOriginLike(
		field,
		label,
		value.replace(SESSION_PLACEHOLDER, PLACEHOLDER_SENTINEL),
	);
	const labels = url.hostname.split('.');
	const leftmost = labels[0] ?? '';
	const at = leftmost.indexOf(PLACEHOLDER_SENTINEL);
	if (at < 0 || labels.slice(1).some((part) => part.includes(PLACEHOLDER_SENTINEL))) {
		throw new HostedEndpointsError(
			field,
			`${label} must put ${SESSION_PLACEHOLDER} in its leftmost label, for example https://<session>.terminay.com.`,
		);
	}
	const prefix = leftmost.slice(0, at);
	const suffix = leftmost.slice(at + PLACEHOLDER_SENTINEL.length);
	if (!LABEL_AFFIX.test(prefix) || !LABEL_AFFIX.test(suffix)) {
		throw new HostedEndpointsError(
			field,
			`${label} may only add letters, digits, and hyphens around ${SESSION_PLACEHOLDER}.`,
		);
	}
	if (prefix.length + suffix.length + MINTED_SESSION_ID_LENGTH > MAX_LABEL_LENGTH) {
		throw new HostedEndpointsError(
			field,
			`${label} leaves too little room for a session id in its leftmost label.`,
		);
	}
	const rest = labels.slice(1).join('.');
	if (!rest) {
		throw new HostedEndpointsError(
			field,
			`${label} must name a domain after ${SESSION_PLACEHOLDER}.`,
		);
	}
	return Object.freeze({
		protocol: url.protocol,
		port: url.port,
		prefix,
		suffix,
		rest,
	});
}

function templateString(template: CompiledTemplate): string {
	const port = template.port ? `:${template.port}` : '';
	return `${template.protocol}//${template.prefix}${SESSION_PLACEHOLDER}${template.suffix}.${template.rest}${port}`;
}

function matchTemplate(
	template: CompiledTemplate,
	origin: string,
): string | undefined {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return undefined;
	}
	if (url.protocol !== template.protocol || url.port !== template.port) return undefined;
	const host = url.hostname.toLowerCase();
	const dot = host.indexOf('.');
	if (dot < 0 || host.slice(dot + 1) !== template.rest) return undefined;
	const leftmost = host.slice(0, dot);
	if (
		leftmost.length <= template.prefix.length + template.suffix.length ||
		!leftmost.startsWith(template.prefix) ||
		!leftmost.endsWith(template.suffix)
	)
		return undefined;
	const id = leftmost.slice(
		template.prefix.length,
		leftmost.length - template.suffix.length,
	);
	return SESSION_ID_PATTERN.test(id) ? id : undefined;
}

/**
 * Validate and normalise a pair of hosted endpoints. Bare hosts default to
 * HTTPS (HTTP for loopback). Throws {@link HostedEndpointsError} naming the
 * offending field.
 */
export function parseHostedEndpoints(
	input: Readonly<{ appServer?: unknown; sessionServer?: unknown }>,
): HostedEndpoints {
	const rawApp = String(input.appServer ?? '').trim().toLowerCase();
	if (!rawApp) throw new HostedEndpointsError('appServer', 'App Server is required.');
	if (rawApp.includes(SESSION_PLACEHOLDER)) {
		throw new HostedEndpointsError(
			'appServer',
			`App Server is one exact origin and must not contain ${SESSION_PLACEHOLDER}.`,
		);
	}
	const appServer = parseOriginLike('appServer', 'App Server', rawApp).origin;
	const template = compileTemplate(String(input.sessionServer ?? ''));
	if (matchTemplate(template, appServer) !== undefined) {
		throw new HostedEndpointsError(
			'appServer',
			'App Server must not be a host the Session Server template can produce.',
		);
	}
	const endpoints: HostedEndpoints = Object.freeze({
		appServer,
		sessionServer: templateString(template),
	});
	compiled.set(endpoints, template);
	return endpoints;
}

function templateOf(endpoints: HostedEndpoints): CompiledTemplate {
	const cached = compiled.get(endpoints);
	if (cached) return cached;
	const template = compileTemplate(endpoints.sessionServer);
	compiled.set(endpoints, template);
	return template;
}

export const PRODUCTION_HOSTED_ENDPOINTS: HostedEndpoints = parseHostedEndpoints({
	appServer: 'https://app.terminay.com',
	sessionServer: 'https://<session>.terminay.com',
});

/**
 * The endpoints of a loopback development stack on one port: the manager at
 * `http://localhost:<port>` and sessions at `http://<id>.localhost:<port>`.
 */
export function loopbackHostedEndpoints(origin: string): HostedEndpoints | undefined {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return undefined;
	}
	if (url.protocol !== 'http:' || !isLoopbackHostname(url.hostname)) return undefined;
	const port = url.port ? `:${url.port}` : '';
	return parseHostedEndpoints({
		appServer: `http://localhost${port}`,
		sessionServer: `http://<session>.localhost${port}`,
	});
}

export function sameHostedEndpoints(a: HostedEndpoints, b: HostedEndpoints): boolean {
	return a.appServer === b.appServer && a.sessionServer === b.sessionServer;
}

/**
 * The endpoints a client recognises: its configured pair plus production,
 * so pointing a client at a preview never strands its production servers.
 */
export function recognisedHostedEndpoints(
	configured?: HostedEndpoints,
): readonly HostedEndpoints[] {
	if (!configured || sameHostedEndpoints(configured, PRODUCTION_HOSTED_ENDPOINTS))
		return [PRODUCTION_HOSTED_ENDPOINTS];
	return [configured, PRODUCTION_HOSTED_ENDPOINTS];
}

export function sessionOriginFor(endpoints: HostedEndpoints, sessionId: string): string {
	const id = String(sessionId ?? '').trim().toLowerCase();
	if (!SESSION_ID_PATTERN.test(id)) {
		throw new TypeError('The pairing code contains an invalid session host.');
	}
	const template = templateOf(endpoints);
	const label = `${template.prefix}${id}${template.suffix}`;
	if (label.length > MAX_LABEL_LENGTH) {
		throw new TypeError('The pairing code contains an invalid session host.');
	}
	const origin = new URL(
		`${template.protocol}//${label}.${template.rest}${template.port ? `:${template.port}` : ''}`,
	).origin;
	if (origin === endpoints.appServer) {
		throw new TypeError('The pairing code contains an invalid session host.');
	}
	return origin;
}

/** The session id an origin carries under these endpoints, if it matches. */
export function sessionIdFromOrigin(
	endpoints: HostedEndpoints,
	origin: string,
): string | undefined {
	const id = matchTemplate(templateOf(endpoints), origin);
	if (id === undefined) return undefined;
	try {
		if (new URL(origin).origin === endpoints.appServer) return undefined;
	} catch {
		return undefined;
	}
	return id;
}

export function isAppServerOrigin(endpoints: HostedEndpoints, origin: string): boolean {
	try {
		return new URL(origin).origin === endpoints.appServer;
	} catch {
		return false;
	}
}

/**
 * Read a single legacy "hosted domain" value as the endpoint pair it always
 * meant: the manager at `app.<domain>` and sessions at `<session>.<domain>`,
 * or a loopback development stack for `localhost[:port]`.
 */
export function hostedEndpointsFromLegacyDomain(value: string): HostedEndpoints {
	const trimmed = String(value ?? '').trim().toLowerCase();
	if (!trimmed || trimmed === 'terminay.com') return PRODUCTION_HOSTED_ENDPOINTS;
	const withProtocol = withScheme(trimmed, trimmed);
	const url = new URL(withProtocol);
	if (isLoopbackHostname(url.hostname)) {
		const loopback = loopbackHostedEndpoints(`http://${url.host}`);
		if (loopback) return loopback;
	}
	const port = url.port ? `:${url.port}` : '';
	return parseHostedEndpoints({
		appServer: `${url.protocol}//app.${url.hostname}${port}`,
		sessionServer: `${url.protocol}//<session>.${url.hostname}${port}`,
	});
}
