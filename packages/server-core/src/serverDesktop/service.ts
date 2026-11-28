import { randomUUID } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
	isEmptyServerDesktopRequest,
	type JsonValue,
	parseServerDesktopDisableRequest,
	parseServerDesktopHandle,
	parseServerDesktopOpenRequest,
	protocolError,
	SERVER_DESKTOP_EVENTS,
	SERVER_DESKTOP_OPERATIONS,
	type ServerDesktopController,
	type ServerDesktopMode,
	type ServerDesktopRefusal,
	type ServerDesktopSetupMeans,
	type ServerDesktopSetupStep,
	type ServerDesktopStatus,
	type ServerDesktopStream,
} from '@terminay/protocol';
import {
	DESKTOP_RESIZE_LIMITS,
	type DesktopConnector,
	DesktopInputGate,
	type DesktopUpstream,
	openDesktopStream,
	type RfbRelay,
	unixSocketConnector,
} from '@terminay/remote-desktop/server';
import {
	DESKTOP_SESSION_SCRIPT,
	DISPLAY_LAUNCHER_SCRIPT,
	desktopSessionDirectory,
} from '@terminay/remote-desktop/session';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';
import {
	assertServerDesktopAuthority,
	ServerDesktopConnections,
	type ServerDesktopStreamAuthority,
} from './authority.js';
import {
	adoptOrStartDesktopHolder,
	connectDesktopHolder,
	type DesktopHolderAdoption,
	type DesktopHolderClient,
	type DesktopHolderConnection,
	type DesktopHolderLaunch,
} from './holderClient.js';
import {
	type ServerDesktopPaths,
	serverDesktopOffRecord,
	serverDesktopPaths,
} from './paths.js';
import {
	examineServerDesktopHost,
	hostFacts,
	type ServerDesktopHostFacts,
	type ServerDesktopProgram,
} from './support.js';

/** Where setup has got to. */
export interface ServerDesktopSetupProgress {
	readonly step: ServerDesktopSetupStep;
	/** Completed part of the whole, 0 to 1. */
	readonly fraction: number;
}

export type ServerDesktopSetupOutcome =
	| { readonly ok: true }
	| {
			readonly ok: false;
			readonly step?: ServerDesktopSetupStep;
			readonly reason: string;
	  };

/** How this host installs what the desktop needs. The service decides when;
 * this decides how, and never takes anything from a client. */
export interface ServerDesktopSetup {
	/** Whether the server can run setup itself, and the command that does the
	 * same by hand. */
	describe(): Promise<{
		readonly means: ServerDesktopSetupMeans;
		readonly command: string;
	}>;
	/** Start setup, or join the one already running. */
	run(
		onProgress: (progress: ServerDesktopSetupProgress) => void,
	): Promise<ServerDesktopSetupOutcome>;
	/** A setup already running, such as one a previous server process began. */
	running(): Promise<ServerDesktopSetupProgress | undefined>;
}

export interface ServerDesktopServiceOptions {
	readonly eventJournal: OrderedEventJournalLike;
	/** The owner-only desktop directory, short enough for its sockets. */
	readonly directory: string;
	readonly dataRoot: string;
	/** The directory programs on the desktop start in. */
	readonly home: string;
	readonly setup: ServerDesktopSetup;
	/** The environment the desktop's programs inherit. */
	readonly env?: Readonly<Record<string, string | undefined>>;
	/** The paired device's name behind a connection, for "taken over by". */
	readonly deviceName?: (context: RequestContext) => string | undefined;
	readonly facts?: ServerDesktopHostFacts;
	/** Test seams; production reaches the real holder. */
	readonly holders?: {
		readonly adoptOrStart: (
			directory: string,
			launch: DesktopHolderLaunch,
		) => Promise<DesktopHolderAdoption>;
		readonly connect: (directory: string) => Promise<DesktopHolderConnection>;
	};
	readonly connector?: (paths: ServerDesktopPaths) => DesktopConnector;
	readonly onDiagnostic?: (message: string) => void;
}

interface Stream {
	readonly id: string;
	readonly generation: number;
	readonly mode: ServerDesktopMode;
	readonly authority: ServerDesktopStreamAuthority;
	readonly relay: RfbRelay;
	readonly reader: AsyncIterator<Uint8Array>;
	/** Resolves once the stream's own connection to the display has closed. */
	readonly ended: Promise<void>;
	reading: boolean;
	writing: boolean;
}

const LIMITS = { inputBytes: 4 * 1024 * 1024, clipboardBytes: 1024 * 1024 };
const MAX_CHUNK = 1024 * 1024;

function refuse(reason: ServerDesktopRefusal, message: string, extra: Record<string, JsonValue> = {}) {
	return protocolError('conflict', message, { details: { reason, ...extra } });
}

/**
 * The server desktop: one virtual desktop on the server's own host, shown to
 * the clients in Terminay and reachable no other way.
 *
 * The service owns the state a client sees, decides when the holder runs,
 * and relays each client stream over its own connection to the display.
 */
export class ServerDesktopService {
	readonly connections = new ServerDesktopConnections();
	private readonly paths: ServerDesktopPaths;
	private readonly facts: ServerDesktopHostFacts;
	private readonly launcher: string;
	private readonly sessionScript: string;
	private readonly gate = new DesktopInputGate();
	private readonly streams = new Map<string, Stream>();
	private holder: DesktopHolderClient | undefined;
	private holderGeneration = -1;
	private settingUp: ServerDesktopSetupProgress | undefined;
	private failure:
		| { readonly step?: ServerDesktopSetupStep; readonly reason: string }
		| undefined;
	private controller:
		| (ServerDesktopController & { readonly connectionId: string })
		| null = null;
	private published = '';
	private latest: ServerDesktopStatus | undefined;
	/** Serializes examinations of the host and changes to the holder. */
	private examining: Promise<unknown> = Promise.resolve();
	/** Serializes opens and takeovers, so there is one controller. */
	private controlling: Promise<unknown> = Promise.resolve();
	private disposed = false;

	constructor(private readonly options: ServerDesktopServiceOptions) {
		this.paths = serverDesktopPaths(options.directory);
		const assets = desktopSessionDirectory();
		this.launcher = join(assets, DISPLAY_LAUNCHER_SCRIPT);
		this.sessionScript = join(assets, DESKTOP_SESSION_SCRIPT);
		this.facts = options.facts ?? hostFacts(this.launcher);
	}

	/** Called once when the server starts. A desktop that is set up and on
	 * runs whenever the server runs, so terminals opened before anyone looks
	 * at it already have a display that answers. */
	async start(): Promise<void> {
		const running = await this.options.setup.running().catch(() => undefined);
		if (running !== undefined) this.beginSetup(running);
		await this.refresh().catch((error: unknown) =>
			this.options.onDiagnostic?.(
				`server desktop: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}

	/** The display environment for a new terminal, while the desktop runs. */
	displayEnvironment(): { DISPLAY: string; XAUTHORITY: string } | undefined {
		// A server that has a display of its own keeps it for its terminals.
		const own = this.options.env ?? process.env;
		if (own.DISPLAY || own.WAYLAND_DISPLAY) return undefined;
		const state = this.holder?.alive ? this.holder.state : undefined;
		if (state?.phase !== 'running' || state.display === undefined)
			return undefined;
		return { DISPLAY: `:${state.display}`, XAUTHORITY: this.paths.cookie };
	}

	/** Re-examine the host, bring the holder to what the state calls for, and
	 * publish the status if it changed. */
	refresh(): Promise<ServerDesktopStatus> {
		const next = this.examining.then(
			() => this.examine(),
			() => this.examine(),
		);
		this.examining = next.catch(() => undefined);
		return next;
	}

	private async isOff(): Promise<boolean> {
		return stat(serverDesktopOffRecord(this.options.dataRoot)).then(
			() => true,
			() => false,
		);
	}

	private async examine(): Promise<ServerDesktopStatus> {
		const status = await this.compute();
		this.latest = status;
		const text = JSON.stringify(status);
		if (text !== this.published) {
			this.published = text;
			// Only connections with desktop authority are sent this event.
			this.options.eventJournal.publishTransient(SERVER_DESKTOP_EVENTS.changed, {
				status: status as unknown as JsonValue,
			});
		}
		return status;
	}

	private async compute(): Promise<ServerDesktopStatus> {
		const support = await examineServerDesktopHost(this.facts);
		if (!support.supported) {
			return {
				state: 'unsupported',
				reason: support.reason,
				message: support.message,
			};
		}
		if (this.settingUp !== undefined)
			return { state: 'setting-up', ...this.settingUp };
		const how = await this.options.setup.describe();
		if (support.missing.length > 0) {
			if (this.failure !== undefined)
				return {
					state: 'failed',
					...(this.failure.step === undefined ? {} : { step: this.failure.step }),
					reason: this.failure.reason,
					setup: how.means,
					command: how.command,
				};
			return { state: 'needs-setup', setup: how.means, command: how.command };
		}
		// The programs are there, whoever installed them.
		this.failure = undefined;
		if (await this.isOff()) {
			await this.stopHolder();
			return { state: 'off' };
		}
		const holder = await this.ensureHolder(support.programs);
		if (typeof holder === 'string')
			return {
				state: 'failed',
				reason: holder,
				setup: how.means,
				command: how.command,
			};
		const state = holder.state;
		if (state.phase === 'running' && state.display !== undefined)
			return { state: 'ready', display: state.display };
		if (state.phase === 'failed')
			return {
				state: 'failed',
				reason: state.reason ?? 'The desktop could not be started.',
				setup: how.means,
				command: how.command,
			};
		return { state: 'setting-up', step: 'starting', fraction: 1 };
	}

	/** The live holder, adopted or started; or why there is none. */
	private async ensureHolder(
		programs: Readonly<Partial<Record<ServerDesktopProgram, string>>>,
	): Promise<DesktopHolderClient | string> {
		if (this.holder?.alive) return this.holder;
		this.holder = undefined;
		const adopt =
			this.options.holders?.adoptOrStart ?? adoptOrStartDesktopHolder;
		const adoption = await adopt(this.options.directory, {
			dataRoot: this.options.dataRoot,
			home: this.options.home,
			programs: {
				displayServer: programs.displayServer as string,
				passwordTool: programs.passwordTool as string,
				python: programs.python as string,
				shell: programs.shell as string,
			},
			launcher: this.launcher,
			sessionScript: this.sessionScript,
			env: this.options.env ?? process.env,
		});
		if (adoption.outcome === 'failed') return adoption.reason;
		if (adoption.replaced !== undefined)
			this.options.onDiagnostic?.(
				`server desktop: the running desktop spoke control protocol ${adoption.replaced}, which this release does not; it was restarted and its windows closed`,
			);
		this.watch(adoption.client);
		return adoption.client;
	}

	private watch(client: DesktopHolderClient): void {
		this.holder = client;
		this.holderGeneration = client.state.generation;
		client.onState((state) => {
			if (this.holder !== client) return;
			// A new display, or none: every stream of the old one is dead.
			if (state.phase !== 'running' || state.generation !== this.holderGeneration)
				this.closeStreams();
			this.holderGeneration = state.generation;
			void this.refresh().catch(() => undefined);
		});
		client.onClosed(() => {
			if (this.holder !== client) return;
			this.holder = undefined;
			this.closeStreams();
			// The holder went away on its own: look again, which starts another
			// unless the desktop is off.
			if (!this.disposed) void this.refresh().catch(() => undefined);
		});
	}

	private async stopHolder(): Promise<void> {
		this.closeStreams();
		let holder = this.holder;
		this.holder = undefined;
		if (holder === undefined) {
			// One left by an earlier server process is stopped the same way.
			const connect = this.options.holders?.connect ?? connectDesktopHolder;
			const connection = await connect(this.options.directory);
			if (connection.outcome === 'adopted') holder = connection.client;
		}
		await holder?.stop();
	}

	private closeStreams(): void {
		for (const stream of [...this.streams.values()]) stream.relay.destroy();
	}

	// ---- setup ----

	private beginSetup(initial: ServerDesktopSetupProgress): void {
		if (this.settingUp !== undefined) return;
		this.settingUp = initial;
		this.failure = undefined;
		void this.options.setup
			.run((progress) => {
				this.settingUp = {
					step: progress.step,
					fraction: Math.min(1, Math.max(0, progress.fraction)),
				};
				void this.refresh().catch(() => undefined);
			})
			.catch(
				(error: unknown): ServerDesktopSetupOutcome => ({
					ok: false,
					reason: error instanceof Error ? error.message : String(error),
				}),
			)
			.then((outcome) => {
				this.settingUp = undefined;
				this.failure = outcome.ok
					? undefined
					: {
							...(outcome.step === undefined ? {} : { step: outcome.step }),
							reason: outcome.reason.slice(0, 2048) || 'Setup failed.',
						};
				// Completing setup starts the desktop, unless it is off.
				return this.refresh();
			})
			.catch(() => undefined);
	}

	private async setup(): Promise<ServerDesktopStatus> {
		// A request made while setup runs joins that setup.
		if (this.settingUp !== undefined) return this.refresh();
		const status = await this.refresh();
		if (status.state === 'unsupported')
			throw refuse('unsupported', 'This host cannot offer a desktop.');
		if (status.state !== 'needs-setup' && status.state !== 'failed')
			return status;
		if (status.setup !== 'server')
			throw refuse(
				'setup-by-command',
				'Setup has to be run by an operator on this host.',
			);
		this.beginSetup({ step: 'waiting', fraction: 0 });
		return this.refresh();
	}

	// ---- on and off ----

	private async enable(): Promise<ServerDesktopStatus> {
		await rm(serverDesktopOffRecord(this.options.dataRoot), { force: true });
		return this.refresh();
	}

	private async disable(confirmed: boolean): Promise<ServerDesktopStatus> {
		const holder = this.holder?.alive ? this.holder : undefined;
		if (holder !== undefined && !confirmed) {
			const windows = await holder.windows().catch(() => -1);
			// Unknown is treated as open: closing them unasked is the harm.
			if (windows !== 0)
				throw refuse(
					'windows-open',
					'Turning the desktop off closes the windows open on it.',
					{ windows },
				);
		}
		await writeFile(serverDesktopOffRecord(this.options.dataRoot), '', {
			mode: 0o600,
		});
		return this.refresh();
	}

	// ---- streams ----

	private queue<T>(work: () => Promise<T>): Promise<T> {
		const next = this.controlling.then(work, work);
		this.controlling = next.catch(() => undefined);
		return next;
	}

	private streamOf(connectionId: string): Stream | undefined {
		for (const stream of this.streams.values())
			if (stream.authority.connectionId === connectionId) return stream;
		return undefined;
	}

	private describe(stream: Stream): ServerDesktopStream {
		return {
			handle: { streamId: stream.id, generation: stream.generation },
			mode: stream.mode,
			controller: this.publicController(),
		};
	}

	private publicController(): ServerDesktopController | null {
		return this.controller === null
			? null
			: {
					clientId: this.controller.clientId,
					deviceName: this.controller.deviceName,
				};
	}

	private setController(
		next: (ServerDesktopController & { readonly connectionId: string }) | null,
	): void {
		if (this.controller?.connectionId === next?.connectionId) return;
		this.controller = next;
		this.options.eventJournal.publishTransient(SERVER_DESKTOP_EVENTS.control, {
			controller: this.publicController() as unknown as JsonValue,
		});
	}

	/** End a stream and wait until its connection to the display has closed. */
	private async endStream(stream: Stream | undefined): Promise<void> {
		if (stream === undefined) return;
		stream.relay.destroy();
		await stream.ended;
	}

	private async openStream(
		context: RequestContext,
		generation: number,
		mode: ServerDesktopMode,
	): Promise<Stream> {
		const authority = this.connections.authority(context);
		const holder = this.holder;
		if (!holder?.alive || holder.state.phase !== 'running')
			throw refuse('not-ready', 'The desktop is not running.');
		const displayGeneration = holder.state.generation;
		const base =
			this.options.connector?.(this.paths) ?? unixSocketConnector(this.paths.rfb);
		// The same connector, noting when this stream's connection ends.
		let finish: () => void = () => undefined;
		const ended = new Promise<void>((resolve) => {
			finish = resolve;
		});
		let own = true;
		const connector: DesktopConnector = {
			open: async () => {
				const upstream: DesktopUpstream = await base.open();
				// The first connection is the stream's; a later one releases a
				// pointer button the stream left down.
				if (own) {
					own = false;
					upstream.onEnd(finish);
				}
				return upstream;
			},
		};
		const id = randomUUID();
		let relay: RfbRelay;
		try {
			relay = await openDesktopStream({
				connector,
				mode,
				authority: { signal: authority.signal, assert: authority.assert },
				// The passwords are asked of the holder for each connection and
				// kept nowhere in this process.
				withPassword: async (as, callback) => {
					const credentials = await holder.credentials();
					const password = Buffer.from(
						as === 'control' ? credentials.full : credentials.viewOnly,
					);
					try {
						return await callback(password);
					} finally {
						password.fill(0);
					}
				},
				limits: LIMITS,
				// The desktop follows its controller's window.
				resize: DESKTOP_RESIZE_LIMITS,
				gate: this.gate,
				admit: () => {
					if (
						this.holder !== holder ||
						holder.state.phase !== 'running' ||
						holder.state.generation !== displayGeneration
					)
						throw new Error('the desktop changed');
				},
				releasable: () =>
					this.holder === holder &&
					holder.alive &&
					holder.state.generation === displayGeneration,
				onClosed: () => {
					const stream = this.streams.get(id);
					this.streams.delete(id);
					if (own) finish();
					// A controller that leaves, however it leaves, controls nothing.
					if (
						stream?.mode === 'control' &&
						this.controller?.connectionId === authority.connectionId &&
						!this.handingOver.has(authority.connectionId)
					)
						this.setController(null);
				},
			});
		} catch (error) {
			if (own) finish();
			throw error instanceof Error && error.message === 'desktop connection failed'
				? protocolError('unavailable', 'The desktop could not be reached.')
				: error;
		}
		const stream: Stream = {
			id,
			generation,
			mode,
			authority,
			relay,
			reader: relay[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>,
			ended,
			reading: false,
			writing: false,
		};
		this.streams.set(id, stream);
		return stream;
	}

	/** Connections whose control stream is being replaced by another stream
	 * of their own; ending it is not "the controller left". */
	private readonly handingOver = new Set<string>();

	/** Replace a connection's stream with one of `mode`. */
	private async replaceStream(
		context: RequestContext,
		generation: number,
		mode: ServerDesktopMode,
	): Promise<Stream> {
		const existing = this.streamOf(context.connectionId);
		if (existing !== undefined && existing.generation >= generation)
			throw refuse('stale-generation', 'A newer desktop stream replaced this one.');
		this.handingOver.add(context.connectionId);
		try {
			await this.endStream(existing);
			return await this.openStream(context, generation, mode);
		} finally {
			this.handingOver.delete(context.connectionId);
		}
	}

	private controllerFor(context: RequestContext) {
		return {
			connectionId: context.connectionId,
			clientId: context.clientId,
			deviceName: (this.options.deviceName?.(context) ?? '').slice(0, 128),
		};
	}

	private open(context: RequestContext, generation: number) {
		return this.queue(async () => {
			// Control goes to the first to open, and stays with whoever holds it.
			const mode: ServerDesktopMode =
				this.controller === null ||
				this.controller.connectionId === context.connectionId
					? 'control'
					: 'view-only';
			try {
				const stream = await this.replaceStream(context, generation, mode);
				if (mode === 'control') this.setController(this.controllerFor(context));
				return this.describe(stream);
			} catch (error) {
				if (this.controller?.connectionId === context.connectionId)
					this.setController(null);
				throw error;
			}
		});
	}

	private takeControl(context: RequestContext, generation: number) {
		return this.queue(async () => {
			const previous = this.controller;
			if (previous !== null && previous.connectionId !== context.connectionId) {
				// The old controller's own connection to the display is closed,
				// and seen closed, before the new one is opened.
				this.handingOver.add(previous.connectionId);
				try {
					await this.endStream(this.streamOf(previous.connectionId));
				} finally {
					this.handingOver.delete(previous.connectionId);
				}
			}
			try {
				const stream = await this.replaceStream(context, generation, 'control');
				this.setController(this.controllerFor(context));
				return this.describe(stream);
			} catch (error) {
				// Nobody controls a desktop whose takeover failed part-way.
				this.setController(null);
				throw error;
			}
		});
	}

	private releaseControl(context: RequestContext, generation: number) {
		return this.queue(async () => {
			const stream = await this.replaceStream(context, generation, 'view-only');
			if (this.controller?.connectionId === context.connectionId)
				this.setController(null);
			return this.describe(stream);
		});
	}

	private stream(request: QueryRequest | CommandRequest): Stream {
		assertServerDesktopAuthority(request.context);
		const handle = parseServerDesktopHandle(request.envelope.payload);
		if (handle === null)
			throw protocolError('validation', 'the desktop stream handle is invalid');
		const stream = this.streams.get(handle.streamId);
		if (
			stream === undefined ||
			stream.generation !== handle.generation ||
			stream.authority.connectionId !== request.context.connectionId ||
			stream.authority.clientId !== request.context.clientId
		)
			throw protocolError('not_found', 'no such desktop stream');
		// Revalidated on every read and write, not only when it was opened.
		stream.authority.assert();
		return stream;
	}

	/** A connection ended or its device was revoked. */
	closeConnection(connectionId: string): void {
		this.connections.revoke(connectionId);
		for (const stream of [...this.streams.values()])
			if (stream.authority.connectionId === connectionId) stream.relay.destroy();
	}

	/** The server is stopping. The holder and its desktop keep running. */
	dispose(): void {
		this.disposed = true;
		this.closeStreams();
		this.connections.close();
		const holder = this.holder;
		this.holder = undefined;
		holder?.disconnect();
	}

	operations(): OperationRegistries {
		const op = SERVER_DESKTOP_OPERATIONS;
		const nothing = (request: QueryRequest | CommandRequest, name: string) => {
			assertServerDesktopAuthority(request.context);
			if (!isEmptyServerDesktopRequest(request.envelope.payload))
				throw protocolError('validation', `${name} takes no fields`);
		};
		const generation = (request: CommandRequest): number => {
			assertServerDesktopAuthority(request.context);
			const parsed = parseServerDesktopOpenRequest(request.envelope.payload);
			if (parsed === null)
				throw protocolError('validation', 'the desktop stream request is invalid');
			return parsed.generation;
		};
		const answer = (status: ServerDesktopStatus) => ({
			result: { status: status as unknown as JsonValue },
		});
		const streamAnswer = (stream: ServerDesktopStream) => ({
			result: stream as unknown as JsonValue,
		});
		return {
			// `write` is the coarse gate; each handler then checks that the
			// connection is not narrowed, before it reads or reveals anything.
			policies: Object.fromEntries(
				Object.values(op).map((name) => [name, { scope: 'write' as const }]),
			),
			queries: {
				[op.status]: async (request) => {
					nothing(request, 'status');
					return {
						status: (await this.refresh()) as unknown as JsonValue,
						controller: this.publicController() as unknown as JsonValue,
					};
				},
				[op.read]: async (request) => {
					const stream = this.stream(request);
					if (stream.reading)
						throw protocolError('conflict', 'a desktop read is already pending');
					stream.reading = true;
					const abort = () => stream.relay.destroy();
					request.context.signal.addEventListener('abort', abort, { once: true });
					try {
						const next = await stream.reader.next();
						stream.authority.assert();
						if (next.done || !this.streams.has(stream.id))
							return { result: { done: true }, body: new Uint8Array() };
						if (next.value.length > MAX_CHUNK) {
							stream.relay.destroy();
							throw protocolError('resource', 'a desktop chunk exceeded its bound');
						}
						return { result: { done: false }, body: next.value };
					} catch (error) {
						stream.relay.destroy();
						throw error;
					} finally {
						stream.reading = false;
						request.context.signal.removeEventListener('abort', abort);
					}
				},
			},
			commands: {
				[op.setup]: async (request) => {
					nothing(request, 'setup');
					return answer(await this.setup());
				},
				[op.enable]: async (request) => {
					nothing(request, 'enable');
					return answer(await this.enable());
				},
				[op.disable]: async (request) => {
					assertServerDesktopAuthority(request.context);
					const parsed = parseServerDesktopDisableRequest(request.envelope.payload);
					if (parsed === null)
						throw protocolError('validation', 'the disable request is invalid');
					return answer(await this.disable(parsed.confirmed));
				},
				[op.open]: async (request) =>
					streamAnswer(await this.open(request.context, generation(request))),
				[op.takeControl]: async (request) =>
					streamAnswer(
						await this.takeControl(request.context, generation(request)),
					),
				[op.releaseControl]: async (request) =>
					streamAnswer(
						await this.releaseControl(request.context, generation(request)),
					),
				[op.write]: async (request) => {
					const stream = this.stream(request);
					if (request.body.length > MAX_CHUNK)
						throw protocolError('resource', 'a desktop input chunk is too large');
					if (stream.writing)
						throw protocolError('conflict', 'a desktop write is already pending');
					stream.writing = true;
					try {
						await new Promise<void>((resolve, reject) =>
							stream.relay.write(request.body, (error?: Error | null) =>
								error
									? reject(protocolError('unavailable', 'the desktop stream closed'))
									: resolve(),
							),
						);
						stream.authority.assert();
						return { result: null };
					} finally {
						stream.writing = false;
					}
				},
				[op.close]: async (request) => {
					this.stream(request).relay.destroy();
					return { result: null };
				},
			},
		};
	}

	/** The status last computed, for the host's own diagnostics. */
	get status(): ServerDesktopStatus | undefined {
		return this.latest;
	}
}
