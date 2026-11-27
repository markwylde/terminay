/**
 * Client-side view of one server's desktop.
 *
 * The server owns the desktop's state and who controls it; a client shows
 * what the server published and asks for changes by name. A request carries
 * nothing a server would have to trust: no package, command, display, or
 * mode. Each connection has its own client and store, so one server's
 * desktop never describes another's.
 */

import {
	FEATURE_CAPABILITIES,
	parseServerDesktopController,
	parseServerDesktopStatus,
	parseServerDesktopStream,
	SERVER_DESKTOP_EVENTS,
	SERVER_DESKTOP_OPERATIONS as op,
	type ServerDesktopController,
	type ServerDesktopHandle,
	type ServerDesktopMode,
	type ServerDesktopRefusal,
	type ServerDesktopStatus,
} from '@terminay/protocol';
import {
	ByteStreamClient,
	type ByteStreamTransport,
	type StreamHandle,
} from '@terminay/remote-desktop/client';
import type {
	BinaryCommandTransport,
	BinaryQueryTransport,
} from './queryCommand.js';
import type { ClientEvent, CommandOptions, QueryOptions } from './types.js';

export type {
	ServerDesktopController,
	ServerDesktopMode,
	ServerDesktopRefusal,
	ServerDesktopStatus,
};

export interface ServerDesktopClientTransport
	extends BinaryCommandTransport,
		BinaryQueryTransport {
	subscribe: (
		event: string,
		listener: (event: ClientEvent<unknown>) => void,
		onResync?: () => void,
	) => (() => void) | Promise<() => void>;
}

/** Whether a server's hello says it has a desktop to show. A server that
 * does not is shown no desktop control and is sent nothing. */
export function serverOffersDesktop(capabilities: readonly string[]): boolean {
	return capabilities.includes(FEATURE_CAPABILITIES.serverDesktop);
}

/** What the server said about its desktop and who controls it. */
export interface ServerDesktopSnapshot {
	readonly status: ServerDesktopStatus;
	readonly controller: ServerDesktopController | null;
}

const streamOperations = Object.freeze({
	read: op.read,
	write: op.write,
	// A desktop stream has no half-close: finishing it is closing it.
	finish: op.close,
	close: op.close,
});

/** One client's stream of the desktop, in the mode the server gave it. */
export class ServerDesktopStreamClient extends ByteStreamClient<
	ServerDesktopHandle & StreamHandle
> {
	constructor(
		transport: ServerDesktopClientTransport,
		handle: ServerDesktopHandle,
		readonly mode: ServerDesktopMode,
		readonly controller: ServerDesktopController | null,
	) {
		super(
			transport as unknown as ByteStreamTransport,
			streamOperations,
			handle as ServerDesktopHandle & StreamHandle,
			'desktop',
		);
	}
}

/** Why the server refused a desktop request, when it said. */
export function serverDesktopRefusal(
	error: unknown,
): { readonly reason: ServerDesktopRefusal; readonly windows?: number } | undefined {
	for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
		const details = (candidate as { details?: unknown } | undefined)?.details;
		if (details === null || typeof details !== 'object') continue;
		const reason = (details as { reason?: unknown }).reason;
		if (typeof reason !== 'string') continue;
		const windows = (details as { windows?: unknown }).windows;
		return {
			reason: reason as ServerDesktopRefusal,
			...(typeof windows === 'number' ? { windows } : {}),
		};
	}
	return undefined;
}

function snapshot(value: unknown): ServerDesktopSnapshot {
	const input = (value ?? {}) as { status?: unknown; controller?: unknown };
	const status = parseServerDesktopStatus(input.status);
	if (status === null) throw new TypeError('invalid server desktop status');
	return {
		status,
		// A controller that cannot be read is shown as nobody controlling.
		controller: parseServerDesktopController(input.controller) ?? null,
	};
}

function statusOf(value: unknown): ServerDesktopStatus {
	const status = parseServerDesktopStatus(
		(value as { status?: unknown } | null | undefined)?.status,
	);
	if (status === null) throw new TypeError('invalid server desktop status');
	return status;
}

export class ServerDesktopClient {
	/** Counts this client's streams, so a late reply to an older request
	 * can never replace a newer stream. */
	private generation = 0;

	constructor(private readonly transport: ServerDesktopClientTransport) {}

	/** The desktop's state now. Asking is also "check again": the server
	 * re-examines its host on each request and does not poll. */
	async status(options: QueryOptions = {}): Promise<ServerDesktopSnapshot> {
		return snapshot(await this.transport.query(op.status, {}, options));
	}

	/** Start setup, or join the one already running. */
	async setup(options: CommandOptions = {}): Promise<ServerDesktopStatus> {
		return statusOf(await this.transport.command(op.setup, {}, options));
	}

	async enable(options: CommandOptions = {}): Promise<ServerDesktopStatus> {
		return statusOf(await this.transport.command(op.enable, {}, options));
	}

	/** Turn the desktop off. Without `confirmed`, the server refuses with
	 * `windows-open` when program windows would close. */
	async disable(
		confirmed = false,
		options: CommandOptions = {},
	): Promise<ServerDesktopStatus> {
		return statusOf(
			await this.transport.command(
				op.disable,
				confirmed ? { confirmed: true } : {},
				options,
			),
		);
	}

	private async stream(
		operation: string,
		options: CommandOptions,
	): Promise<ServerDesktopStreamClient> {
		const opened = parseServerDesktopStream(
			await this.transport.command(
				operation,
				{ generation: ++this.generation },
				options,
			),
		);
		if (opened === null) throw new TypeError('invalid server desktop stream');
		return new ServerDesktopStreamClient(
			this.transport,
			opened.handle,
			opened.mode,
			opened.controller,
		);
	}

	/** Show the desktop. The server decides the mode: control for the first
	 * to open, view-only while someone else controls. Replaces this client's
	 * earlier stream. */
	open(options: CommandOptions = {}): Promise<ServerDesktopStreamClient> {
		return this.stream(op.open, options);
	}

	/** Take control from whoever has it. */
	takeControl(options: CommandOptions = {}): Promise<ServerDesktopStreamClient> {
		return this.stream(op.takeControl, options);
	}

	/** Give control up and keep watching. */
	releaseControl(
		options: CommandOptions = {},
	): Promise<ServerDesktopStreamClient> {
		return this.stream(op.releaseControl, options);
	}

	/**
	 * Follow the desktop's state and its controller. `onResync` runs when the
	 * connection came back and events may have been missed: ask `status` again.
	 */
	async watch(listeners: {
		readonly status?: (status: ServerDesktopStatus) => void;
		readonly controller?: (controller: ServerDesktopController | null) => void;
		readonly resync?: () => void;
	}): Promise<() => void> {
		const offChanged = await this.transport.subscribe(
			SERVER_DESKTOP_EVENTS.changed,
			(event) => {
				const status = parseServerDesktopStatus(
					(event.payload as { status?: unknown } | null)?.status,
				);
				if (status !== null) listeners.status?.(status);
			},
			listeners.resync,
		);
		const offControl = await this.transport.subscribe(
			SERVER_DESKTOP_EVENTS.control,
			(event) => {
				const controller = parseServerDesktopController(
					(event.payload as { controller?: unknown } | null)?.controller,
				);
				if (controller !== undefined) listeners.controller?.(controller);
			},
			listeners.resync,
		);
		return () => {
			offChanged();
			offControl();
		};
	}
}
