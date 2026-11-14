import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
	type EngineCallOptions,
	EngineCommandError,
	EngineProcess,
} from './process.js';
import {
	discoverSockets,
	localPodmanConnection,
	unixSocketPath,
} from './socketDiscovery.js';
import { SocketDriver } from './socketDriver.js';
import { type EngineStream, SocketTransport } from './socketTransport.js';

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
	readonly version?: 2;
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
	/** Docker reports AppArmor among its security options (ADR-0119). */
	readonly appArmor?: boolean;
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
	/** The id of storage a removed container left behind under this name. An
	 * engine that keeps no such storage, or cannot tell, answers undefined. */
	leftover?(name: string): Promise<string | undefined>;
	exec(
		container: string,
		command: readonly string[],
		options?: EngineCallOptions & {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: Readonly<Record<string, string | undefined>>;
			readonly environmentNames?: readonly string[];
		},
	): Promise<string>;
	execStream(
		container: string,
		command: readonly string[],
		options?: {
			readonly user?: string;
			readonly tty?: boolean;
			readonly env?: Readonly<Record<string, string | undefined>>;
			readonly environmentNames?: readonly string[];
			readonly signal?: AbortSignal;
		},
	): EngineStream;
	stream(args: readonly string[], options?: EngineCallOptions): EngineStream;
	events(
		onEvent: (event: Record<string, unknown>) => void,
		onEnd: () => void,
	): () => void;
}

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
export class BotEngine extends EventEmitter {
	private driverValue?: SocketDriver;
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
			throw new EngineCommandError(
				this.availability.available ? 'not-running' : this.availability.reason,
				'bot engine unavailable',
			);
		return this.driverValue;
	}
	private async probe(address: string): Promise<{
		details: EngineDetails;
		transport: SocketTransport;
		legacyIdentity?: string;
	}> {
		const transport = new SocketTransport(unixSocketPath(address));
		const version = await transport.negotiate();
		const info = await transport.json<{
			SecurityOptions?: unknown;
			ID?: string;
		}>('GET', '/info');
		const kind: EngineKind = /podman/i.test(
			JSON.stringify([version.Components, version.Platform]),
		)
			? 'podman'
			: 'docker';
		let native:
			| {
					host?: {
						security?: { rootless?: boolean };
						id?: string;
						machineID?: string;
						hostname?: string;
						cgroupVersion?: string;
						cgroupControllers?: string[];
						remoteSocket?: { path?: string };
					};
			  }
			| undefined;
		if (kind === 'podman')
			native = await transport.json('GET', '/v4.0.0/libpod/info');
		const host = native?.host;
		if (kind === 'podman' && typeof host?.security?.rootless !== 'boolean')
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'Podman capability metadata unavailable',
			);
		const rootless =
			kind === 'podman'
				? host?.security?.rootless === true
				: JSON.stringify(info.SecurityOptions ?? []).includes('rootless');
		const appArmor =
			kind === 'docker' &&
			JSON.stringify(info.SecurityOptions ?? []).includes('name=apparmor');
		if (kind === 'docker' && rootless)
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'rootless Docker refused',
			);
		let marker: EngineResource | undefined;
		try {
			marker = await transport.json('GET', `/volumes/${ENGINE_MARKER}`);
		} catch (error) {
			if (!(error instanceof EngineCommandError && error.code === 'not-found'))
				throw error;
		}
		const identity =
			marker?.Labels?.[ENGINE_ID_LABEL] ?? `unselected:${address}`;
		const rawSocket =
			kind === 'docker' ? '/var/run/docker.sock' : host?.remoteSocket?.path;
		const socketPath =
			typeof rawSocket === 'string'
				? rawSocket.replace(/^unix:\/\//, '')
				: this.platform === 'linux'
					? unixSocketPath(address)
					: '';
		if (socketPath && (!socketPath.startsWith('/') || /[,\0]/.test(socketPath)))
			throw new EngineCommandError(
				'unsupported-engine-mode',
				'invalid daemon socket path',
			);
		return {
			transport,
			legacyIdentity:
				kind === 'docker'
					? info.ID
					: (host?.id ?? host?.machineID ?? host?.hostname),
			details: {
				pin: { version: 2, kind, address, connection: false, identity },
				rootless,
				platform: this.platform,
				socketPath,
				limitsEnforced:
					!rootless ||
					(host?.cgroupVersion === 'v2' &&
						['cpu', 'memory', 'pids'].every((c) =>
							host?.cgroupControllers?.includes(c),
						)),
				botUid: this.platform === 'linux' ? botId(process.getuid?.()) : 1000,
				botGid: this.platform === 'linux' ? botId(process.getgid?.()) : 1000,
				...(appArmor ? { appArmor: true } : {}),
			},
		};
	}
	async detect(kind: EngineKind, pin?: EnginePin): Promise<EngineDetails> {
		if (this.platform !== 'linux' && this.platform !== 'darwin')
			throw new EngineCommandError(
				'unsupported-platform',
				'bots require macOS or Linux',
			);
		if (pin) return (await this.probe(pin.address)).details;
		const candidates = await this.discover();
		const found = candidates.find(
			(c) => c.available && c.details.pin.kind === kind,
		);
		if (found?.available) return found.details;
		throw new EngineCommandError(
			candidates.find(
				(
					c,
				): c is {
					available: false;
					reason: EngineUnavailableReason;
					kind: EngineKind;
				} => !c.available,
			)?.reason ?? 'not-installed',
			'engine unavailable',
		);
	}
	async discover(): Promise<
		readonly (EngineAvailability & { kind: EngineKind })[]
	> {
		try {
			const sockets = await discoverSockets(
				this.runner.env,
				this.platform,
				this.runner,
			);
			if (!sockets.length)
				return [{ kind: 'docker', available: false, reason: 'not-installed' }];
			const choices = await Promise.all(
				sockets.map(async ({ address }) => {
					try {
						const { details } = await this.probe(address);
						return {
							kind: details.pin.kind,
							available: true as const,
							details,
						};
					} catch (error) {
						return {
							kind: 'docker' as const,
							available: false as const,
							reason: reason(error),
						};
					}
				}),
			);
			const seen = new Set<string>();
			return choices.filter((choice) => {
				if (!choice.available) return true;
				const key = choice.details.pin.identity;
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		} catch (error) {
			return [{ kind: 'docker', available: false, reason: reason(error) }];
		}
	}
	private async verifiedLegacyPin(
		pin: EnginePin,
	): Promise<EnginePin | undefined> {
		try {
			let address = pin.address,
				machineName: string | undefined;
			if (pin.kind === 'podman' && pin.connection) {
				const connection = await localPodmanConnection(
					pin.address,
					this.runner,
				);
				address = connection.address;
				machineName = connection.machineName;
			} else if (pin.connection) return undefined;
			const { details, legacyIdentity } = await this.probe(address);
			const expected =
				pin.kind === 'docker'
					? legacyIdentity
					: `${pin.address}:${machineName ?? 'host'}:${legacyIdentity}`;
			return details.pin.kind === pin.kind &&
				legacyIdentity &&
				pin.identity === expected
				? details.pin
				: undefined;
		} catch {
			return undefined;
		}
	}
	async check(
		kind?: EngineKind,
		acceptChanged = false,
		selection?: EnginePin,
	): Promise<EngineAvailability> {
		try {
			const pin = await this.store.load();
			if (!pin && !kind)
				throw new EngineCommandError('not-running', 'choose an engine');
			const upgraded =
				pin && pin.version !== 2 && !acceptChanged
					? await this.verifiedLegacyPin(pin)
					: undefined;
			if (pin && pin.version !== 2 && !acceptChanged && !upgraded)
				throw new EngineCommandError(
					'engine-changed',
					'saved engine could not be verified',
				);
			const candidate =
				selection ??
				upgraded ??
				(pin && !acceptChanged ? pin : await this.detect(kind ?? pin!.kind));
			let { details, transport } = await this.probe(
				'pin' in candidate ? candidate.pin.address : candidate.address,
			);
			if (pin && !acceptChanged && !upgraded && !samePin(details.pin, pin))
				throw new EngineCommandError(
					'engine-changed',
					'engine identity changed',
				);
			if (details.pin.identity.startsWith('unselected:')) {
				const identity = randomUUID();
				try {
					await transport.json('POST', '/volumes/create', {
						Name: ENGINE_MARKER,
						Labels: { [ENGINE_ID_LABEL]: identity },
					});
				} catch (error) {
					if (
						!(error instanceof EngineCommandError && error.code === 'conflict')
					)
						throw error;
				}

				({ details, transport } = await this.probe(details.pin.address));
				if (details.pin.identity.startsWith('unselected:'))
					throw new EngineCommandError(
						'not-running',
						'engine identity unavailable',
					);
			}
			if (
				!this.availability.available ||
				!samePin(this.availability.details.pin, details.pin) ||
				!this.driverValue
			) {
				this.close();
				this.driverValue = new SocketDriver(details, transport);
				this.endEvents = this.driverValue.events(
					(event) => this.emit('container-event', event),
					() => {
						this.availability = { available: false, reason: 'not-running' };
						this.emit('availability', this.availability);
					},
				);
			}
			this.driverValue.details = details;
			await this.store.save(details.pin);
			this.availability = { available: true, details };
		} catch (error) {
			this.close();
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
/** How long a `terminay-run --kill` exec may take. A busy Podman machine has
 * taken 45 s just to create and start one, so this is generous. */
export const BOT_KILL_DEADLINE_MS = 5 * 60_000;
export const ENGINE_MARKER = 'terminay-engine-identity';
export const ENGINE_ID_LABEL = 'terminay.engine.identity';
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

export function botId(id: number | undefined): number {
	return id && id > 0 ? id : 1000;
}
