import { EventEmitter } from 'node:events';
import {
	type BotContainerAction,
	type BotEnvironmentOverview,
	type BotEnvironmentSetSettings,
	type BotEnvironmentSettings,
	type BotEnvironmentState,
	type BotResourceLimits,
	type BotSiblingContainer,
	botEnvironmentId,
	botResourceLimits,
	DEFAULT_BOT_IDLE_STOP_MS,
	DEFAULT_BOT_RESOURCE_LIMITS,
	parseBotEnvironmentSetSettings,
	protocolError,
} from '@terminay/protocol';
import { BOT_BROWSER_SECURITY_OPT } from './browserSandbox.js';
import type { BotEngine, EngineDriver, EngineResource } from './engine.js';
import { ownedResource } from './engine.js';
import {
	type BotActivity,
	type BotDeadlineClock,
	BotIdleDeadline,
} from './idle.js';
import { BOT_IMAGE } from './image.js';
import { BotLogTail } from './log.js';
import { BotImageBuildError, type BotStore } from './store.js';
import type { BotTokenLease } from './tokens.js';

export interface BotConfigFile {
	readonly path: string;
	readonly content: string;
}
export interface BotEnvironmentDefinition {
	readonly id: string;
	readonly limits?: BotResourceLimits;
	readonly idleStopMs?: number | null;
	readonly configFiles?: readonly BotConfigFile[];
}
export interface BotEnvironmentHooks {
	/** These callbacks are server-owned, never extension or renderer callbacks. */
	readonly engine: () => Promise<EngineDriver>;
	readonly settings?: Pick<
		BotStore,
		'environmentSettings' | 'setEnvironmentSettings'
	>;
	readonly ensureImage: (
		driver: EngineDriver,
		progress: (chunk: string) => void,
	) => Promise<string>;
	readonly currentFingerprint: () => string;
	readonly closeHelper: (botId: string) => Promise<void>;
	readonly stopSessions: (botId: string) => Promise<void>;
	/** Vault-backed bootstrap delivered on stdin. */
	readonly bootstrap: (botId: string) => Promise<{
		readonly vncPassword: string;
	}>;
	/** Resolve the engine-side gid (including inside a Podman machine). */
	readonly socketGid?: (driver: EngineDriver) => Promise<number>;
	readonly secrets: (botId: string) => Promise<readonly string[]>;
	readonly logTokens?: (botId: string) => Promise<BotTokenLease>;
	readonly now?: () => number;
	readonly timers?: BotDeadlineClock;
}
const defaults = DEFAULT_BOT_RESOURCE_LIMITS;
const noActivity: BotActivity = {
	runningSessions: 0,
	queuedSessions: 0,
	shells: 0,
	desktops: 0,
};
const nameFor = (id: string) => `terminay-bot-${botEnvironmentId(id)}`;

/** Bot definitions can be registered while the engine is absent. Resources are
 * touched only on demand. Per-bot queues serialize lifecycle and event repair. */
export class BotEnvironmentService extends EventEmitter {
	private closed = false;
	private readonly bots = new Map<string, BotEnvironmentDefinition>();
	private readonly states = new Map<string, BotEnvironmentState>();
	private readonly queues = new Map<string, Promise<unknown>>();
	private readonly deadlines = new Map<string, BotIdleDeadline>();
	private readonly activity = new Map<string, BotActivity>();
	constructor(
		readonly serverId: string,
		private readonly hooks: BotEnvironmentHooks,
	) {
		super();
	}
	register(bot: BotEnvironmentDefinition): void {
		botEnvironmentId(bot.id);
		botResourceLimits(bot.limits ?? defaults);
		if (
			bot.idleStopMs !== undefined &&
			bot.idleStopMs !== null &&
			(!Number.isSafeInteger(bot.idleStopMs) || bot.idleStopMs <= 0)
		)
			throw new TypeError('invalid idle stop');
		validateConfigFiles(bot.configFiles ?? []);
		this.bots.set(bot.id, structuredClone(bot));
		if (!this.states.has(bot.id)) this.states.set(bot.id, 'not-created');
		this.armIdle(bot.id);
	}
	definition(id: string): BotEnvironmentDefinition {
		const bot = this.bots.get(botEnvironmentId(id));
		if (!bot) throw new Error('bot not found');
		return structuredClone({
			...bot,
			...this.hooks.settings?.environmentSettings(id),
		});
	}
	async settings(id: string): Promise<BotEnvironmentSettings> {
		return this.readSettings(id, await this.hooks.engine());
	}
	private readSettings(
		id: string,
		driver: EngineDriver,
	): BotEnvironmentSettings {
		const bot = this.definition(id);
		return {
			botId: id,
			idleStopMs:
				bot.idleStopMs === undefined
					? DEFAULT_BOT_IDLE_STOP_MS
					: bot.idleStopMs,
			limits: bot.limits ?? defaults,
			revision: this.hooks.settings?.environmentSettings(id).revision ?? 0,
			limitsEnforced: driver.details.limitsEnforced,
		};
	}
	setSettings(
		input: BotEnvironmentSetSettings,
	): Promise<BotEnvironmentSettings> {
		return this.enqueue(input.botId, async () => {
			const patch = parseBotEnvironmentSetSettings(input);
			if (!this.hooks.settings)
				throw new Error('bot settings store unavailable');
			const driver = await this.hooks.engine();
			const previous = this.hooks.settings.environmentSettings(patch.botId);
			if (
				patch.expectedRevision !== undefined &&
				patch.expectedRevision !== previous.revision
			)
				throw protocolError('conflict', 'bot environment revision changed', {
					details: { reason: 'conflict' },
				});
			this.hooks.settings.setEnvironmentSettings(patch);
			this.armIdle(patch.botId);
			return this.readSettings(patch.botId, driver);
		});
	}
	state(id: string): BotEnvironmentState {
		this.definition(id);
		return this.states.get(id) ?? 'not-created';
	}
	private setState(id: string, state: BotEnvironmentState): void {
		if (this.closed || !this.bots.has(id) || this.states.get(id) === state)
			return;
		this.states.set(id, state);
		this.armIdle(id);
		this.emit('changed', { botId: id });
	}
	private enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
		this.definition(id);
		const result = (this.queues.get(id) ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => {
				if (this.closed) throw new Error('bot environments closed');
				this.definition(id);
				return work();
			});
		this.queues.set(id, result);
		void result
			.finally(() => {
				if (this.queues.get(id) === result) this.queues.delete(id);
			})
			.catch(() => undefined);
		return result;
	}
	private labels(id: string): string[] {
		return [
			'--label',
			'terminay.managed=1',
			'--label',
			`terminay.server=${this.serverId}`,
			'--label',
			`terminay.bot=${id}`,
		];
	}
	private async owned(
		driver: EngineDriver,
		kind: 'container' | 'volume' | 'network',
		name: string,
		id: string,
	): Promise<EngineResource | undefined> {
		const resource = await driver.inspect(kind, name);
		if (resource && !ownedResource(resource, this.serverId, id))
			throw new Error('bot resource name belongs to another owner');
		return resource;
	}
	private async removeResources(
		driver: EngineDriver,
		id: string,
		deleteHome: boolean,
	): Promise<void> {
		await this.hooks.closeHelper(id);
		const name = nameFor(id);
		if (await this.owned(driver, 'container', name, id))
			await driver.run(['container', 'rm', '-f', name]);
		if (await this.owned(driver, 'network', name, id))
			await driver.run(['network', 'rm', name]);
		if (deleteHome && (await this.owned(driver, 'volume', `${name}-home`, id)))
			await driver.run(['volume', 'rm', `${name}-home`]);
	}
	private async create(
		driver: EngineDriver,
		bot: BotEnvironmentDefinition,
		fingerprint: string,
	): Promise<void> {
		const name = nameFor(bot.id);
		if (!(await this.owned(driver, 'volume', `${name}-home`, bot.id)))
			await driver.run([
				'volume',
				'create',
				...this.labels(bot.id),
				`${name}-home`,
			]);
		if (!(await this.owned(driver, 'network', name, bot.id)))
			await driver.run(['network', 'create', ...this.labels(bot.id), name]);
		const limits = botResourceLimits(bot.limits ?? defaults);
		const args = [
			'container',
			'create',
			'--name',
			name,
			...this.labels(bot.id),
			'--label',
			`terminay.fingerprint=${fingerprint}`,
			'--label',
			'terminay.socket=proxy',
			'--label',
			`terminay.limits=${JSON.stringify(limits)}`,
			'--mount',
			`type=volume,source=${name}-home,target=/home/bot`,
			'--network',
			name,
			'--cpus',
			String(limits.cpus),
			'--memory',
			String(limits.memoryBytes),
			'--pids-limit',
			String(limits.pids),
			'--env',
			`TERMINAY_BOT_ID=${bot.id}`,
			'--env',
			'DOCKER_HOST=unix:///var/run/docker.sock',
			'--env',
			'CONTAINER_HOST=unix:///var/run/docker.sock',
			'--entrypoint',
			'terminay-init',
		];
		// Docker blocks Chromium's namespace sandbox by default. Podman's API
		// accepts daemon paths rather than inline profiles; keep its native policy.
		if (driver.details.pin.kind === 'docker')
			args.push('--security-opt', BOT_BROWSER_SECURITY_OPT);
		if (driver.details.platform === 'linux')
			args.push('--add-host', 'host.docker.internal:host-gateway');
		if (driver.details.pin.kind === 'podman' && driver.details.rootless)
			args.push(
				'--userns',
				`keep-id:uid=${driver.details.botUid},gid=${driver.details.botGid}`,
			);
		{
			if (!driver.details.socketPath.startsWith('/'))
				throw new Error(
					'The engine did not report a socket that can be shared',
				);
			if (driver.details.pin.kind === 'podman')
				args.push('--security-opt', 'label=disable');
			const gid = this.hooks.socketGid
				? await this.hooks.socketGid(driver)
				: await this.socketGid(driver, bot.id);
			if (!Number.isSafeInteger(gid) || gid < 0)
				throw new Error('invalid engine socket gid');
			args.push(
				'--mount',
				`type=bind,source=${driver.details.socketPath},target=/run/terminay-engine/engine.sock`,
				'--group-add',
				String(gid),
			);
		}
		args.push(BOT_IMAGE);
		await driver.run(args);
	}
	private async socketGid(driver: EngineDriver, id: string): Promise<number> {
		// Inspect the daemon-side inode in the same uid namespace as the bot.
		// Host stat() would inspect the wrong socket on Docker Desktop/Podman
		// machine. The existing local image supplies stat; nothing is pulled.
		const args = [
			'run',
			'--rm',
			'--pull',
			'never',
			'--network',
			'none',
			...this.labels(id),
			'--label',
			'terminay.helper=socket-stat',
			'--cpus',
			'0.25',
			'--memory',
			'134217728',
			'--pids-limit',
			'16',
			'--user',
			'root',
			'--mount',
			`type=bind,source=${driver.details.socketPath},target=/run/engine.sock,readonly`,
			'--entrypoint',
			'stat',
		];
		if (driver.details.pin.kind === 'podman' && driver.details.rootless)
			args.push(
				'--userns',
				`keep-id:uid=${driver.details.botUid},gid=${driver.details.botGid}`,
			);
		if (driver.details.pin.kind === 'podman')
			args.push('--security-opt', 'label=disable');
		args.push(BOT_IMAGE, '-c', '%g', '/run/engine.sock');
		const value = (await driver.run(args)).trim();
		if (!/^\d+$/.test(value)) throw new Error('engine socket gid unavailable');
		return Number(value);
	}
	start(id: string): Promise<void> {
		return this.enqueue(id, () => this.startNow(id));
	}
	private async startNow(id: string): Promise<void> {
		try {
			const driver = await this.hooks.engine();
			const bot = this.definition(id);
			const name = nameFor(id);
			let container = await this.owned(driver, 'container', name, id);
			if (
				container &&
				!container.State?.Running &&
				!(await this.owned(driver, 'volume', `${name}-home`, id))
			) {
				// Recreate before start so an engine cannot implicitly make an
				// unlabelled replacement volume for a stale container mount.
				await this.removeResources(driver, id, false);
				container = undefined;
			}
			if (container?.State?.Running) {
				this.setState(id, 'running');
				return;
			}
			this.setState(id, 'building');
			const fingerprint = await this.hooks
				.ensureImage(driver, () => this.emit('changed', { botId: id }))
				.catch(() => {
					throw new BotImageBuildError();
				});
			if (
				container &&
				container.Config?.Labels?.['terminay.fingerprint'] !== fingerprint
			) {
				await this.removeResources(driver, id, false);
				container = undefined;
			}
			this.setState(id, 'starting');
			if (!container) await this.create(driver, bot, fingerprint);
			await driver.run(['container', 'start', name]);
			try {
				const bootstrap = await this.hooks.bootstrap(id);
				await driver.exec(name, ['terminay-init', '--bootstrap'], {
					user: 'root',
					input: JSON.stringify({
						...bootstrap,
						botId: id,
						serverId: this.serverId,
					}),
					deadlineMs: 40_000,
				});
				await this.restoreConfig(driver, bot);
			} catch (error) {
				await driver.run(['container', 'stop', name]);
				throw error;
			}
			this.setState(id, 'running');
		} catch (error) {
			this.setState(id, 'failed');
			throw error;
		}
	}
	stop(id: string): Promise<void> {
		return this.enqueue(id, () => this.stopNow(id));
	}
	private async stopNow(id: string): Promise<void> {
		try {
			const driver = await this.hooks.engine();
			const container = await this.owned(driver, 'container', nameFor(id), id);
			if (!container) {
				this.setState(id, 'not-created');
				return;
			}
			this.setState(id, 'stopping');
			await this.hooks.stopSessions(id);
			await driver.run(['container', 'stop', nameFor(id)]);
			this.setState(id, 'stopped');
		} catch (error) {
			this.setState(id, 'failed');
			throw error;
		}
	}
	restart(id: string): Promise<void> {
		return this.enqueue(id, async () => {
			await this.stopNow(id);
			await this.startNow(id);
		});
	}
	recreate(id: string, confirmed = false): Promise<void> {
		if ((this.activity.get(id)?.runningSessions ?? 0) > 0 && !confirmed)
			return Promise.reject(
				new Error('recreating an active session needs confirmation'),
			);
		return this.enqueue(id, async () => {
			try {
				const driver = await this.hooks.engine();
				await this.hooks.stopSessions(id);
				await this.removeResources(driver, id, false);
				this.setState(id, 'not-created');
				await this.startNow(id);
			} catch (error) {
				this.setState(id, 'failed');
				throw error;
			}
		});
	}
	remove(id: string, deleteHome: boolean): Promise<void> {
		return this.enqueue(id, async () => {
			const driver = await this.hooks.engine();
			await this.hooks.stopSessions(id);
			await this.removeResources(driver, id, deleteHome);
			this.setState(id, 'not-created');
			this.forget(id);
		});
	}
	/** Local registration can be removed even when the engine is unreachable. */
	forget(id: string): void {
		this.deadlines.get(id)?.close();
		this.deadlines.delete(id);
		this.bots.delete(id);
		this.activity.delete(id);
		this.states.delete(id);
	}
	async cleanupDeleted(
		driver: EngineDriver,
		id: string,
		deleteHome: boolean,
	): Promise<void> {
		await this.removeResources(driver, id, deleteHome);
	}

	/** Called after acquiring the turn lease: the container runs and the agent's
	 * own config files are in place. */
	prepareSession(id: string): Promise<Readonly<Record<string, string>>> {
		return this.enqueue(id, async () => {
			await this.startNow(id);
			const driver = await this.hooks.engine();
			await this.restoreConfig(driver, this.definition(id));
			return {};
		});
	}
	private async restoreConfig(
		driver: EngineDriver,
		bot: BotEnvironmentDefinition,
	): Promise<void> {
		if (!bot.configFiles?.length) return;
		await driver.exec(nameFor(bot.id), ['terminay-init', '--config'], {
			user: 'root',
			input: JSON.stringify(bot.configFiles),
		});
	}
	reconcile(id: string): Promise<void> {
		return this.enqueue(id, async () => {
			const driver = await this.hooks.engine();
			const container = await driver.inspect('container', nameFor(id));
			if (!container || !ownedResource(container, this.serverId, id))
				this.setState(id, 'not-created');
			else
				this.setState(
					id,
					container.State?.Running
						? 'running'
						: container.State?.Status === 'exited' &&
								Number(
									(container.State as Record<string, unknown>).ExitCode,
								) !== 0
							? 'failed'
							: 'stopped',
				);
		});
	}
	async reconcileAll(): Promise<void> {
		await Promise.all([...this.bots.keys()].map((id) => this.reconcile(id)));
	}
	follow(engine: BotEngine): () => void {
		let disposed = false;
		const pending = new Map<string, { again: boolean }>();
		const reconcile = (event: Record<string, unknown>) => {
			if (disposed) return;
			const actor = event.Actor as
				| { Attributes?: Record<string, string> }
				| undefined;
			const attributes =
				actor?.Attributes ??
				(event.Attributes as Record<string, string> | undefined);
			const name = String(
				attributes?.name ?? event.Name ?? event.name ?? '',
			).replace(/^\//, '');
			const id = name.startsWith('terminay-bot-')
				? name.slice('terminay-bot-'.length)
				: '';
			if (!this.bots.has(id) || name !== nameFor(id)) return;
			if (
				attributes &&
				((attributes['terminay.server'] !== undefined &&
					attributes['terminay.server'] !== this.serverId) ||
					(attributes['terminay.bot'] !== undefined &&
						attributes['terminay.bot'] !== id) ||
					attributes['terminay.role'] === 'helper' ||
					attributes['terminay.workload'] === '1')
			)
				return;
			const existing = pending.get(id);
			if (existing) {
				existing.again = true;
				return;
			}
			const state = { again: false };
			pending.set(id, state);
			void (async () => {
				try {
					do {
						state.again = false;
						if (disposed || !this.bots.has(id)) return;
						await this.reconcile(id);
					} while (state.again && !disposed);
				} catch {
					/* Availability is reported by the engine. */
				} finally {
					pending.delete(id);
				}
			})();
		};
		const unavailable = () => {
			if (engine.availability.available)
				void this.reconcileAll().catch(() => undefined);
			else
				for (const id of this.bots.keys()) {
					this.setState(id, 'failed');
					void this.hooks.stopSessions(id).catch(() => undefined);
				}
		};
		engine.on('container-event', reconcile);
		engine.on('availability', unavailable);
		return () => {
			disposed = true;
			engine.off('container-event', reconcile);
			engine.off('availability', unavailable);
		};
	}
	setActivity(id: string, activity: BotActivity): void {
		this.definition(id);
		if (
			!Object.values(activity).every((v) => Number.isSafeInteger(v) && v >= 0)
		)
			throw new TypeError('invalid bot activity');
		this.activity.set(id, { ...activity });
		this.armIdle(id);
	}
	private armIdle(id: string): void {
		if (this.closed || !this.bots.has(id)) return;
		const bot = this.definition(id);
		let deadline = this.deadlines.get(id);
		if (!deadline) {
			deadline = new BotIdleDeadline(() => {
				void this.enqueue(id, async () => {
					if (
						this.state(id) === 'running' &&
						Object.values(this.activity.get(id) ?? noActivity).every(
							(count) => count === 0,
						)
					)
						await this.stopNow(id);
				}).catch(() => undefined);
			}, this.hooks.timers);
			this.deadlines.set(id, deadline);
		}
		deadline.update(
			this.states.get(id) === 'running',
			this.activity.get(id) ?? noActivity,
			bot.idleStopMs === undefined ? DEFAULT_BOT_IDLE_STOP_MS : bot.idleStopMs,
		);
	}
	async overview(id: string): Promise<BotEnvironmentOverview> {
		const bot = this.definition(id);
		const driver = await this.hooks.engine();
		const name = nameFor(id);
		const container = await driver.inspect('container', name);
		const owned =
			container && ownedResource(container, this.serverId, id)
				? container
				: undefined;
		let cpuPercent: number | null = null;
		let memoryBytes: number | null = null;
		// Usage figures are best-effort: a failed read leaves them blank rather
		// than failing the whole overview.
		if (owned?.State?.Running)
			try {
				const raw = await driver.run([
					'stats',
					'--no-stream',
					'--format',
					'json',
					name,
				]);
				const parsed = JSON.parse(raw) as
					| Record<string, unknown>
					| Record<string, unknown>[];
				const usage = Array.isArray(parsed) ? parsed[0] : parsed;
				cpuPercent = parsePercent(
					usage?.CPUPerc ?? usage?.cpu_percent ?? usage?.CPU,
				);
				memoryBytes = parseMemory(
					String(
						usage?.MemUsage ?? usage?.mem_usage ?? usage?.MemUsageBytes ?? '',
					).split('/')[0] ?? '',
				);
			} catch {
				// Left blank.
			}
		let homeBytes: number | null = null;
		// Read on demand: the Overview asks only when it opens and on Refresh.
		if (await this.owned(driver, 'volume', `${name}-home`, id))
			try {
				const size = await driver.run([
					'run',
					'--rm',
					'--pull',
					'never',
					'--network',
					'none',
					...this.labels(id),
					'--label',
					'terminay.role=helper',
					'--cpus',
					'0.25',
					'--memory',
					'134217728',
					'--pids-limit',
					'64',
					'--user',
					'bot',
					'--mount',
					`type=volume,source=${name}-home,target=/home/bot,readonly`,
					'--entrypoint',
					'du',
					BOT_IMAGE,
					'-sk',
					'/home/bot',
				]);
				const kib = Number(size.trim().split(/\s+/)[0]);
				if (Number.isFinite(kib) && kib >= 0) homeBytes = kib * 1024;
			} catch {
				// Left blank.
			}
		const log = owned
			? await this.readLogs(driver, name, id).catch(() => '')
			: '';
		const started = Date.parse(owned?.State?.StartedAt ?? '');
		const now = this.hooks.now?.() ?? Date.now();
		return {
			botId: id,
			state: owned
				? owned.State?.Running
					? 'running'
					: owned.State?.Status === 'exited' &&
							Number((owned.State as Record<string, unknown>).ExitCode) !== 0
						? 'failed'
						: 'stopped'
				: 'not-created',
			uptimeMs:
				owned?.State?.Running && Number.isFinite(started)
					? Math.max(0, now - started)
					: 0,
			image: BOT_IMAGE,
			fingerprint: this.hooks.currentFingerprint(),
			current:
				owned?.Config?.Labels?.['terminay.fingerprint'] ===
				this.hooks.currentFingerprint(),
			homeVolume: `${name}-home`,
			limits: bot.limits ?? defaults,
			limitsEnforced: driver.details.limitsEnforced,
			engineSocket: !owned
				? 'not-created'
				: owned.Config?.Labels?.['terminay.socket'] === 'proxy'
					? 'proxy'
					: 'recreate-required',
			limitsChangePending:
				Boolean(owned) &&
				(owned?.Config?.Labels?.['terminay.limits'] ??
					JSON.stringify(defaults)) !==
					JSON.stringify(botResourceLimits(bot.limits ?? defaults)),
			cpuPercent,
			memoryBytes,
			homeBytes,
			sampledAt: now,
			log,
		};
	}
	private async readLogs(
		driver: EngineDriver,
		container: string,
		botId: string,
	): Promise<string> {
		const lease = await this.hooks.logTokens?.(botId);
		const tail = new BotLogTail(
			lease ? () => lease.redactor() : await this.hooks.secrets(botId),
		);
		try {
			await driver.run(['logs', container], {
				onOutput: (chunk, source) => tail.push(chunk, source),
				tail: true,
				maxBytes: 256 * 1024,
			});
			return tail.finish();
		} finally {
			tail.close();
			lease?.release();
		}
	}
	async containers(id: string): Promise<readonly BotSiblingContainer[]> {
		this.definition(id);
		const driver = await this.hooks.engine();
		const ids = await driver.run([
			'container',
			'ls',
			'-aq',
			'--filter',
			`label=terminay.bot=${id}`,
		]);
		const containers: BotSiblingContainer[] = [];
		for (const containerId of ids.trim().split(/\s+/).filter(Boolean)) {
			const container = await driver.inspect('container', containerId);
			const labels = container?.Config?.Labels;
			if (
				!container ||
				container.Name?.replace(/^\//, '') === nameFor(id) ||
				labels?.['terminay.bot'] !== id ||
				(labels['terminay.workload'] !== '1' &&
					(labels['terminay.managed'] === '1' ||
						labels['terminay.helper'] !== undefined))
			)
				continue;
			containers.push({
				id: container.Id ?? containerId,
				name: container.Name?.replace(/^\//, '') ?? containerId,
				image: container.Config?.Image ?? '',
				state: container.State?.Status ?? 'unknown',
				ports: JSON.stringify(
					(container.NetworkSettings as { Ports?: unknown } | undefined)
						?.Ports ?? {},
				),
				createdAt: String(container.Created ?? ''),
			});
		}
		return containers;
	}
	async containerAction(
		id: string,
		containerId: string,
		action: BotContainerAction,
		confirmed = false,
	): Promise<string | null> {
		if (!/^[a-f0-9]{12,64}$/.test(containerId))
			throw new TypeError('invalid container id');
		if (!['start', 'stop', 'restart', 'logs', 'remove'].includes(action))
			throw new TypeError('invalid container action');
		if (action === 'remove' && !confirmed)
			throw new Error('container removal needs confirmation');
		if (
			!(await this.containers(id)).some(
				(container) => container.id === containerId,
			)
		)
			throw new Error('container does not belong to bot');
		const driver = await this.hooks.engine();
		if (action === 'logs') return this.readLogs(driver, containerId, id);
		await driver.run([
			'container',
			action === 'remove' ? 'rm' : action,
			...(action === 'remove' ? ['-f'] : []),
			containerId,
		]);
		return null;
	}
	close(): void {
		this.closed = true;
		for (const timer of this.deadlines.values()) timer.close();
		this.deadlines.clear();
	}
}
function parsePercent(value: unknown): number | null {
	const result = Number.parseFloat(String(value ?? ''));
	return Number.isFinite(result) && result >= 0 ? result : null;
}
function parseMemory(value: string): number | null {
	const match = /^\s*([\d.]+)\s*(B|KiB|MiB|GiB|kB|MB|GB)?\s*$/.exec(value);
	if (!match) return null;
	const scales: Record<string, number> = {
		B: 1,
		KiB: 1024,
		MiB: 1024 ** 2,
		GiB: 1024 ** 3,
		kB: 1000,
		MB: 1e6,
		GB: 1e9,
	};
	return Number(match[1]) * (scales[match[2] ?? 'B'] ?? 1);
}
function validateConfigFiles(files: readonly BotConfigFile[]): void {
	if (Buffer.byteLength(JSON.stringify(files)) > 64 * 1024 || files.length > 32)
		throw new TypeError('too many bot config files');
	for (const file of files)
		if (
			!file.path ||
			file.path.startsWith('/') ||
			file.path
				.split('/')
				.some((part) =>
					['..', '.', '', 'memories', '.terminay'].includes(part),
				) ||
			[...file.path].some((character) => character.charCodeAt(0) < 32) ||
			Buffer.byteLength(file.content) > 64 * 1024
		)
			throw new TypeError('invalid bot config file');
}
