import { isIP } from 'node:net';
import { resolve } from 'node:path';
import type { AdvertisedIceAddress } from './remote/hostedPeerLifecycle.js';

export type { AdvertisedIceAddress };

/** Length of the pinned ICE range when none is configured. It equals the
 * peer configuration's `ADVERTISED_PORT_SPAN`; this module stays free of
 * runtime imports so option parsing can be loaded on its own. */
export const DEFAULT_ICE_PORT_SPAN = 4;

/** First UDP port of the ICE range a server pins when it is told to pin one
 * without being told where. */
export const DEFAULT_ICE_PORT = 51_000;

/**
 * The one address or name at which devices reach this server.
 *
 * `address` is a routable literal: usable both in an origin and as an ICE
 * candidate. `loopback` and `name` can only name an origin — a candidate must
 * be a literal address, and a browser need not probe a remote loopback one.
 */
export interface PublicHost {
	readonly host: string;
	readonly kind: 'address' | 'loopback' | 'name';
}

/** The exposure paths a standalone server may open at startup. */
export type ServerExposureMode = 'hosted' | 'direct';

export const SERVER_EXPOSURE_MODES: readonly ServerExposureMode[] =
	Object.freeze(['hosted', 'direct']);

export const DEFAULT_HOSTED_DOMAIN = 'terminay.com';

export interface ServerCliOptions {
	readonly command:
		| 'start'
		| 'status'
		| 'pairing'
		| 'mcp'
		| 'help'
		| 'version'
		| 'approve'
		| 'deny'
		| 'approvals'
		| 'reset-identity';
	/** Pending approval id for the approve and deny commands. */
	readonly approvalId?: string;
	readonly serverId: string;
	/** True only when the operator provided --server-id or TERMINAY_SERVER_ID.
	 * Implicit ids are resolved from the leased data root before startup. */
	readonly serverIdExplicit: boolean;
	readonly serverVersion: string;
	readonly dataRoot: string;
	readonly projectRoot: string;
	readonly webOrigin: string;
	readonly endpoint: string;
	readonly remoteOrigin: string;
	/** Whether the remote origin was explicitly configured rather than derived
	 * from the server authority. */
	readonly remoteOriginExplicit: boolean;
	readonly publicOrigin?: string;
	readonly httpHost?: string;
	readonly httpPort?: number;
	readonly healthHost?: string;
	readonly healthPort?: number;
	readonly logSink?: string;
	readonly uiBundle?: string;
	/** Hosted signaling domain the session origin is provisioned under. */
	readonly hostedDomain: string;
	/** Exposure the administrator standingly enabled for this data root. Empty
	 * means the server is not remotely reachable. */
	readonly exposeModes: readonly ServerExposureMode[];
	/** Advertised HTTPS origin of the server's own signaling listener. */
	readonly directOrigin?: string;
	/** An address and UDP port to offer as an additional ICE host candidate, for
	 * a server whose reachable address it cannot observe about itself — behind a
	 * port forward, or in a container whose network the client cannot route to.
	 * Added to the gathered candidates, never in place of them. */
	readonly advertiseAddress?: AdvertisedIceAddress;
	/** The one address or name devices reach this server at. Derives the direct
	 * origin and, for a routable literal, the advertised ICE address, wherever
	 * the administrator did not set those explicitly. A routing hint only. */
	readonly publicHost?: PublicHost;
	/** First port of a run of UDP ports every ICE candidate is confined to, for
	 * a range pinned with no advertised address. An advertised address pins the
	 * range at its own port and leaves this unset. */
	readonly icePort?: number;
	/** Length of the pinned run. A budget shared by every live peer. */
	readonly icePortSpan: number;
	/** Source revision this build was made from, when the build recorded one. */
	readonly serverRevision?: string;
	/** Whether this standalone host should reconcile its managed provider hooks. */
	readonly agentIntegrationEnabled: boolean;
	readonly aiProviders: readonly ('codex' | 'claude-code')[];
	/** One-shot inherited descriptor containing the vault passphrase. */
	readonly vaultUnlockFd?: number;
}

/** Expand only an explicitly configured loopback HTTP web origin to the
 * equivalent browser loopback hostnames on the same port. Non-loopback and
 * HTTPS deployments retain exact-origin matching. */
export function allowedWebOrigins(webOrigin: string): readonly string[] {
	const parsed = new URL(normalizePublicOrigin(webOrigin));
	const loopback =
		parsed.hostname === 'localhost' ||
		parsed.hostname === '127.0.0.1' ||
		parsed.hostname === '[::1]';
	if (parsed.protocol !== 'http:' || !loopback)
		return Object.freeze([parsed.origin]);
	const suffix = parsed.port === '' ? '' : `:${parsed.port}`;
	return Object.freeze([
		`http://localhost${suffix}`,
		`http://127.0.0.1${suffix}`,
		`http://[::1]${suffix}`,
	]);
}

export function parseServerCliOptions(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): ServerCliOptions {
	const command = argv.includes('--help')
		? 'help'
		: argv.includes('--version')
			? 'version'
			: argv.includes('--status')
				? 'status'
				: argv.includes('--pairing')
					? 'pairing'
					: argv[0] === 'mcp'
						? 'mcp'
						: argv[0] === 'approve' ||
								argv[0] === 'deny' ||
								argv[0] === 'approvals' ||
								argv[0] === 'reset-identity'
							? argv[0]
							: 'start';
	const approvalId =
		command === 'approve' || command === 'deny'
			? parseApprovalId(argv[1])
			: undefined;
	if (env.TERMINAY_REMOTE_PAIRING_PIN !== undefined) {
		throw new Error(
			'TERMINAY_REMOTE_PAIRING_PIN is no longer used: remote pairing is approved on the host with a match code. Remove the variable.',
		);
	}
	const configuredServerId =
		value(argv, '--server-id') ?? env.TERMINAY_SERVER_ID;
	const serverId = configuredServerId ?? 'local-server';
	const configuredRemoteOrigin =
		value(argv, '--remote-origin') ?? env.TERMINAY_REMOTE_ORIGIN;
	const remoteOrigin = configuredRemoteOrigin ?? defaultRemoteOrigin(serverId);
	const publicOrigin =
		value(argv, '--public-origin') ?? env.TERMINAY_PUBLIC_ORIGIN;
	const logSink = value(argv, '--log-sink') ?? env.TERMINAY_LOG_SINK;
	const uiBundle = value(argv, '--ui-bundle') ?? env.TERMINAY_UI_BUNDLE;
	const httpHost = value(argv, '--http-host') ?? env.TERMINAY_HTTP_HOST;
	const httpPortValue = value(argv, '--http-port') ?? env.TERMINAY_HTTP_PORT;
	const healthHost = value(argv, '--health-host') ?? env.TERMINAY_HEALTH_HOST;
	const healthPortValue =
		value(argv, '--health-port') ?? env.TERMINAY_HEALTH_PORT;
	const agentIntegrationValue =
		value(argv, '--agent-integration') ?? env.TERMINAY_AGENT_INTEGRATION;
	const aiProvidersValue =
		value(argv, '--ai-providers') ?? env.TERMINAY_AI_PROVIDERS;
	const vaultUnlockFdValue = value(argv, '--vault-unlock-fd');
	const hostedDomain = parseHostedDomain(
		value(argv, '--hosted-domain') ?? env.TERMINAY_HOSTED_DOMAIN,
	);
	const exposeModes = parseExposeModes(
		value(argv, '--expose') ?? env.TERMINAY_EXPOSE,
	);
	const publicHostValue = value(argv, '--public-host') ?? env.TERMINAY_PUBLIC_HOST;
	const publicHost =
		publicHostValue === undefined || publicHostValue.trim() === ''
			? undefined
			: parsePublicHost(publicHostValue);
	const httpPort =
		httpPortValue === undefined
			? undefined
			: parsePort(httpPortValue, '--http-port');
	const directOriginValue =
		value(argv, '--direct-origin') ?? env.TERMINAY_DIRECT_ORIGIN;
	// An explicit origin wins. Otherwise the public host names it, on the port
	// the listener answers on — the only port a client could reach it at.
	const directOrigin =
		directOriginValue !== undefined
			? normalizeDirectOrigin(directOriginValue)
			: publicHost !== undefined && exposeModes.includes('direct')
				? directOriginForPublicHost(publicHost, httpPort)
				: undefined;
	if (exposeModes.includes('direct') && directOrigin === undefined) {
		throw new Error(
			'--expose direct requires --direct-origin (TERMINAY_DIRECT_ORIGIN) or --public-host (TERMINAY_PUBLIC_HOST)',
		);
	}
	const icePortValue = value(argv, '--ice-port') ?? env.TERMINAY_ICE_PORT;
	const configuredIcePort =
		icePortValue === undefined || icePortValue.trim() === ''
			? undefined
			: parseIcePort(icePortValue);
	const icePortSpanValue =
		value(argv, '--ice-port-span') ?? env.TERMINAY_ICE_PORT_SPAN;
	const icePortSpan =
		icePortSpanValue === undefined || icePortSpanValue.trim() === ''
			? DEFAULT_ICE_PORT_SPAN
			: parseIcePortSpan(icePortSpanValue);
	const advertiseAddressValue =
		value(argv, '--advertise-address') ?? env.TERMINAY_WEBRTC_ADVERTISE_ADDRESS;
	// An empty value clears a previously configured address rather than failing,
	// so an operator can turn it off the same way they turned it on. It also
	// declines the address a public host would otherwise derive: the operator
	// said none.
	const advertiseAddress =
		advertiseAddressValue !== undefined
			? advertiseAddressValue.trim() === ''
				? undefined
				: parseAdvertiseAddress(advertiseAddressValue)
			: publicHost?.kind === 'address'
				? Object.freeze({
						host: publicHost.host,
						port: configuredIcePort ?? DEFAULT_ICE_PORT,
					})
				: undefined;
	if (
		advertiseAddress !== undefined &&
		configuredIcePort !== undefined &&
		advertiseAddress.port !== configuredIcePort
	) {
		throw new Error(
			'--ice-port must equal the --advertise-address port: the advertised candidate is offered on the first pinned port',
		);
	}
	// An advertised address pins the range at its own port without this option
	// being set; `icePort` records only what the administrator configured.
	const icePort = configuredIcePort;
	const firstPinnedPort = advertiseAddress?.port ?? configuredIcePort;
	if (
		firstPinnedPort !== undefined &&
		firstPinnedPort + icePortSpan - 1 > 65535
	) {
		throw new Error('the pinned ICE port range runs past port 65535');
	}
	const serverRevision = parseRevision(env.TERMINAY_SERVER_REVISION);
	return Object.freeze({
		command,
		serverId,
		serverIdExplicit: configuredServerId !== undefined,
		serverVersion: env.TERMINAY_SERVER_VERSION ?? '0.0.0',
		dataRoot:
			value(argv, '--data-root') ?? env.TERMINAY_DATA_ROOT ?? '.terminay',
		projectRoot: normalizeProjectRoot(
			value(argv, '--project-root') ??
				env.TERMINAY_PROJECT_ROOT ??
				process.cwd(),
		),
		webOrigin: normalizePublicOrigin(
			value(argv, '--web-origin') ??
				env.TERMINAY_WEB_ORIGIN ??
				'http://localhost:8080',
		),
		endpoint: value(argv, '--endpoint') ?? env.TERMINAY_ENDPOINT ?? 'loopback',
		remoteOrigin,
		remoteOriginExplicit: configuredRemoteOrigin !== undefined,
		...(approvalId === undefined ? {} : { approvalId }),
		...(publicOrigin === undefined
			? {}
			: { publicOrigin: normalizePublicOrigin(publicOrigin) }),
		...(httpHost === undefined ? {} : { httpHost }),
		...(httpPort === undefined ? {} : { httpPort }),
		...(healthHost === undefined ? {} : { healthHost }),
		...(healthPortValue === undefined
			? {}
			: { healthPort: parsePort(healthPortValue, '--health-port') }),
		...(logSink === undefined ? {} : { logSink }),
		...(uiBundle === undefined ? {} : { uiBundle }),
		hostedDomain,
		exposeModes,
		...(directOrigin === undefined ? {} : { directOrigin }),
		...(advertiseAddress === undefined ? {} : { advertiseAddress }),
		...(publicHost === undefined ? {} : { publicHost }),
		...(icePort === undefined ? {} : { icePort }),
		icePortSpan,
		...(serverRevision === undefined ? {} : { serverRevision }),
		agentIntegrationEnabled: parseAgentIntegration(agentIntegrationValue),
		aiProviders: parseAiProviders(aiProvidersValue),
		...(vaultUnlockFdValue === undefined
			? {}
			: { vaultUnlockFd: parseInheritedFd(vaultUnlockFdValue) }),
	});
}

export function formatServerHelp(): string {
	return `${[
		'Usage: terminay-server [mcp|--status|--pairing|--version] [options]',
		'Options:',
		'  --data-root PATH   server data directory (TERMINAY_DATA_ROOT)',
		'  --project-root PATH initial project root (TERMINAY_PROJECT_ROOT; defaults to cwd)',
		'  --web-origin URL   browser origin allowed to call the local protocol (TERMINAY_WEB_ORIGIN)',
		'  --server-id ID     stable server identity; implicit startup identities are persisted per data root (TERMINAY_SERVER_ID)',
		'  --endpoint VALUE   local endpoint policy (TERMINAY_ENDPOINT)',
		'  --http-host HOST   authenticated HTTP bind host (TERMINAY_HTTP_HOST)',
		'  --http-port PORT   authenticated HTTP port; 0 selects one (TERMINAY_HTTP_PORT)',
		'  --public-origin URL advertised browser URL for the authenticated HTTP server (TERMINAY_PUBLIC_ORIGIN)',
		'  --remote-origin URL remote WebRTC session origin (TERMINAY_REMOTE_ORIGIN)',
		'  --log-sink PATH    structured log destination (TERMINAY_LOG_SINK)',
		'  --ui-bundle PATH   matching workspace bundle (TERMINAY_UI_BUNDLE)',
		"  --hosted-domain DOMAIN  hosted signaling domain for this server's session origin (TERMINAY_HOSTED_DOMAIN)",
		'  --expose MODES     exposure to enable at startup: off, hosted, direct, or hosted,direct (TERMINAY_EXPOSE)',
		"  --direct-origin URL advertised HTTPS origin of this server's own signaling listener; required by --expose direct unless --public-host is set (TERMINAY_DIRECT_ORIGIN)",
		'  --public-host HOST the one address or name devices reach this server at; derives the direct origin and, for a routable literal address, the advertised ICE address (TERMINAY_PUBLIC_HOST)',
		'  --advertise-address HOST:PORT  a literal address and UDP port to offer as an additional ICE candidate (TERMINAY_WEBRTC_ADVERTISE_ADDRESS)',
		'  --ice-port PORT    first UDP port of a pinned ICE range, so the range can be published or forwarded (TERMINAY_ICE_PORT)',
		'  --ice-port-span N  number of consecutive UDP ports in the pinned ICE range; a budget shared by every connected device (TERMINAY_ICE_PORT_SPAN)',
		'  --agent-integration MODE  observe supported agent session journals: enabled or disabled (TERMINAY_AGENT_INTEGRATION)',
		'  --ai-providers LIST  opt in to bounded server CLI providers: codex,claude-code (TERMINAY_AI_PROVIDERS)',
		'  --health-host HOST unauthenticated liveness/readiness bind host (TERMINAY_HEALTH_HOST)',
		'  --health-port PORT unauthenticated liveness/readiness port (TERMINAY_HEALTH_PORT)',
		'  --vault-unlock-fd FD  consume vault passphrase from inherited FD >= 3; otherwise use an echo-disabled controlling terminal',
		'  --pairing          ask the running server for its live pairing handoff, one line per exposure mode',
		'  approvals          list devices waiting for pairing approval on the running server',
		'  approve ID         approve a pending device by its approval id after comparing the match code',
		'  deny ID            deny a pending device by its approval id',
		'  reset-identity     rotate the server host key and revoke every paired device',
		'  --status           print redacted runtime configuration',
		'  --version          print the server version',
		'  mcp                run the headless MCP stdio adapter (requires inherited control environment)',
	].join('\n')}\n`;
}

function parseApprovalId(value: string | undefined): string {
	if (
		value === undefined ||
		!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	) {
		throw new Error(
			'approve and deny require the approval id shown for the pending device',
		);
	}
	return value;
}

function parseHostedDomain(value: string | undefined): string {
	if (value === undefined) return DEFAULT_HOSTED_DOMAIN;
	const trimmed = value.trim();
	if (trimmed.length === 0)
		throw new Error('--hosted-domain must name a hosted signaling domain');
	let parsed: URL;
	try {
		parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
	} catch {
		throw new Error('--hosted-domain must name a hosted signaling domain');
	}
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error('--hosted-domain must be a bare domain or an exact origin');
	}
	return parsed.port === ''
		? parsed.hostname
		: `${parsed.hostname}:${parsed.port}`;
}

function parseExposeModes(
	value: string | undefined,
): readonly ServerExposureMode[] {
	// Exposure is off unless an administrator standingly enabled it for this
	// data root, so an absent or explicitly disabled value is not an error.
	if (
		value === undefined ||
		value.trim() === '' ||
		value === 'off' ||
		value === 'disabled'
	)
		return Object.freeze([]);
	const selected: ServerExposureMode[] = [];
	for (const mode of value.split(',').map((item) => item.trim())) {
		if (mode !== 'hosted' && mode !== 'direct') {
			throw new Error('--expose accepts off, hosted, direct, or hosted,direct');
		}
		if (!selected.includes(mode)) selected.push(mode);
	}
	return Object.freeze(
		SERVER_EXPOSURE_MODES.filter((mode) => selected.includes(mode)),
	);
}

function normalizeDirectOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('--direct-origin must be an HTTPS URL');
	}
	// The pairing URL grammar and the client's WebSocket both require https, and
	// the listener terminates TLS itself with a self-signed certificate.
	if (parsed.protocol !== 'https:')
		throw new Error('--direct-origin must use HTTPS');
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	) {
		throw new Error('--direct-origin must be an exact origin');
	}
	return parsed.origin;
}

/**
 * Parse the public host: a literal address or a DNS name, with no scheme, port,
 * or path. Brackets around an IPv6 literal are accepted and dropped.
 */
export function parsePublicHost(value: string): PublicHost {
	const trimmed = value.trim();
	const host =
		trimmed.startsWith('[') && trimmed.endsWith(']')
			? trimmed.slice(1, -1)
			: trimmed;
	if (isIP(host) === 4) {
		if (host === '0.0.0.0')
			throw new Error('--public-host must be an address devices can reach');
		return Object.freeze({
			host,
			kind: host.startsWith('127.') ? 'loopback' : 'address',
		});
	}
	if (isIP(host) === 6) {
		const compact = host.toLowerCase();
		if (compact === '::')
			throw new Error('--public-host must be an address devices can reach');
		return Object.freeze({
			host: compact,
			kind: compact === '::1' ? 'loopback' : 'address',
		});
	}
	if (
		host.length > 253 ||
		!/^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/u.test(
			host,
		) ||
		/^[0-9.]+$/u.test(host)
	) {
		throw new Error(
			'--public-host must be a literal address or a host name, with no scheme, port, or path',
		);
	}
	const name = host.toLowerCase();
	return Object.freeze({
		host: name,
		kind: name === 'localhost' || name.endsWith('.localhost') ? 'loopback' : 'name',
	});
}

function directOriginForPublicHost(
	publicHost: PublicHost,
	httpPort: number | undefined,
): string {
	// Port 0 asks the listener to choose, so there is no port to name yet.
	if (httpPort === undefined || httpPort === 0) {
		throw new Error(
			'--public-host needs --http-port (TERMINAY_HTTP_PORT) to derive the direct origin',
		);
	}
	const host = publicHost.host.includes(':')
		? `[${publicHost.host}]`
		: publicHost.host;
	return normalizeDirectOrigin(`https://${host}:${httpPort}`);
}

function parseIcePort(value: string): number {
	if (!/^[0-9]+$/u.test(value)) throw new Error('--ice-port must be a number');
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
		throw new Error('--ice-port must be between 1 and 65535');
	return port;
}

function parseIcePortSpan(value: string): number {
	if (!/^[0-9]+$/u.test(value))
		throw new Error('--ice-port-span must be a number');
	const span = Number(value);
	// The WebRTC runtime rejects a range of one port.
	if (!Number.isSafeInteger(span) || span < 2 || span > 1024)
		throw new Error('--ice-port-span must be between 2 and 1024');
	return span;
}

function parseRevision(value: string | undefined): string | undefined {
	if (value === undefined || value.trim() === '') return undefined;
	const revision = value.trim();
	if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u.test(revision))
		throw new Error('TERMINAY_SERVER_REVISION is not a revision identifier');
	return revision;
}

/**
 * Parse `<host>:<port>` into a candidate destination.
 *
 * Literal addresses only. An ICE candidate is where a peer sends its
 * connectivity checks, and a hostname is resolved on the peer's machine, which
 * may resolve elsewhere or not at all — the administrator forwarded an address,
 * and that address is what belongs in the candidate.
 */
export function parseAdvertiseAddress(value: string): AdvertisedIceAddress {
	const trimmed = value.trim();
	const bracketed = /^\[([0-9A-Fa-f:.]+)\]:(\d{1,5})$/u.exec(trimmed);
	const plain = /^([0-9]{1,3}(?:\.[0-9]{1,3}){3}):(\d{1,5})$/u.exec(trimmed);
	const match = bracketed ?? plain;
	if (match === null) {
		throw new Error(
			'--advertise-address must be a literal address and port, such as 127.0.0.1:51000 or [::1]:51000',
		);
	}
	const host = match[1] as string;
	const port = Number(match[2]);
	if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
		throw new Error('--advertise-address port must be between 1 and 65535');
	}
	if (bracketed === null) {
		// A dotted quad whose octets are out of range is a typo, not an address.
		if (host.split('.').some((octet) => Number(octet) > 255)) {
			throw new Error(
				`--advertise-address is not a valid IPv4 address: ${host}`,
			);
		}
	} else if (!host.includes(':')) {
		throw new Error(`--advertise-address is not a valid IPv6 address: ${host}`);
	}
	return Object.freeze({ host, port });
}

function parseInheritedFd(value: string): number {
	if (!/^[0-9]+$/u.test(value))
		throw new Error(
			'--vault-unlock-fd must be an inherited fd of 3 or greater',
		);
	const fd = Number(value);
	if (!Number.isSafeInteger(fd) || fd < 3)
		throw new Error(
			'--vault-unlock-fd must be an inherited fd of 3 or greater',
		);
	return fd;
}

function parseAiProviders(
	value: string | undefined,
): readonly ('codex' | 'claude-code')[] {
	if (value === undefined || value.trim() === '' || value === 'disabled')
		return [];
	const providers = [...new Set(value.split(',').map((item) => item.trim()))];
	for (const provider of providers) {
		if (provider !== 'codex' && provider !== 'claude-code') {
			throw new Error('--ai-providers accepts only codex and claude-code');
		}
	}
	return Object.freeze(providers) as readonly ('codex' | 'claude-code')[];
}

function parseAgentIntegration(value: string | undefined): boolean {
	if (value === undefined) return true;
	if (value === 'enabled' || value === 'true' || value === '1') return true;
	if (value === 'disabled' || value === 'false' || value === '0') return false;
	throw new Error('--agent-integration must be enabled or disabled');
}

function normalizePublicOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error('--public-origin must be a URL');
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
		throw new Error('--public-origin must use HTTP or HTTPS');
	if (
		parsed.username ||
		parsed.password ||
		parsed.pathname !== '/' ||
		parsed.search ||
		parsed.hash
	)
		throw new Error('--public-origin must be an exact origin');
	return parsed.origin;
}

function parsePort(value: string, option: string): number {
	if (!/^[0-9]+$/u.test(value)) throw new Error(`${option} must be a number`);
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65535)
		throw new Error(`${option} is out of range`);
	return port;
}

function normalizeProjectRoot(value: string): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.includes('\0')
	) {
		throw new Error('--project-root must be a non-empty path');
	}
	return resolve(value);
}

export function defaultRemoteOrigin(serverId: string): string {
	const label =
		serverId
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'server';
	return `https://${label}.remote.terminay.local`;
}

function value(argv: readonly string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	if (index < 0) return undefined;
	const next = argv[index + 1];
	if (next === undefined || next.startsWith('--') || next.length === 0)
		throw new Error(`${name} requires a value`);
	return next;
}
