import {
	PUSH_MAX_COUNT,
	type PushBanner,
	type PushEnrolment,
	type PushState,
	sealPushPayload,
} from '@terminay/protocol';
import type { NotificationManager } from '../notifications/manager.js';
import type { NotificationRecord } from '../notifications/types.js';
import type { PushEnrolmentStore } from './enrolments.js';

const DEFAULT_COALESCE_MS = 250;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000] as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** What a banner calls the terminal and project a notification belongs to. */
export interface PushNotificationTitles {
	readonly terminalTitle: string;
	readonly projectTitle: string;
}

export interface PushResponse {
	readonly status: number;
}

export type PushTransport = (
	url: string,
	init: {
		readonly method: 'POST';
		readonly headers: Readonly<Record<string, string>>;
		readonly body: Uint8Array;
		readonly signal: AbortSignal;
	},
) => Promise<PushResponse>;

export interface PushSenderOptions {
	readonly notifications: NotificationManager;
	readonly enrolments: PushEnrolmentStore;
	/** Origin of the hosted push service, or how to find it once the server is
	 * exposed. Configured by the host; never taken from a client. */
	readonly origin: string | (() => string | undefined);
	/**
	 * Titles for a notification's terminal and project, or `undefined` for a
	 * notification that must not leave the server, such as one in the
	 * automation terminal space.
	 */
	readonly describe: (
		record: NotificationRecord,
	) => PushNotificationTitles | undefined;
	readonly transport?: PushTransport;
	readonly now?: () => number;
	readonly coalesceMs?: number;
	readonly retryDelaysMs?: readonly number[];
	readonly requestTimeoutMs?: number;
	readonly setTimeout?: (handler: () => void, milliseconds: number) => unknown;
	readonly clearTimeout?: (handle: unknown) => void;
}

interface DeviceState {
	/** Live connections of this device, and whether each window is visible. */
	readonly windows: Map<string, boolean>;
	/** What the device was last told, or knew when it stopped watching. A
	 * device that has been told nothing knows of no notifications. */
	known: string;
	sequence: number;
	/** The notification the next push should show. */
	bannerId: string | undefined;
	/** The newest notification that arose while the device was watching. */
	missedId: string | undefined;
	timer: unknown;
	sending: boolean;
	dirty: boolean;
	attempt: number;
}

/**
 * Pushes the notification manager's published set to paired devices that are
 * not looking at this server (ADR-0060). It is one more reader of that set: it
 * holds no rule about what a notification is and no settle period of its own.
 *
 * Every push states the server's current notifications in full, so a lost or
 * reordered push is repaired by the next. Nothing past is queued. A failure
 * here never reaches a terminal, a client, or the manager.
 */
export class PushSender {
	private readonly notifications: NotificationManager;
	private readonly enrolments: PushEnrolmentStore;
	private readonly origin: PushSenderOptions['origin'];
	private readonly describe: PushSenderOptions['describe'];
	private readonly transport: PushTransport;
	private readonly now: () => number;
	private readonly coalesceMs: number;
	private readonly retryDelaysMs: readonly number[];
	private readonly requestTimeoutMs: number;
	private readonly scheduleTimeout: (
		handler: () => void,
		milliseconds: number,
	) => unknown;
	private readonly cancelTimeout: (handle: unknown) => void;
	private readonly devices = new Map<string, DeviceState>();
	private readonly connections = new Map<string, string>();
	private readonly unsubscribe: () => void;
	private stopped = false;

	constructor(options: PushSenderOptions) {
		this.notifications = options.notifications;
		this.enrolments = options.enrolments;
		this.origin = options.origin;
		this.describe = options.describe;
		this.transport = options.transport ?? fetchTransport;
		this.now = options.now ?? (() => Date.now());
		this.coalesceMs = options.coalesceMs ?? DEFAULT_COALESCE_MS;
		this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
		this.requestTimeoutMs =
			options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.scheduleTimeout =
			options.setTimeout ??
			((handler, milliseconds) => {
				const timer = setTimeout(handler, milliseconds);
				timer.unref?.();
				return timer;
			});
		this.cancelTimeout =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.unsubscribe = this.notifications.subscribe((event) => {
			try {
				this.published(
					event.type === 'notification.removed' ? undefined : event.id,
				);
			} catch {
				// Push cannot fail the manager that told it.
			}
		});
	}

	/** Record a device's enrolment, sent by a window of that device. */
	enrol(deviceId: string, connectionId: string, enrolment: PushEnrolment): void {
		this.enrolments.set(deviceId, enrolment);
		// A window that has just enrolled is in front of its user.
		this.setVisibility(deviceId, connectionId, true);
	}

	/** End a device's enrolment at its own request. */
	withdraw(deviceId: string): void {
		this.removeDevice(deviceId);
	}

	/** A window reported whether its user can see it. It affects only that
	 * device's own pushes and grants nothing. */
	setVisibility(deviceId: string, connectionId: string, visible: boolean): void {
		if (this.stopped) return;
		const device = this.device(deviceId);
		const wasWatching = isWatching(device);
		this.connections.set(connectionId, deviceId);
		device.windows.set(connectionId, visible);
		this.watchingChanged(deviceId, device, wasWatching);
	}

	/** A connection ended, cleanly or because the server declared it dead. */
	connectionClosed(connectionId: string): void {
		const deviceId = this.connections.get(connectionId);
		if (deviceId === undefined) return;
		this.connections.delete(connectionId);
		const device = this.devices.get(deviceId);
		if (device === undefined) return;
		const wasWatching = isWatching(device);
		device.windows.delete(connectionId);
		this.watchingChanged(deviceId, device, wasWatching);
	}

	/** The device was revoked, or withdrew: it is sent nothing further. */
	removeDevice(deviceId: string): void {
		this.enrolments.remove(deviceId);
		const device = this.devices.get(deviceId);
		if (device === undefined) return;
		this.disarm(device);
		device.known = '';
		device.bannerId = undefined;
		device.missedId = undefined;
		device.dirty = false;
	}

	/** Keep only the enrolments of devices the server still trusts. A host
	 * calls this whenever its device registry changes. */
	retainDevices(trustedDeviceIds: Iterable<string>): void {
		const trusted = new Set(trustedDeviceIds);
		for (const deviceId of this.enrolments.deviceIds())
			if (!trusted.has(deviceId)) this.removeDevice(deviceId);
	}

	/** The server's identity was reset: every enrolment ends. */
	clear(): void {
		for (const deviceId of this.enrolments.deviceIds())
			this.removeDevice(deviceId);
		this.enrolments.clear();
	}

	isWatching(deviceId: string): boolean {
		const device = this.devices.get(deviceId);
		return device !== undefined && isWatching(device);
	}

	shutdown(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.unsubscribe();
		for (const device of this.devices.values()) this.disarm(device);
	}

	private published(bannerId: string | undefined): void {
		if (this.stopped) return;
		for (const deviceId of this.enrolments.deviceIds()) {
			const device = this.device(deviceId);
			if (isWatching(device)) {
				// Its window shows this already. Remember the newest, in case the
				// window goes away before the user has dealt with it.
				if (bannerId !== undefined) device.missedId = bannerId;
				continue;
			}
			this.schedule(device, deviceId, bannerId);
		}
	}

	private watchingChanged(
		deviceId: string,
		device: DeviceState,
		wasWatching: boolean,
	): void {
		const watching = isWatching(device);
		if (watching === wasWatching) return;
		if (watching) {
			// The user is looking: nothing pending is worth interrupting them for.
			this.disarm(device);
			device.bannerId = undefined;
			device.dirty = false;
			device.attempt = 0;
			return;
		}
		if (this.enrolments.get(deviceId) === undefined) return;
		const missed = device.missedId;
		device.missedId = undefined;
		if (missed !== undefined && this.visible().some((record) => record.id === missed)) {
			// It arose while the window was up and is still waiting.
			this.schedule(device, deviceId, missed);
			return;
		}
		// Until this moment the window showed the published set itself.
		device.known = signature(this.visible());
	}

	private schedule(
		device: DeviceState,
		deviceId: string,
		bannerId: string | undefined,
	): void {
		if (bannerId !== undefined) device.bannerId = bannerId;
		device.dirty = true;
		device.attempt = 0;
		if (device.timer !== undefined || device.sending) return;
		this.arm(device, deviceId, this.coalesceMs);
	}

	private arm(device: DeviceState, deviceId: string, delayMs: number): void {
		device.timer = this.scheduleTimeout(() => {
			device.timer = undefined;
			void this.flush(device, deviceId);
		}, delayMs);
	}

	private disarm(device: DeviceState): void {
		if (device.timer === undefined) return;
		this.cancelTimeout(device.timer);
		device.timer = undefined;
	}

	private async flush(device: DeviceState, deviceId: string): Promise<void> {
		if (this.stopped || device.sending) return;
		const enrolment = this.enrolments.get(deviceId);
		if (enrolment === undefined || isWatching(device)) {
			device.dirty = false;
			return;
		}
		device.dirty = false;
		const records = this.visible();
		const state = signature(records);
		const bannerRecord =
			device.bannerId === undefined
				? undefined
				: records.find((record) => record.id === device.bannerId);
		const banner =
			bannerRecord === undefined ? undefined : this.banner(bannerRecord);
		if (banner === undefined) {
			device.bannerId = undefined;
			// A push that shows nothing goes only where one is accepted, and only
			// when it would tell the device something new.
			if (!enrolment.silent || state === device.known) return;
		}

		device.sending = true;
		let outcome: 'sent' | 'gone' | 'retry';
		try {
			device.sequence = Math.max(device.sequence + 1, this.now());
			const pushed: PushState = {
				sequence: device.sequence,
				count: Math.min(records.length, PUSH_MAX_COUNT),
				outstanding: records.map((record) => record.id),
				...(banner === undefined ? {} : { banner }),
			};
			outcome = await this.send(enrolment, pushed);
		} catch {
			outcome = 'retry';
		}
		device.sending = false;
		if (this.stopped) return;

		if (outcome === 'gone') {
			// The hosted service no longer holds this enrolment.
			this.removeDevice(deviceId);
			return;
		}
		if (outcome === 'sent') {
			device.known = state;
			device.attempt = 0;
			if (banner !== undefined && device.bannerId === banner.id)
				device.bannerId = undefined;
			if (device.dirty) this.arm(device, deviceId, this.coalesceMs);
			return;
		}
		// Not delivered. Try again a bounded number of times, each time with
		// whatever is current then; after that the next change tries afresh.
		const delay = this.retryDelaysMs[device.attempt];
		device.attempt += 1;
		if (delay === undefined) {
			device.attempt = 0;
			if (device.dirty) this.arm(device, deviceId, this.coalesceMs);
			return;
		}
		device.dirty = true;
		this.arm(device, deviceId, delay);
	}

	private async send(
		enrolment: PushEnrolment,
		state: PushState,
	): Promise<'sent' | 'gone' | 'retry'> {
		const origin =
			typeof this.origin === 'function' ? this.origin() : this.origin;
		// A server that is not exposed has nowhere to post to yet.
		if (origin === undefined) return 'retry';
		const url = new URL('/v1/push', origin).toString();
		const body = await sealPushPayload(enrolment, state);
		const abort = new AbortController();
		const timer = this.scheduleTimeout(
			() => abort.abort(),
			this.requestTimeoutMs,
		);
		try {
			const response = await this.transport(url, {
				method: 'POST',
				headers: {
					authorization: `Bearer ${enrolment.token}`,
					'content-type': 'application/octet-stream',
				},
				body,
				signal: abort.signal,
			});
			if (response.status >= 200 && response.status < 300) return 'sent';
			return response.status === 404 || response.status === 410
				? 'gone'
				: 'retry';
		} finally {
			this.cancelTimeout(timer);
		}
	}

	/** The published notifications that may leave the server, newest first. */
	private visible(): NotificationRecord[] {
		return Object.values(this.notifications.snapshot().notifications)
			.filter((record) => this.describe(record) !== undefined)
			.sort(
				(a, b) => b.raisedAt - a.raisedAt || a.id.localeCompare(b.id),
			);
	}

	private banner(record: NotificationRecord): PushBanner | undefined {
		const titles = this.describe(record);
		if (titles === undefined) return undefined;
		return {
			id: record.id,
			kind: record.kind,
			terminalTitle: titles.terminalTitle,
			projectTitle: titles.projectTitle,
			raisedAt: record.raisedAt,
			projectId: record.projectId,
			sessionId: record.sessionId,
			...(record.title === undefined ? {} : { messageTitle: record.title }),
			...(record.body === undefined ? {} : { messageBody: record.body }),
		};
	}

	private device(deviceId: string): DeviceState {
		let device = this.devices.get(deviceId);
		if (device === undefined) {
			device = {
				windows: new Map(),
				known: '',
				sequence: 0,
				bannerId: undefined,
				missedId: undefined,
				timer: undefined,
				sending: false,
				dirty: false,
				attempt: 0,
			};
			this.devices.set(deviceId, device);
		}
		return device;
	}
}

function isWatching(device: DeviceState): boolean {
	for (const visible of device.windows.values()) if (visible) return true;
	return false;
}

function signature(records: readonly NotificationRecord[]): string {
	return records.map((record) => `${record.id}:${record.kind}`).join(',');
}

/**
 * The hosted push service for a server exposed at `sessionOrigin`: the manager
 * host beside it, `app.<domain>`. It is derived from where the server itself
 * is exposed and from nothing a client says.
 */
export function pushOriginForSessionOrigin(
	sessionOrigin: string,
): string | undefined {
	let url: URL;
	try {
		url = new URL(sessionOrigin);
	} catch {
		return undefined;
	}
	const labels = url.hostname.split('.');
	if (labels.length < 2 || (url.protocol !== 'https:' && url.protocol !== 'http:'))
		return undefined;
	labels[0] = 'app';
	return `${url.protocol}//${labels.join('.')}${url.port === '' ? '' : `:${url.port}`}`;
}

const fetchTransport: PushTransport = async (url, init) => {
	const response = await fetch(url, {
		method: init.method,
		headers: init.headers,
		body: init.body as unknown as BodyInit,
		signal: init.signal,
		redirect: 'error',
	});
	// The body is never read: the status is the whole answer.
	await response.body?.cancel().catch(() => undefined);
	return { status: response.status };
};
