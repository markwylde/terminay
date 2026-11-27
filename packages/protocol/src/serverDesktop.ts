/**
 * The server desktop (the `server-desktop.v1` capability).
 *
 * A standalone server can run one virtual desktop on its own host, as the
 * server's account, and show it to the clients attached to it. Programs
 * started in the server's terminals draw on it. The desktop is reached only
 * through these operations: the server relays the screen and the input over
 * the connection a client already has, and nothing else can connect to it.
 *
 * Every operation here needs desktop authority: a connection with write
 * authority that is not narrowed to a project, terminal session, capability,
 * chat, or MCP principal. Events are published only to such connections.
 */

/** Hello capability advertised by every standalone server. */
export const SERVER_DESKTOP_CAPABILITY = 'server-desktop.v1' as const;

/** Every operation and event of the desktop begins with this. */
export const SERVER_DESKTOP_PREFIX = 'server.desktop.' as const;

export const SERVER_DESKTOP_OPERATIONS = Object.freeze({
	/** The desktop's state. The server re-examines the host to answer. */
	status: 'server.desktop.status',
	/** Install what the desktop needs. Carries nothing at all. */
	setup: 'server.desktop.setup',
	/** Turn the desktop on. */
	enable: 'server.desktop.enable',
	/** Turn the desktop off, which closes every window on it. */
	disable: 'server.desktop.disable',
	/** Open a stream of the desktop for this connection. */
	open: 'server.desktop.open',
	/** Make this connection the one that controls the desktop. */
	takeControl: 'server.desktop.take-control',
	/** Give control up and keep viewing. */
	releaseControl: 'server.desktop.release-control',
	read: 'server.desktop.read',
	write: 'server.desktop.write',
	close: 'server.desktop.close',
} as const);

export const SERVER_DESKTOP_EVENTS = Object.freeze({
	/** The status changed. Carries `{ status }`. */
	changed: 'server.desktop.changed',
	/** Who controls the desktop changed. Carries `{ controller }`. */
	control: 'server.desktop.control',
} as const);

export type ServerDesktopMode = 'view-only' | 'control';

/** Why a host cannot offer a desktop. */
export const SERVER_DESKTOP_UNSUPPORTED_REASONS = [
	/** The server does not run on Linux. */
	'not-linux',
	/** The host's `os-release` does not identify Debian. */
	'not-debian',
	/** The server's temporary directory is private to its service, so the
	 * programs it starts could not reach the display. */
	'private-temporary-directory',
	/** The display server cannot be started without network access here. */
	'network-cannot-be-denied',
] as const;
export type ServerDesktopUnsupportedReason =
	(typeof SERVER_DESKTOP_UNSUPPORTED_REASONS)[number];

/** The named steps of setup, in order. */
export const SERVER_DESKTOP_SETUP_STEPS = [
	'waiting',
	'preparing',
	'downloading',
	'installing',
	'starting',
] as const;
export type ServerDesktopSetupStep =
	(typeof SERVER_DESKTOP_SETUP_STEPS)[number];

/** How setup can be run on this host. */
export const SERVER_DESKTOP_SETUP_MEANS = [
	/** The server can run setup itself when asked. */
	'server',
	/** An operator runs the command; the server cannot elevate. */
	'command',
] as const;
export type ServerDesktopSetupMeans =
	(typeof SERVER_DESKTOP_SETUP_MEANS)[number];

export const SERVER_DESKTOP_MAX_TEXT_CHARS = 2048;
export const SERVER_DESKTOP_MAX_COMMAND_CHARS = 512;
export const SERVER_DESKTOP_MAX_DEVICE_NAME_CHARS = 128;
export const SERVER_DESKTOP_MAX_ID_CHARS = 128;
/** X display numbers a desktop may be given. */
export const SERVER_DESKTOP_MAX_DISPLAY = 65535;

/** Exactly one state at a time. */
export type ServerDesktopStatus =
	| {
			readonly state: 'unsupported';
			readonly reason: ServerDesktopUnsupportedReason;
			/** The same reason, in words for the window. */
			readonly message: string;
	  }
	| {
			readonly state: 'needs-setup';
			readonly setup: ServerDesktopSetupMeans;
			/** The one command that performs the same setup. */
			readonly command: string;
	  }
	| {
			readonly state: 'setting-up';
			readonly step: ServerDesktopSetupStep;
			/** Completed part of the whole setup, 0 to 1. */
			readonly fraction: number;
	  }
	| {
			readonly state: 'ready';
			/** The X display number programs are given. */
			readonly display: number;
	  }
	| { readonly state: 'off' }
	| {
			readonly state: 'failed';
			/** The setup step that failed; absent when the desktop's start did. */
			readonly step?: ServerDesktopSetupStep;
			readonly reason: string;
			/** How setup can be retried on this host. */
			readonly setup: ServerDesktopSetupMeans;
			readonly command: string;
	  };

export type ServerDesktopState = ServerDesktopStatus['state'];

/** The device holding control, as other devices are told. */
export interface ServerDesktopController {
	readonly clientId: string;
	/** The device's name as it paired, for "Taken over by ...". */
	readonly deviceName: string;
}

/** One client stream of the desktop. */
export interface ServerDesktopHandle {
	readonly streamId: string;
	readonly generation: number;
}

/** The answer to `open` and `take-control`. */
export interface ServerDesktopStream {
	readonly handle: ServerDesktopHandle;
	readonly mode: ServerDesktopMode;
	/** Who controls the desktop now, or null when nobody does. */
	readonly controller: ServerDesktopController | null;
}

/** Why a desktop request was refused, in the error's `details.reason`. */
export const SERVER_DESKTOP_REFUSALS = [
	/** The desktop is not running. */
	'not-ready',
	/** Setup was asked of a host where the operator must run the command. */
	'setup-by-command',
	/** Setup was asked of a host that cannot offer a desktop. */
	'unsupported',
	/** Turning the desktop off would close open windows and was not confirmed. */
	'windows-open',
	/** A newer stream of this connection replaced the one named. */
	'stale-generation',
] as const;
export type ServerDesktopRefusal = (typeof SERVER_DESKTOP_REFUSALS)[number];

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function text(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function oneOf<T extends string>(
	values: readonly T[],
	value: unknown,
): value is T {
	return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function onlyKeys(input: Record<string, unknown>, keys: readonly string[]) {
	return Object.keys(input).every((key) => keys.includes(key));
}

/** Read a status from a response or event; anything malformed is null. */
export function parseServerDesktopStatus(
	value: unknown,
): ServerDesktopStatus | null {
	const input = record(value);
	if (input === null) return null;
	switch (input.state) {
		case 'unsupported':
			return oneOf(SERVER_DESKTOP_UNSUPPORTED_REASONS, input.reason) &&
				text(input.message, SERVER_DESKTOP_MAX_TEXT_CHARS)
				? { state: 'unsupported', reason: input.reason, message: input.message }
				: null;
		case 'needs-setup':
			return oneOf(SERVER_DESKTOP_SETUP_MEANS, input.setup) &&
				text(input.command, SERVER_DESKTOP_MAX_COMMAND_CHARS)
				? { state: 'needs-setup', setup: input.setup, command: input.command }
				: null;
		case 'setting-up':
			return oneOf(SERVER_DESKTOP_SETUP_STEPS, input.step) &&
				typeof input.fraction === 'number' &&
				Number.isFinite(input.fraction)
				? {
						state: 'setting-up',
						step: input.step,
						fraction: Math.min(1, Math.max(0, input.fraction)),
					}
				: null;
		case 'ready':
			return Number.isInteger(input.display) &&
				(input.display as number) >= 0 &&
				(input.display as number) <= SERVER_DESKTOP_MAX_DISPLAY
				? { state: 'ready', display: input.display as number }
				: null;
		case 'off':
			return { state: 'off' };
		case 'failed':
			if (
				!text(input.reason, SERVER_DESKTOP_MAX_TEXT_CHARS) ||
				!oneOf(SERVER_DESKTOP_SETUP_MEANS, input.setup) ||
				!text(input.command, SERVER_DESKTOP_MAX_COMMAND_CHARS) ||
				(input.step !== undefined &&
					!oneOf(SERVER_DESKTOP_SETUP_STEPS, input.step))
			)
				return null;
			return {
				state: 'failed',
				...(input.step === undefined ? {} : { step: input.step }),
				reason: input.reason,
				setup: input.setup,
				command: input.command,
			};
		default:
			return null;
	}
}

/** Read a controller from a response or event; `null` means nobody controls
 * the desktop, and `undefined` means the value was malformed. */
export function parseServerDesktopController(
	value: unknown,
): ServerDesktopController | null | undefined {
	if (value === null) return null;
	const input = record(value);
	if (
		input === null ||
		!text(input.clientId, SERVER_DESKTOP_MAX_ID_CHARS) ||
		typeof input.deviceName !== 'string' ||
		input.deviceName.length > SERVER_DESKTOP_MAX_DEVICE_NAME_CHARS
	)
		return undefined;
	return { clientId: input.clientId, deviceName: input.deviceName };
}

/** Read a stream handle from a request; anything malformed is null. */
export function parseServerDesktopHandle(
	value: unknown,
): ServerDesktopHandle | null {
	const input = record(value);
	if (
		input === null ||
		!onlyKeys(input, ['streamId', 'generation']) ||
		!text(input.streamId, SERVER_DESKTOP_MAX_ID_CHARS) ||
		!Number.isSafeInteger(input.generation) ||
		(input.generation as number) < 1
	)
		return null;
	return { streamId: input.streamId, generation: input.generation as number };
}

/** Read the answer to `open` or `take-control`; anything malformed is null. */
export function parseServerDesktopStream(
	value: unknown,
): ServerDesktopStream | null {
	const input = record(value);
	if (input === null) return null;
	const handle = parseServerDesktopHandle(input.handle);
	const controller = parseServerDesktopController(input.controller);
	if (
		handle === null ||
		controller === undefined ||
		!oneOf(['view-only', 'control'] as const, input.mode)
	)
		return null;
	return { handle, mode: input.mode, controller };
}

/**
 * Whether a request carries nothing: no payload at all, or an empty object.
 * `setup`, `enable` and `status` take nothing, so that no package name,
 * source, path, flag, or other choice can travel in them.
 */
export function isEmptyServerDesktopRequest(value: unknown): boolean {
	if (value === undefined || value === null) return true;
	const input = record(value);
	return input !== null && Object.keys(input).length === 0;
}

/** Read an `open` or `take-control` request: the generation of the stream
 * this connection is about to hold. Anything else in it is refused. */
export function parseServerDesktopOpenRequest(
	value: unknown,
): { readonly generation: number } | null {
	const input = record(value);
	if (
		input === null ||
		!onlyKeys(input, ['generation']) ||
		!Number.isSafeInteger(input.generation) ||
		(input.generation as number) < 1
	)
		return null;
	return { generation: input.generation as number };
}

/** Read a `disable` request. `confirmed` says the user accepted that open
 * windows will close; nothing else may be carried. */
export function parseServerDesktopDisableRequest(
	value: unknown,
): { readonly confirmed: boolean } | null {
	if (value === undefined || value === null) return { confirmed: false };
	const input = record(value);
	if (
		input === null ||
		!onlyKeys(input, ['confirmed']) ||
		(input.confirmed !== undefined && typeof input.confirmed !== 'boolean')
	)
		return null;
	return { confirmed: input.confirmed === true };
}

/** True for every operation and event of the desktop. */
export function isServerDesktopName(name: string): boolean {
	return typeof name === 'string' && name.startsWith(SERVER_DESKTOP_PREFIX);
}
