import { EventEmitter } from 'node:events';
import {
	type EngineCallOptions,
	EngineCommandError,
	EngineProcess,
	type PipedProcess,
} from './process.js';

export type EngineKind = 'docker' | 'podman';
export type EngineUnavailableReason =
	| 'not-installed'
	| 'not-running'
	| 'permission-denied'
	| 'remote-engine'
	| 'unsupported-engine-mode'
	| 'unsupported-platform'
	| 'engine-changed';
export interface EnginePin {
	readonly kind: EngineKind;
	readonly address: string;
	readonly identity: string;
	readonly connection: boolean;
}
/** Field by field: a pin read back from disk need not keep its key order. */
export function samePin(a: EnginePin, b: EnginePin): boolean {
	return (
		a.kind === b.kind &&
		a.address === b.address &&
		a.identity === b.identity &&
		a.connection === b.connection
	);
}
export interface EngineDetails {
	readonly pin: EnginePin;
	readonly rootless: boolean;
	readonly limitsEnforced: boolean;
	readonly socketPath: string;
	readonly socketGid?: number;
	readonly botUid: number;
	readonly botGid: number;
	readonly platform: NodeJS.Platform;
}
export interface EngineResource {
	readonly Id?: string;
	readonly Name?: string;
	readonly Labels?: Record<string, string>;
	/** Podman's `network inspect` uses lowercase keys. */
	readonly labels?: Record<string, string>;
	readonly Config?: {
		readonly Labels?: Record<string, string>;
		readonly Image?: string;
	};
	readonly State?: {
		readonly Running?: boolean;
		readonly Status?: string;
		readonly StartedAt?: string;
	};
	readonly [key: string]: unknown;
}
export interface EngineDriver {
	readonly details: EngineDetails;
	run(args: readonly string[], options?: EngineCallOptions): Promise<string>;
	json<T>(args: readonly string[], options?: EngineCallOptions): Promise<T>;
	inspect(
		kind: 'container' | 'volume' | 'network' | 'image',
		name: string,
	): Promise<EngineResource | undefined>;
	exec(
		container: string,
		command: readonly string[],
		options?: EngineCallOptions & {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: NodeJS.ProcessEnv;
			readonly environmentNames?: readonly string[];
		},
	): Promise<string>;
	execStream(
		container: string,
		command: readonly string[],
		options?: {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: NodeJS.ProcessEnv;
			readonly environmentNames?: readonly string[];
			readonly signal?: AbortSignal;
		},
	): PipedProcess;
	stream(args: readonly string[], options?: EngineCallOptions): PipedProcess;
	events(
		onEvent: (event: Record<string, unknown>) => void,
		onEnd: () => void,
	): () => void;
}

abstract class CliDriver implements EngineDriver {
	constructor(
		readonly details: EngineDetails,
		protected readonly processRunner = new EngineProcess(),
	) {}
	protected get prefix(): string[] {
		return engineAddressArgs(this.details.pin);
	}
	run(args: readonly string[], options?: EngineCallOptions): Promise<string> {
		return this.processRunner.run(
			this.details.pin.kind,
			[...this.prefix, ...args],
			options,
		);
	}
	async json<T>(
		args: readonly string[],
		options?: EngineCallOptions,
	): Promise<T> {
		return JSON.parse(await this.run(args, options)) as T;
	}
	async inspect(
		kind: 'container' | 'volume' | 'network' | 'image',
		name: string,
	): Promise<EngineResource | undefined> {
		try {
			return (await this.json<EngineResource[]>([kind, 'inspect', name]))[0];
		} catch (error) {
			if (error instanceof EngineCommandError && error.code === 'not-found')
				return undefined;
			throw error;
		}
	}
	exec(
		container: string,
		command: readonly string[],
		options: EngineCallOptions & {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: NodeJS.ProcessEnv;
			readonly environmentNames?: readonly string[];
		} = {},
	): Promise<string> {
		return this.run(
			[
				'exec',
				'-i',
				...(options.tty ? ['-t'] : []),
				'-u',
				options.user ?? 'bot',
				'-w',
				'/home/bot',
				...environmentArgs(options.environmentNames),
				container,
				...command,
			],
			options,
		);
	}
	execStream(
		container: string,
		command: readonly string[],
		options: {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: NodeJS.ProcessEnv;
			readonly environmentNames?: readonly string[];
			readonly signal?: AbortSignal;
		} = {},
	): PipedProcess {
		// Session/PTY owners close this event-driven stream; one-shot calls use exec().
		return this.processRunner.stream(
			this.details.pin.kind,
			[
				...this.prefix,
				'exec',
				'-i',
				...(options.tty ? ['-t'] : []),
				'-u',
				options.user ?? 'bot',
				'-w',
				'/home/bot',
				...environmentArgs(options.environmentNames),
				container,
				...command,
			],
			options,
		);
	}
	stream(args: readonly string[], options?: EngineCallOptions): PipedProcess {
		return this.processRunner.stream(
			this.details.pin.kind,
			[...this.prefix, ...args],
			options,
		);
	}
	events(
		onEvent: (event: Record<string, unknown>) => void,
		onEnd: () => void,
	): () => void {
		const child = this.processRunner.stream(this.details.pin.kind, [
			...this.prefix,
			'events',
			'--format',
			'{{json .}}',
		]);
		let pending = '';
		let ended = false;
		const end = () => {
			if (!ended) {
				ended = true;
				onEnd();
			}
		};
		child.stdin.end();
		child.stderr.on('data', () => undefined);
		child.stdout.on('data', (chunk: Buffer | string) => {
			pending += chunk.toString();
			if (pending.length > 1024 * 1024) {
				child.kill('SIGKILL');
				end();
				return;
			}
			let newline = pending.indexOf('\n');
			while (newline >= 0) {
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				try {
					if (line.trim()) onEvent(JSON.parse(line));
				} catch {
					child.kill('SIGKILL');
					end();
					return;
				}
				newline = pending.indexOf('\n');
			}
		});
		child.once('error', end);
		child.once('close', end);
		return () => {
			ended = true;
			child.kill('SIGKILL');
		};
	}
}
export class DockerDriver extends CliDriver {}
export class PodmanDriver extends CliDriver {}

export function ownedResource(
	resource: EngineResource,
	serverId: string,
	botId: string,
): boolean {
	const labels = resource.Config?.Labels ?? resource.Labels ?? resource.labels;
	return (
		labels?.['terminay.server'] === serverId &&
		labels?.['terminay.bot'] === botId &&
		labels?.['terminay.managed'] === '1'
	);
}

export type EngineAvailability =
	| { readonly available: true; readonly details: EngineDetails }
	| { readonly available: false; readonly reason: EngineUnavailableReason };
export interface EnginePinStore {
	load(): Promise<EnginePin | undefined>;
	save(pin: EnginePin): Promise<void>;
}
interface Connection {
	Name: string;
	URI: string;
	Default?: boolean;
}
interface Machine {
	Name: string;
	Running?: boolean;
	SSHConfig?: { Port?: number; RemoteUsername?: string };
}

/** The caller persists pins with the server's durable state backend. No timer probes. */
export class BotEngine extends EventEmitter {
	private driverValue?: EngineDriver;
	private endEvents?: () => void;
	availability: EngineAvailability = {
		available: false,
		reason: 'not-running',
	};
	constructor(
		private readonly store: EnginePinStore,
		private readonly runner = new EngineProcess(),
		private readonly platform = process.platform,
	) {
		super();
	}
	get driver(): EngineDriver {
		if (!this.availability.available || !this.driverValue)
			throw new Error('bot engine unavailable');
		return this.driverValue;
	}
	async detect(kind: EngineKind, pin?: EnginePin): Promise<EngineDetails> {
		if (this.platform !== 'linux' && this.platform !== 'darwin')
			throw new EngineCommandError(
				'unsupported-platform',
				'bots require macOS or Linux',
			);
		if (!pin && kind === 'docker') {
			const version = await this.runner.run('docker', ['--version']);
			if (/podman/i.test(version) || /^docker version /.test(version))
				return this.detect('podman');
		}
		let address = pin?.address;
		let connection = pin?.connection ?? false;
		let machineName: string | undefined;
		if (!address && kind === 'docker') {
			address = this.runner.env.DOCKER_HOST;
			if (!address) {
				const contexts = JSON.parse(
					await this.runner.run('docker', ['context', 'inspect']),
				) as { Endpoints?: { docker?: { Host?: string } } }[];
				address = contexts[0]?.Endpoints?.docker?.Host;
			}
		}
		if (kind === 'podman') {
			const connections = JSON.parse(
				await this.runner.run('podman', [
					'system',
					'connection',
					'list',
					'--format',
					'json',
				]),
			) as Connection[];
			const selected = pin
				? pin.connection
					? connections.find((item) => item.Name === pin.address)
					: undefined
				: this.runner.env.CONTAINER_HOST
					? undefined
					: (connections.find(
							(item) => item.Name === this.runner.env.CONTAINER_CONNECTION,
						) ??
						(!this.runner.env.CONTAINER_HOST
							? connections.find((item) => item.Default)
							: undefined));
			if (selected) {
				address = selected.Name;
				connection = true;
			}
			const uri =
				selected?.URI ??
				(connection ? undefined : (address ?? this.runner.env.CONTAINER_HOST));
			if (uri?.startsWith('ssh://')) {
				const url = new URL(uri);
				const machines = JSON.parse(
					await this.runner.run('podman', [
						'machine',
						'list',
						'--format',
						'json',
					]),
				) as Machine[];
				const machine = machines.find(
					(item) =>
						selected?.Name === item.Name ||
						selected?.Name === `${item.Name}-root`,
				);
				if (
					!machine ||
					!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
				)
					throw new EngineCommandError(
						'remote-engine',
						'remote engine refused',
					);
				const inspected = JSON.parse(
					await this.runner.run('podman', ['machine', 'inspect', machine.Name]),
				) as Machine[];
				if (Number(url.port) !== inspected[0]?.SSHConfig?.Port)
					throw new EngineCommandError(
						'remote-engine',
						'connection does not belong to local machine',
					);
				machineName = machine.Name;
			} else if (uri && !uri.startsWith('unix://'))
				throw new EngineCommandError('remote-engine', 'remote engine refused');
			if (connection && !selected)
				throw new EngineCommandError(
					'not-running',
					'pinned connection missing',
				);
			address ??= uri;
			if (!address && this.platform === 'linux') {
				const uid = process.getuid?.() ?? 0;
				const runtime = this.runner.env.XDG_RUNTIME_DIR;
				if (uid !== 0 && (!runtime?.startsWith('/') || runtime.includes(',')))
					throw new EngineCommandError(
						'not-running',
						'rootless Podman runtime directory missing',
					);
				address =
					uid === 0
						? 'unix:///run/podman/podman.sock'
						: `unix://${runtime}/podman/podman.sock`;
			}
		}
		if (kind === 'docker' && !address?.startsWith('unix://'))
			throw new EngineCommandError(
				'remote-engine',
				'local unix socket required',
			);
		if (!address)
			throw new EngineCommandError('not-running', 'engine address missing');
		if (kind === 'podman' && !connection && this.platform !== 'linux')
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'native Podman URL requires Linux',
			);
		const prefix = engineAddressArgs({ kind, address, connection });
		const info = JSON.parse(
			await this.runner.run(kind, [...prefix, 'info', '--format', 'json']),
		) as Record<string, unknown>;
		if (kind === 'docker' && info.host) return this.detect('podman'); // shim prints "docker version <Podman version>"
		const host = info.host as Record<string, unknown> | undefined;
		const security = host?.security as { rootless?: boolean } | undefined;
		const rootless =
			kind === 'docker'
				? JSON.stringify(info.SecurityOptions ?? []).includes('rootless')
				: security?.rootless === true;
		if (kind === 'docker' && rootless)
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'rootless Docker refused',
			);
		const identity =
			kind === 'docker'
				? info.ID
				: (host?.id ?? host?.machineID ?? host?.hostname);
		if (typeof identity !== 'string' || !identity)
			throw new EngineCommandError('not-running', 'engine identity missing');
		const remoteSocket = host?.remoteSocket as { path?: string } | undefined;
		return {
			pin: {
				kind,
				address,
				connection,
				identity:
					kind === 'docker'
						? identity
						: `${address}:${machineName ?? 'host'}:${identity}`,
			},
			rootless,
			platform: this.platform,
			limitsEnforced:
				kind === 'docker' ||
				!rootless ||
				(host?.cgroupVersion === 'v2' &&
					Array.isArray(host?.cgroupControllers) &&
					['cpu', 'memory', 'pids'].every((c) =>
						(host.cgroupControllers as unknown[]).includes(c),
					)),
			socketPath:
				kind === 'docker'
					? '/var/run/docker.sock'
					: (remoteSocket?.path ??
						(connection
							? '/run/podman/podman.sock'
							: address.slice('unix://'.length))),
			botUid: this.platform === 'linux' ? (process.getuid?.() ?? 1000) : 1000,
			botGid: this.platform === 'linux' ? (process.getgid?.() ?? 1000) : 1000,
		};
	}
	async discover(): Promise<
		readonly (EngineAvailability & { readonly kind: EngineKind })[]
	> {
		const choices = await Promise.all(
			['docker', 'podman'].map(async (kind) => {
				try {
					return {
						kind: kind as EngineKind,
						available: true as const,
						details: await this.detect(kind as EngineKind),
					};
				} catch (error) {
					return {
						kind: kind as EngineKind,
						available: false as const,
						reason: reason(error),
					};
				}
			}),
		);
		return choices.filter(
			(choice, index) =>
				!choice.available ||
				choices.findIndex(
					(other) =>
						other.available &&
						other.details.pin.kind === choice.details.pin.kind,
				) === index,
		);
	}
	async check(
		kind?: EngineKind,
		acceptChanged = false,
		selection?: EnginePin,
	): Promise<EngineAvailability> {
		this.endEvents?.();
		this.endEvents = undefined;
		try {
			const pin = await this.store.load();
			if (!pin && !kind)
				throw new EngineCommandError('not-running', 'choose an engine');
			const details = await this.detect(
				kind ?? pin!.kind,
				selection ??
					(acceptChanged || (kind && kind !== pin?.kind) ? undefined : pin),
			);
			if (pin && !acceptChanged && !samePin(details.pin, pin))
				throw new EngineCommandError(
					'engine-changed',
					'engine identity changed',
				);
			await this.store.save(details.pin);
			this.driverValue =
				details.pin.kind === 'docker'
					? new DockerDriver(details, this.runner)
					: new PodmanDriver(details, this.runner);
			this.availability = { available: true, details };
			this.endEvents = this.driverValue.events(
				(event) => this.emit('container-event', event),
				() => {
					this.availability = { available: false, reason: 'not-running' };
					this.emit('availability', this.availability);
				},
			);
		} catch (error) {
			this.availability = { available: false, reason: reason(error) };
		}
		this.emit('availability', this.availability);
		return this.availability;
	}
	close(): void {
		this.endEvents?.();
		this.endEvents = undefined;
	}
}
function reason(error: unknown): EngineUnavailableReason {
	return error instanceof EngineCommandError &&
		[
			'not-installed',
			'not-running',
			'permission-denied',
			'remote-engine',
			'unsupported-engine-mode',
			'unsupported-platform',
			'engine-changed',
		].includes(error.code)
		? (error.code as EngineUnavailableReason)
		: 'not-running';
}

/** Reused by the PTY host. Every engine call addresses its pin explicitly. */
export function engineAddressArgs(
	pin: Pick<EnginePin, 'kind' | 'address' | 'connection'>,
): string[] {
	return [
		pin.kind === 'docker'
			? '--host'
			: pin.connection
				? '--connection'
				: '--url',
		pin.address,
	];
}
function environmentArgs(names: readonly string[] = []): string[] {
	if (names.some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name)))
		throw new TypeError('invalid exec environment variable');
	return names.flatMap((name) => ['-e', name]);
}
