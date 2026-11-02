import { EventEmitter } from 'node:events';
import {
	type BotEngineStatus,
	type JsonValue,
	BOT_ENGINE_OPERATIONS as op,
} from '@terminay/protocol';
import type { OperationRegistries } from '../types.js';
import { assertBotAuthority } from './authority.js';
import {
	BotEngine,
	type EngineDriver,
	type EnginePin,
	type EnginePinStore,
	samePin,
} from './engine.js';
import {
	BOT_IMAGE,
	type BotAgentInstall,
	type BotImagePlan,
	buildBotImage,
	planBotImage,
} from './image.js';

/** Event-driven engine/image owner. Builds are shared by all bots and callers. */
export class BotEngineService extends EventEmitter {
	private candidates: Awaited<ReturnType<BotEngine['discover']>> = [];
	private plan?: BotImagePlan;
	private imageProbeFailed = false;
	private buildTask?: Promise<void>;
	private checkTask?: Promise<void>;
	private image: BotEngineStatus['image'] = {
		state: 'missing',
		fingerprint: null,
		builtAt: null,
		error: null,
	};
	private output = Buffer.alloc(0);
	private revision = 0;
	private signature = '';
	private eventRevision = 0;
	private outputRevision = 0;
	private readonly containerChanged = () => {
		this.eventRevision++;
		this.changed();
	};
	/** Set while a check runs; its intermediate states are never published. */
	private checking = false;
	private currentSignature(): string {
		return JSON.stringify([
			this.engine.availability,
			this.candidates,
			this.image,
			this.outputRevision,
			this.eventRevision,
		]);
	}
	private readonly availabilityChanged = () => {
		if (!this.checking) this.changed();
	};
	private readonly changed = () => {
		const signature = this.currentSignature();
		if (signature === this.signature) return;
		this.signature = signature;
		this.emit('changed', { revision: ++this.revision });
	};
	constructor(
		readonly engine: BotEngine,
		private readonly pins: EnginePinStore,
		private readonly contextPath: string,
		private readonly installs: () => readonly BotAgentInstall[],
		private readonly serverId: string,
	) {
		super();
		engine.on('availability', this.availabilityChanged);
		engine.on('container-event', this.containerChanged);
	}
	get fingerprint(): string {
		return this.plan?.fingerprint ?? '';
	}
	async driver(): Promise<EngineDriver> {
		if (!this.engine.availability.available) await this.check();
		return this.engine.driver;
	}
	/** An explicit check: what it finds is published to every watcher. */
	async check(): Promise<void> {
		await this.probe();
		this.changed();
	}
	/** Checks without publishing. Overlapping calls share one probe, and only
	 * its final state is ever compared or published. */
	private probe(): Promise<void> {
		if (this.checkTask) return this.checkTask;
		this.checking = true;
		this.checkTask = this.checkNow().finally(() => {
			this.checking = false;
			this.checkTask = undefined;
		});
		return this.checkTask;
	}
	private async checkNow(): Promise<void> {
		this.candidates = await this.engine.discover();
		const available = this.candidates.filter((c) => c.available);
		const pin = await this.pins.load();
		const only =
			available.length === 1 && available[0]?.available
				? available[0].details.pin.kind
				: undefined;
		if (pin || only) await this.engine.check(only && !pin ? only : undefined);
		else {
			// Nothing is pinned and there is no single engine to pin: say why,
			// in one state, without asking the engine for a pin it does not have.
			const failure =
				this.candidates.find(
					(c) => !c.available && c.reason !== 'not-installed',
				) ?? this.candidates.find((c) => !c.available);
			this.engine.close();
			this.engine.availability = {
				available: false,
				// Several engines are up: the dashboard asks which one to use.
				reason:
					available.length === 0 && failure && !failure.available
						? failure.reason
						: 'not-running',
			};
		}
		if (this.engine.availability.available)
			await this.refreshImage(this.engine.driver);
	}
	async use(
		kind: unknown,
		address: unknown,
		confirmed: boolean,
	): Promise<void> {
		if (this.buildTask)
			throw new Error('wait for the image build before switching engines');
		this.candidates = await this.engine.discover();
		const candidate = this.candidates.find(
			(c) =>
				c.available &&
				c.details.pin.kind === kind &&
				c.details.pin.address === address,
		);
		if (!candidate?.available)
			throw new Error('engine candidate unavailable; check again');
		const previous = await this.pins.load();
		if (previous && !samePin(previous, candidate.details.pin) && !confirmed)
			throw new Error('changing the engine requires confirmation');
		await this.engine.check(
			candidate.details.pin.kind,
			true,
			candidate.details.pin,
		);
		if (!this.engine.availability.available)
			throw new Error('selected engine unavailable');
		await this.refreshImage(this.engine.driver);
		this.changed();
	}
	private async refreshImage(driver: EngineDriver): Promise<void> {
		let resource: Awaited<ReturnType<EngineDriver['inspect']>>;
		try {
			this.plan = await planBotImage(
				this.contextPath,
				this.installs(),
				driver.details.botUid,
				driver.details.botGid,
			);
			if (this.buildTask) return;
			resource = await driver.inspect('image', BOT_IMAGE);
		} catch {
			this.imageProbeFailed = true;
			this.image = {
				state: 'failed',
				fingerprint: null,
				builtAt: null,
				error:
					'Could not inspect the bot image. Check engine access and try again.',
			};
			return;
		}
		const recoveringProbe = this.imageProbeFailed;
		this.imageProbeFailed = false;
		const fingerprint =
			resource?.Config?.Labels?.['terminay.fingerprint'] ?? null;
		const created = Date.parse(String(resource?.Created ?? ''));
		this.image = {
			state:
				this.image.state === 'failed' && !recoveringProbe
					? 'failed'
					: !resource
						? 'missing'
						: fingerprint === this.plan.fingerprint
							? 'current'
							: 'outdated',
			fingerprint,
			builtAt: Number.isFinite(created) ? created : null,
			error: recoveringProbe ? null : this.image.error,
		};
	}
	async status(): Promise<BotEngineStatus> {
		// Opening the dashboard checks availability, never a timer. The reader
		// gets the result in this reply, so the check publishes nothing: a
		// watcher that rereads status on every change could otherwise never stop.
		await this.probe();
		const pin = await this.pins.load();
		const a = this.engine.availability;
		let runningContainers = 0,
			botContainers = 0;
		if (a.available) {
			const d = this.engine.driver;
			const count = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
			runningContainers = count(await d.run(['container', 'ls', '-q']));
			botContainers = count(
				await d.run([
					'container',
					'ls',
					'-aq',
					'--filter',
					`label=terminay.server=${this.serverId}`,
					'--filter',
					'label=terminay.bot',
					'--filter',
					'label=terminay.managed=1',
					'--filter',
					'label!=terminay.helper',
				]),
			);
		}
		return {
			engine: a.available ? a.details.pin.kind : (pin?.kind ?? null),
			available: a.available,
			reason: a.available ? null : a.reason,
			detail: a.available
				? a.details.limitsEnforced
					? ''
					: 'Engine resource limits are not enforced'
				: !pin && this.candidates.filter((c) => c.available).length > 1
					? 'Choose a local engine'
					: {
							'not-installed': 'Install Docker or Podman on the server',
							'not-running': 'Start the selected container engine',
							'permission-denied':
								'The server account cannot access the container engine',
							'remote-engine': 'Bots require a local engine',
							'unsupported-engine-mode':
								'This engine mode is unsupported; rootless Docker is not supported',
							'unsupported-platform': 'Bots require macOS or Linux',
							'engine-changed':
								'The pinned engine identity changed; choose Use this engine',
						}[a.reason],
			pinned: pin ? { kind: pin.kind, address: pin.address } : null,
			candidates: this.candidates
				.filter(
					(c) =>
						!a.available ||
						!c.available ||
						c.details.pin.identity !== a.details.pin.identity ||
						c.details.pin.address === a.details.pin.address,
				)
				.map((c) => ({
					kind: c.available ? c.details.pin.kind : c.kind,
					address: c.available ? c.details.pin.address : null,
					available: c.available,
					reason: c.available ? null : c.reason,
				})),
			runningContainers,
			botContainers,
			image: { ...this.image },
		};
	}
	build(): Promise<void> {
		if (this.buildTask) return this.buildTask;
		const work = async () => {
			const driver = await this.driver();
			this.plan = await planBotImage(
				this.contextPath,
				this.installs(),
				driver.details.botUid,
				driver.details.botGid,
			);
			const plan = this.plan;
			this.output = Buffer.alloc(0);
			this.image = { ...this.image, state: 'building', error: null };
			this.changed();
			try {
				await buildBotImage(driver, this.contextPath, plan, (chunk) => {
					this.output = Buffer.from(
						Buffer.concat([this.output, Buffer.from(chunk)]).subarray(
							-256 * 1024,
						),
					);
					this.outputRevision++;
					this.changed();
				});
				this.image = {
					state: 'current',
					fingerprint: plan.fingerprint,
					builtAt: Date.now(),
					error: null,
				};
			} catch {
				this.image = {
					...this.image,
					state: 'failed',
					error: 'Image build failed; inspect the build log',
				};
				throw new Error('bot image build failed');
			} finally {
				this.changed();
			}
		};
		this.buildTask = work().finally(() => {
			this.buildTask = undefined;
		});
		return this.buildTask;
	}
	async ensureImage(driver: EngineDriver): Promise<string> {
		await this.refreshImage(driver);
		if (this.image.state !== 'current') await this.build();
		return this.image.fingerprint!;
	}
	operations(): OperationRegistries {
		const authorize = (r: Parameters<typeof assertBotAuthority>[0]) =>
			assertBotAuthority(r);
		return {
			policies: Object.fromEntries(
				Object.values(op).map((name) => [name, { scope: 'write' as const }]),
			),
			queries: {
				[op.status]: async (r) => {
					authorize(r.context);
					const result = await this.status();
					authorize(r.context);
					return result as unknown as JsonValue;
				},
				[op.log]: (r) => {
					authorize(r.context);
					return {
						result: { encoding: 'utf-8', bytes: this.output.length },
						body: new Uint8Array(this.output),
					};
				},
			},
			commands: {
				[op.check]: async (r) => {
					authorize(r.context);
					await this.check();
					return { result: null };
				},
				[op.build]: async (r) => {
					authorize(r.context);
					await this.build();
					return { result: null };
				},
				[op.use]: async (r) => {
					authorize(r.context);
					const p = r.envelope.payload as Record<string, JsonValue>;
					await this.use(p?.kind, p?.address, p?.confirmed === true);
					return { result: null };
				},
			},
		};
	}
	async close(): Promise<void> {
		await this.buildTask?.catch(() => undefined);
		this.engine.off('availability', this.availabilityChanged);
		this.engine.off('container-event', this.containerChanged);
		this.engine.close();
	}
}

export function validateEnginePin(value: unknown): EnginePin {
	const p = value as EnginePin;
	if (
		!p ||
		!['docker', 'podman'].includes(p.kind) ||
		typeof p.address !== 'string' ||
		!p.address ||
		typeof p.identity !== 'string' ||
		!p.identity ||
		typeof p.connection !== 'boolean' ||
		(p.version !== undefined && p.version !== 2) ||
		(p.version === 2 && (!p.address.startsWith('unix:///') || p.connection))
	)
		throw new TypeError('invalid engine pin');
	return {
		kind: p.kind,
		address: p.address,
		identity: p.identity,
		connection: p.connection,
		...(p.version === 2 ? { version: 2 as const } : {}),
	};
}
