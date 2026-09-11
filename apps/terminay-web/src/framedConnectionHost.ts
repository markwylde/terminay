import type {
	ByteTransport,
	TerminayHostConnectionStatus,
	TerminayWorkspaceComposition,
} from '@terminay/protocol';
import type { WebStorageLike } from './index.js';

/**
 * The closed `postMessage` schema the framed primary session origin uses to ask
 * `app.terminay.com` for connections to other saved servers.
 *
 * The manager opens every attached transport itself with the vaulted device
 * credential for that server's origin, and hands the frame one `MessagePort`
 * carrying opaque byte frames. No credential, ticket, signaling state, or raw
 * transport handle crosses this schema, and the primary origin's code is never
 * on another server's credential path.
 */
export const FRAMED_CONNECTION_PROTOCOL_VERSION = 1 as const;

export const FRAMED_CONNECTION_REQUEST_TYPES = [
	'connections.list',
	'connections.attach',
	'connections.detach',
	'connections.composition.read',
	'connections.composition.write',
] as const;

export const FRAMED_CONNECTION_RESPONSE_TYPES = [
	'connections.result',
	'connections.error',
	'connections.changed',
] as const;

export const FRAMED_CONNECTION_ERROR_CODES = [
	'invalid-request',
	'unknown-profile',
	'attach-failed',
	'detach-failed',
	'composition-failed',
] as const;

export type FramedConnectionRequestType =
	(typeof FRAMED_CONNECTION_REQUEST_TYPES)[number];
export type FramedConnectionResponseType =
	(typeof FRAMED_CONNECTION_RESPONSE_TYPES)[number];
export type FramedConnectionErrorCode =
	(typeof FRAMED_CONNECTION_ERROR_CODES)[number];

/** Sanitized profile projection. Origins, credentials, pairing fragments, and
 * every workspace value are deliberately absent. */
export interface FramedConnectionProfile {
	readonly id: string;
	readonly label: string;
	readonly status: TerminayHostConnectionStatus;
	readonly serverId?: string;
}

export type FramedConnectionRequest =
	| Readonly<{ v: 1; type: 'connections.list'; requestId: string }>
	| Readonly<{
			v: 1;
			type: 'connections.attach';
			requestId: string;
			profileId: string;
	  }>
	| Readonly<{
			v: 1;
			type: 'connections.detach';
			requestId: string;
			profileId: string;
	  }>
	| Readonly<{ v: 1; type: 'connections.composition.read'; requestId: string }>
	| Readonly<{
			v: 1;
			type: 'connections.composition.write';
			requestId: string;
			composition: TerminayWorkspaceComposition;
	  }>;

export type FramedConnectionResult =
	| Readonly<{
			kind: 'profiles';
			profiles: readonly FramedConnectionProfile[];
	  }>
	| Readonly<{ kind: 'attached'; profileId: string; serverId: string }>
	| Readonly<{ kind: 'detached'; profileId: string }>
	| Readonly<{
			kind: 'composition';
			composition?: TerminayWorkspaceComposition;
	  }>
	| Readonly<{ kind: 'ok' }>;

export type FramedConnectionResponse =
	| Readonly<{
			v: 1;
			type: 'connections.result';
			requestId: string;
			result: FramedConnectionResult;
	  }>
	| Readonly<{
			v: 1;
			type: 'connections.error';
			requestId: string;
			code: FramedConnectionErrorCode;
			message: string;
	  }>
	| Readonly<{
			v: 1;
			type: 'connections.changed';
			profiles: readonly FramedConnectionProfile[];
	  }>;

const CONNECTION_STATUSES: readonly TerminayHostConnectionStatus[] = [
	'connected',
	'connecting',
	'offline',
	'unavailable',
	'unauthenticated',
	'incompatible',
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_PROFILES = 128;
const MAX_ATTACHED = 64;
const MAX_TABS = 512;
const MAX_LABEL_LENGTH = 128;

/** Manager-side parser. Every framed request is validated exactly, with no
 * unknown fields tolerated, before any transport work begins. */
export function parseFramedConnectionRequest(
	value: unknown,
): FramedConnectionRequest {
	if (!record(value)) throw new TypeError('framed connection request is invalid');
	if (value.v !== FRAMED_CONNECTION_PROTOCOL_VERSION)
		throw new TypeError('framed connection request version is unsupported');
	const type = value.type;
	if (
		typeof type !== 'string' ||
		!(FRAMED_CONNECTION_REQUEST_TYPES as readonly string[]).includes(type)
	)
		throw new TypeError('framed connection request type is unknown');
	switch (type as FramedConnectionRequestType) {
		case 'connections.list':
			exactKeys(value, ['v', 'type', 'requestId']);
			return Object.freeze({
				v: 1,
				type: 'connections.list',
				requestId: requestId(value.requestId),
			});
		case 'connections.attach':
			exactKeys(value, ['v', 'type', 'requestId', 'profileId']);
			return Object.freeze({
				v: 1,
				type: 'connections.attach',
				requestId: requestId(value.requestId),
				profileId: identifier(value.profileId, 'profile id'),
			});
		case 'connections.detach':
			exactKeys(value, ['v', 'type', 'requestId', 'profileId']);
			return Object.freeze({
				v: 1,
				type: 'connections.detach',
				requestId: requestId(value.requestId),
				profileId: identifier(value.profileId, 'profile id'),
			});
		case 'connections.composition.read':
			exactKeys(value, ['v', 'type', 'requestId']);
			return Object.freeze({
				v: 1,
				type: 'connections.composition.read',
				requestId: requestId(value.requestId),
			});
		default:
			exactKeys(value, ['v', 'type', 'requestId', 'composition']);
			return Object.freeze({
				v: 1,
				type: 'connections.composition.write',
				requestId: requestId(value.requestId),
				composition: parseWorkspaceComposition(value.composition),
			});
	}
}

/** Session-side parser, exported so both peers can be tested against one
 * definition of the schema. */
export function parseFramedConnectionResponse(
	value: unknown,
): FramedConnectionResponse {
	if (!record(value))
		throw new TypeError('framed connection response is invalid');
	if (value.v !== FRAMED_CONNECTION_PROTOCOL_VERSION)
		throw new TypeError('framed connection response version is unsupported');
	switch (value.type) {
		case 'connections.result':
			exactKeys(value, ['v', 'type', 'requestId', 'result']);
			return Object.freeze({
				v: 1,
				type: 'connections.result',
				requestId: requestId(value.requestId),
				result: parseFramedConnectionResult(value.result),
			});
		case 'connections.error': {
			exactKeys(value, ['v', 'type', 'requestId', 'code', 'message']);
			const code = value.code;
			if (
				typeof code !== 'string' ||
				!(FRAMED_CONNECTION_ERROR_CODES as readonly string[]).includes(code)
			)
				throw new TypeError('framed connection error code is unknown');
			if (typeof value.message !== 'string' || value.message.length > 512)
				throw new TypeError('framed connection error message is invalid');
			return Object.freeze({
				v: 1,
				type: 'connections.error',
				requestId: requestId(value.requestId),
				code: code as FramedConnectionErrorCode,
				message: value.message,
			});
		}
		case 'connections.changed':
			exactKeys(value, ['v', 'type', 'profiles']);
			return Object.freeze({
				v: 1,
				type: 'connections.changed',
				profiles: parseFramedConnectionProfiles(value.profiles),
			});
		default:
			throw new TypeError('framed connection response type is unknown');
	}
}

export function parseFramedConnectionProfiles(
	value: unknown,
): readonly FramedConnectionProfile[] {
	if (!Array.isArray(value) || value.length > MAX_PROFILES)
		throw new TypeError('framed connection profiles are invalid');
	return Object.freeze(value.map(parseFramedConnectionProfile));
}

export function parseFramedConnectionProfile(
	value: unknown,
): FramedConnectionProfile {
	if (!record(value)) throw new TypeError('framed connection profile is invalid');
	for (const key of Object.keys(value))
		if (!['id', 'label', 'status', 'serverId'].includes(key))
			throw new TypeError('framed connection profile has an unknown field');
	const status = value.status;
	if (
		typeof status !== 'string' ||
		!(CONNECTION_STATUSES as readonly string[]).includes(status)
	)
		throw new TypeError('framed connection profile status is invalid');
	if (
		typeof value.label !== 'string' ||
		value.label.length === 0 ||
		value.label.length > MAX_LABEL_LENGTH
	)
		throw new TypeError('framed connection profile label is invalid');
	const profile: FramedConnectionProfile = {
		id: identifier(value.id, 'profile id'),
		label: value.label,
		status: status as TerminayHostConnectionStatus,
		...(value.serverId === undefined
			? {}
			: { serverId: identifier(value.serverId, 'server id') }),
	};
	return Object.freeze(profile);
}

/** Client-owned composition, bounded and closed. It is device-local
 * presentation state and is never sent to a server. */
export function parseWorkspaceComposition(
	value: unknown,
): TerminayWorkspaceComposition {
	if (!record(value)) throw new TypeError('workspace composition is invalid');
	exactKeys(value, ['version', 'primaryProfileId', 'attached', 'tabOrder']);
	if (value.version !== 1)
		throw new TypeError('workspace composition version is unsupported');
	if (!Array.isArray(value.attached) || value.attached.length > MAX_ATTACHED)
		throw new TypeError('workspace composition attached set is invalid');
	if (!Array.isArray(value.tabOrder) || value.tabOrder.length > MAX_TABS)
		throw new TypeError('workspace composition tab order is invalid');
	return Object.freeze({
		version: 1,
		primaryProfileId: identifier(value.primaryProfileId, 'profile id'),
		attached: Object.freeze(
			value.attached.map((entry) => {
				if (!record(entry)) throw new TypeError('attached entry is invalid');
				for (const key of Object.keys(entry))
					if (!['profileId', 'viewId'].includes(key))
						throw new TypeError('attached entry has an unknown field');
				return Object.freeze({
					profileId: identifier(entry.profileId, 'profile id'),
					...(entry.viewId === undefined
						? {}
						: { viewId: identifier(entry.viewId, 'view id') }),
				});
			}),
		),
		tabOrder: Object.freeze(
			value.tabOrder.map((entry) => {
				if (!record(entry)) throw new TypeError('tab handle is invalid');
				exactKeys(entry, ['serverId', 'projectId']);
				return Object.freeze({
					serverId: identifier(entry.serverId, 'server id'),
					projectId: identifier(entry.projectId, 'project id'),
				});
			}),
		),
	});
}

function parseFramedConnectionResult(value: unknown): FramedConnectionResult {
	if (!record(value)) throw new TypeError('framed connection result is invalid');
	switch (value.kind) {
		case 'profiles':
			exactKeys(value, ['kind', 'profiles']);
			return Object.freeze({
				kind: 'profiles',
				profiles: parseFramedConnectionProfiles(value.profiles),
			});
		case 'attached':
			exactKeys(value, ['kind', 'profileId', 'serverId']);
			return Object.freeze({
				kind: 'attached',
				profileId: identifier(value.profileId, 'profile id'),
				serverId: identifier(value.serverId, 'server id'),
			});
		case 'detached':
			exactKeys(value, ['kind', 'profileId']);
			return Object.freeze({
				kind: 'detached',
				profileId: identifier(value.profileId, 'profile id'),
			});
		case 'composition':
			exactKeys(value, ['kind'], ['composition']);
			return Object.freeze({
				kind: 'composition',
				...(value.composition === undefined
					? {}
					: { composition: parseWorkspaceComposition(value.composition) }),
			});
		case 'ok':
			exactKeys(value, ['kind']);
			return Object.freeze({ kind: 'ok' });
		default:
			throw new TypeError('framed connection result kind is unknown');
	}
}

export interface FramedMessageEventLike {
	readonly data: unknown;
	readonly origin: string;
	readonly source?: unknown;
	readonly ports?: readonly unknown[];
}

export interface FramedMessageTarget {
	addEventListener(
		type: 'message',
		listener: (event: FramedMessageEventLike) => void,
	): void;
	removeEventListener(
		type: 'message',
		listener: (event: FramedMessageEventLike) => void,
	): void;
}

export interface FramedWindowLike {
	postMessage(
		message: unknown,
		targetOrigin: string,
		transfer?: readonly unknown[],
	): void;
}

/** The byte side of one attached connection, as seen by the manager. */
export interface FramedBytePortLike {
	onmessage: ((event: { readonly data: unknown }) => void) | null;
	postMessage(message: unknown): void;
	start?(): void;
	close?(): void;
}

export interface FramedMessageChannelLike {
	readonly port1: FramedBytePortLike;
	readonly port2: unknown;
}

/** Everything the manager already owns: its saved profiles, its origin-keyed
 * credential vault, and its pairing/reconnect and WebRTC code. */
export interface FramedConnectionManagerDelegate {
	listProfiles(): Promise<readonly FramedConnectionProfile[]>;
	/** Opens the transport with the vaulted credential for that profile's own
	 * origin. The returned transport must already be open. */
	openConnection(
		profileId: string,
	): Promise<Readonly<{ serverId: string; transport: ByteTransport }>>;
	closeConnection(profileId: string): Promise<void>;
	readComposition(): Promise<TerminayWorkspaceComposition | undefined>;
	writeComposition(composition: TerminayWorkspaceComposition): Promise<void>;
}

export interface FramedConnectionManagerHostOptions {
	/** Exact origin of the framed primary session. */
	readonly sessionOrigin: string;
	/** The framed session's window, the only post target. */
	readonly frame: FramedWindowLike;
	/** When known, the only accepted `event.source`. */
	readonly frameSource?: unknown;
	readonly messageTarget: FramedMessageTarget;
	readonly delegate: FramedConnectionManagerDelegate;
	readonly createChannel?: () => FramedMessageChannelLike;
	readonly maxFrameBytes?: number;
}

/**
 * Manager-side half of the schema. It never decodes an application frame: it
 * moves opaque bytes between an attached server's transport and one
 * `MessagePort` handed to the framed primary.
 */
export class FramedConnectionManagerHost {
	private readonly listener = (event: FramedMessageEventLike): void => {
		void this.receive(event);
	};
	private readonly attached = new Map<
		string,
		Readonly<{ port: FramedBytePortLike; transport: ByteTransport }>
	>();
	/** Profiles whose transport is being opened. The claim is taken before the
	 * await so two attaches for one profile cannot both open one. */
	private readonly opening = new Set<string>();
	private listening = false;

	constructor(private readonly options: FramedConnectionManagerHostOptions) {
		exactFramedOrigin(options.sessionOrigin);
	}

	start(): void {
		if (this.listening) return;
		this.listening = true;
		this.options.messageTarget.addEventListener('message', this.listener);
	}

	/** Stops listening and closes every attached transport this frame opened. */
	async stop(): Promise<void> {
		if (this.listening) {
			this.listening = false;
			this.options.messageTarget.removeEventListener('message', this.listener);
		}
		for (const profileId of [...this.attached.keys()]) {
			this.releasePort(profileId, { closeConnection: false });
			try {
				await this.options.delegate.closeConnection(profileId);
			} catch {
				// Teardown is best effort; the server closes nothing either way.
			}
		}
	}

	/** Announce a remembered-profile or status change to the framed primary. */
	notifyConnectionsChanged(
		profiles: readonly FramedConnectionProfile[],
	): void {
		this.post({
			v: 1,
			type: 'connections.changed',
			profiles: parseFramedConnectionProfiles(profiles),
		});
	}

	private async receive(event: FramedMessageEventLike): Promise<void> {
		if (event.origin !== this.options.sessionOrigin) return;
		if (
			this.options.frameSource !== undefined &&
			event.source !== this.options.frameSource
		)
			return;
		if (!record(event.data) || event.data.type === undefined) return;
		if (
			typeof event.data.type !== 'string' ||
			!(FRAMED_CONNECTION_REQUEST_TYPES as readonly string[]).includes(
				event.data.type,
			)
		)
			return;
		let request: FramedConnectionRequest;
		try {
			request = parseFramedConnectionRequest(event.data);
		} catch (error) {
			const id = record(event.data) ? event.data.requestId : undefined;
			if (typeof id === 'string' && ID.test(id))
				this.fail(id, 'invalid-request', message(error));
			return;
		}
		await this.handle(request);
	}

	private async handle(request: FramedConnectionRequest): Promise<void> {
		switch (request.type) {
			case 'connections.list':
				try {
					this.reply(request.requestId, {
						kind: 'profiles',
						profiles: parseFramedConnectionProfiles(
							await this.options.delegate.listProfiles(),
						),
					});
				} catch (error) {
					this.fail(request.requestId, 'invalid-request', message(error));
				}
				return;
			case 'connections.attach':
				return this.attach(request.requestId, request.profileId);
			case 'connections.detach':
				return this.detach(request.requestId, request.profileId);
			case 'connections.composition.read':
				try {
					const composition = await this.options.delegate.readComposition();
					this.reply(request.requestId, {
						kind: 'composition',
						...(composition === undefined ? {} : { composition }),
					});
				} catch (error) {
					this.fail(request.requestId, 'composition-failed', message(error));
				}
				return;
			default:
				try {
					await this.options.delegate.writeComposition(request.composition);
					this.reply(request.requestId, { kind: 'ok' });
				} catch (error) {
					this.fail(request.requestId, 'composition-failed', message(error));
				}
		}
	}

	private async attach(requestId: string, profileId: string): Promise<void> {
		// The claim is taken before opening, not after: two attaches for one
		// profile would otherwise both pass this check while the first is still
		// opening, and the transport the loser opened would be orphaned with
		// nothing left holding it.
		if (this.attached.has(profileId) || this.opening.has(profileId)) {
			this.fail(
				requestId,
				'attach-failed',
				'that connection is already attached to this session',
			);
			return;
		}
		this.opening.add(profileId);
		let opened: Readonly<{ serverId: string; transport: ByteTransport }>;
		try {
			opened = await this.options.delegate.openConnection(profileId);
		} catch (error) {
			this.fail(requestId, 'attach-failed', message(error));
			return;
		} finally {
			this.opening.delete(profileId);
		}
		const serverId = identifier(opened.serverId, 'server id');
		const channel = (this.options.createChannel ?? defaultChannel)();
		this.attached.set(
			profileId,
			Object.freeze({ port: channel.port1, transport: opened.transport }),
		);
		this.pump(profileId, channel.port1, opened.transport);
		this.post(
			{
				v: 1,
				type: 'connections.result',
				requestId,
				result: Object.freeze({ kind: 'attached', profileId, serverId }),
			},
			[channel.port2],
		);
	}

	private async detach(requestId: string, profileId: string): Promise<void> {
		this.releasePort(profileId, { closeConnection: false });
		try {
			await this.options.delegate.closeConnection(profileId);
		} catch (error) {
			this.fail(requestId, 'detach-failed', message(error));
			return;
		}
		this.reply(requestId, { kind: 'detached', profileId });
	}

	private pump(
		profileId: string,
		port: FramedBytePortLike,
		transport: ByteTransport,
	): void {
		const maxFrameBytes = this.options.maxFrameBytes ?? 8 * 1024 * 1024;
		port.onmessage = (event) => {
			const bytes = toBytes(event.data);
			if (bytes === undefined || bytes.byteLength > maxFrameBytes) return;
			void transport.send(bytes).catch(() => this.releasePort(profileId));
		};
		port.start?.();
		void (async () => {
			try {
				for await (const frame of transport.incoming) port.postMessage(frame.slice());
			} catch {
				// A failed attached transport closes its port; the primary's other
				// connections keep their generations.
			} finally {
				this.releasePort(profileId);
			}
		})();
	}

	/**
	 * Drop one attached connection: its port, its transport, and the manager's
	 * record of it.
	 *
	 * A transport left open here keeps a server session alive for a workspace
	 * that can no longer reach it, and a manager that is never told keeps
	 * offering the profile as attached. `detach` and `stop` close the connection
	 * through the delegate themselves and pass `closeConnection: false`; every
	 * other caller is a failure the manager has not heard about.
	 */
	private releasePort(
		profileId: string,
		options: Readonly<{ closeConnection?: boolean }> = {},
	): void {
		const entry = this.attached.get(profileId);
		if (entry === undefined) return;
		this.attached.delete(profileId);
		entry.port.onmessage = null;
		try {
			entry.port.close?.();
		} catch {
			// Port teardown is best effort.
		}
		void entry.transport.close({ code: 'normal' }).catch(() => undefined);
		if (options.closeConnection === false) return;
		void this.options.delegate
			.closeConnection(profileId)
			.catch(() => undefined);
	}

	private reply(requestId: string, result: FramedConnectionResult): void {
		this.post({ v: 1, type: 'connections.result', requestId, result });
	}

	private fail(
		requestId: string,
		code: FramedConnectionErrorCode,
		text: string,
	): void {
		this.post({
			v: 1,
			type: 'connections.error',
			requestId,
			code,
			message: text.slice(0, 512),
		});
	}

	private post(
		response: FramedConnectionResponse,
		transfer?: readonly unknown[],
	): void {
		this.options.frame.postMessage(
			response,
			this.options.sessionOrigin,
			transfer,
		);
	}
}

export const WEB_COMPOSITION_STORAGE_KEY =
	'terminay.web.workspace-compositions.v1';

const COMPOSITION_SCHEMA_VERSION = 1;
const MAX_STORED_COMPOSITIONS = 32;

/**
 * Manager-owned composition storage, keyed by the primary session origin. It
 * holds sanitized profile ids, view ids, and tab handles only.
 */
export class PwaWorkspaceCompositionStore {
	private readonly storage: WebStorageLike | undefined;

	constructor(options: Readonly<{ storage?: WebStorageLike }> = {}) {
		this.storage = options.storage ?? browserStorage();
	}

	read(sessionOrigin: string): TerminayWorkspaceComposition | undefined {
		const key = exactFramedOrigin(sessionOrigin);
		const stored = this.records()[key];
		if (stored === undefined) return undefined;
		try {
			return parseWorkspaceComposition(stored);
		} catch {
			return undefined;
		}
	}

	write(
		sessionOrigin: string,
		composition: TerminayWorkspaceComposition,
	): void {
		const key = exactFramedOrigin(sessionOrigin);
		const validated = parseWorkspaceComposition(composition);
		const records = this.records();
		if (
			records[key] === undefined &&
			Object.keys(records).length >= MAX_STORED_COMPOSITIONS
		)
			throw new RangeError('stored composition limit reached');
		this.commit({ ...records, [key]: validated });
	}

	forget(sessionOrigin: string): boolean {
		const key = exactFramedOrigin(sessionOrigin);
		const records = this.records();
		if (records[key] === undefined) return false;
		const { [key]: _removed, ...rest } = records;
		this.commit(rest);
		return true;
	}

	private records(): Record<string, unknown> {
		const encoded = this.storage?.getItem(WEB_COMPOSITION_STORAGE_KEY);
		if (encoded === null || encoded === undefined) return {};
		try {
			const value: unknown = JSON.parse(encoded);
			if (
				!record(value) ||
				value.version !== COMPOSITION_SCHEMA_VERSION ||
				!record(value.compositions)
			)
				return {};
			return value.compositions;
		} catch {
			return {};
		}
	}

	private commit(records: Record<string, unknown>): void {
		this.storage?.setItem(
			WEB_COMPOSITION_STORAGE_KEY,
			JSON.stringify({
				version: COMPOSITION_SCHEMA_VERSION,
				compositions: records,
			}),
		);
	}
}

/** A composition delegate half bound to one framed primary session origin. */
export function createCompositionDelegate(
	sessionOrigin: string,
	store: PwaWorkspaceCompositionStore = new PwaWorkspaceCompositionStore(),
): Pick<
	FramedConnectionManagerDelegate,
	'readComposition' | 'writeComposition'
> {
	const origin = exactFramedOrigin(sessionOrigin);
	return Object.freeze({
		readComposition: async () => store.read(origin),
		writeComposition: async (composition: TerminayWorkspaceComposition) =>
			store.write(origin, composition),
	});
}

function defaultChannel(): FramedMessageChannelLike {
	const channel = new MessageChannel();
	return {
		port1: channel.port1 as unknown as FramedBytePortLike,
		port2: channel.port2,
	};
}

function toBytes(value: unknown): Uint8Array | undefined {
	if (value instanceof Uint8Array)
		return value.byteLength === 0 ? undefined : value;
	if (value instanceof ArrayBuffer)
		return value.byteLength === 0 ? undefined : new Uint8Array(value);
	if (!ArrayBuffer.isView(value) || value.byteLength === 0) return undefined;
	return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function exactFramedOrigin(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('framed session origin is invalid');
	}
	const loopback =
		parsed.protocol === 'http:' &&
		(parsed.hostname === 'localhost' ||
			parsed.hostname.endsWith('.localhost') ||
			parsed.hostname === '127.0.0.1' ||
			parsed.hostname === '[::1]');
	if (
		(!loopback && parsed.protocol !== 'https:') ||
		parsed.origin !== value ||
		parsed.username ||
		parsed.password
	)
		throw new TypeError('framed session origin must be an exact origin');
	return parsed.origin;
}

function requestId(value: unknown): string {
	return identifier(value, 'request id');
}

function identifier(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value))
		throw new TypeError(`framed connection ${label} is invalid`);
	return value;
}

function exactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
	optional: readonly string[] = [],
): void {
	for (const key of Object.keys(value))
		if (!keys.includes(key) && !optional.includes(key))
			throw new TypeError('framed connection message has an unknown field');
	for (const key of keys)
		if (!(key in value))
			throw new TypeError('framed connection message is missing a field');
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : 'request failed';
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function browserStorage(): WebStorageLike | undefined {
	try {
		const storage = globalThis.localStorage;
		return storage === undefined ? undefined : storage;
	} catch {
		return undefined;
	}
}
