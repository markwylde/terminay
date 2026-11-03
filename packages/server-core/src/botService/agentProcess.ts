import type {
	BotAgentContribution,
	BotAgentLaunch,
} from '@terminay/extension-api';
import type { JsonValue, BotSessionSnapshot } from '@terminay/protocol';
import {
	BotAcpClient,
	type BotAcpProcess,
	type BotCredentialLease,
} from './acp.js';
import type { EngineDriver } from './engine.js';
import { BotError } from './store.js';

/** Read by the bot image's `terminay-tool-shell`. */
export const CREDENTIAL_VARIABLES = 'TERMINAY_CREDENTIAL_VARIABLES';

export interface BotAgentProcessOptions {
	readonly driver: EngineDriver;
	readonly botId: string;
	readonly sessionId: string;
	readonly snapshot: BotSessionSnapshot;
	readonly agent: BotAgentContribution;
	readonly credential: BotCredentialLease;
	readonly loadId: string | null;
	readonly sessionEnvironment?: Readonly<Record<string, string>>;
	readonly launch: (model: string | null) => Promise<BotAgentLaunch>;
	readonly spawn?: (
		command: readonly string[],
		environment: Readonly<Record<string, string>>,
	) => BotAcpProcess;
	readonly onClient: (client: BotAcpClient) => void;
	readonly released?: () => void;
	readonly mcpServers?: readonly JsonValue[];
	readonly cleanupRuntime?: () => Promise<void>;
}
async function deadline<T>(
	promise: Promise<T>,
	ms: number,
): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<undefined>((resolve) => {
				timer = setTimeout(() => resolve(undefined), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
/** A lease is released only after the root supervisor confirms its group is empty. */
export class BotAgentProcess {
	private clientValue?: BotAcpClient;
	private closing?: Promise<void>;
	private closedProcess: Promise<void> = Promise.resolve();
	private released = false;
	private spawned = false;
	constructor(private readonly options: BotAgentProcessOptions) {}
	get client(): BotAcpClient {
		if (!this.clientValue)
			throw new BotError('unavailable', 'agent is not open');
		return this.clientValue;
	}
	async open(): Promise<BotAcpClient> {
		const o = this.options;
		try {
			let client = await this.connect(null, o.loadId);
			const configurable = await client.open(
				o.loadId,
				o.snapshot.modelId,
				o.mcpServers,
			);
			if (o.snapshot.modelId !== null && !configurable) {
				const load = client.canLoad ? client.session : null;
				await this.endProcess(false);
				client = await this.connect(o.snapshot.modelId, load);
				await client.open(load, o.snapshot.modelId, o.mcpServers);
			}
			return client;
		} catch (error) {
			await this.close('end').catch(() => undefined);
			throw error;
		}
	}
	private async connect(
		model: string | null,
		_load: string | null,
	): Promise<BotAcpClient> {
		const o = this.options;
		const launch = await o.launch(model);
		// Names only, never values: the image's terminay-tool-shell unsets these
		// before an agent's tool command runs.
		const publicEnvironment = {
			...o.agent.launchEnvironment,
			...launch.env,
			...o.sessionEnvironment,
			[CREDENTIAL_VARIABLES]: (o.agent.credentialSecrets ?? [])
				.map((secret) => secret.environmentVariable)
				.join(' '),
		};
		const environment = {
			...publicEnvironment,
			...o.credential.environment,
		};
		const command = [
			'terminay-run',
			o.sessionId,
			'--',
			o.agent.acpCommand.executable,
			...o.agent.acpCommand.args,
			...launch.args,
		];
		const child = o.spawn
			? o.spawn(command, environment)
			: spawnBotAgent(
					o.driver,
					o.botId,
					command,
					o.credential.environment,
					publicEnvironment,
				);
		this.spawned = true;
		this.closedProcess = new Promise((resolve) => {
			child.once('close', () => resolve());
			child.once('error', () => resolve());
		});
		const client = new BotAcpClient(
			child,
			o.credential,
			o.snapshot.approvalMode,
			o.agent.autonomousOnly,
		);
		this.clientValue = client;
		o.onClient(client);
		await client.initialize();
		return client;
	}
	close(
		reason: 'stop' | 'end' | 'suspend' | 'timeout' | 'bot-stop',
	): Promise<void> {
		if (this.closing) return this.closing;
		this.closing = (async () => {
			const client = this.clientValue;
			if (reason === 'timeout') client?.timeout();
			if ((reason === 'stop' || reason === 'timeout') && client)
				await deadline(
					client.cancel().catch(() => undefined),
					10_000,
				);
			await this.endProcess(reason !== 'stop' && reason !== 'timeout');
			await this.options.cleanupRuntime?.();
			if (!this.released) {
				this.released = true;
				this.options.credential.release();
				this.options.released?.();
			}
		})();
		void this.closing.catch(() => {
			this.closing = undefined;
		});
		return this.closing;
	}
	private async endProcess(grace: boolean): Promise<void> {
		if (!this.spawned) return;
		const client = this.clientValue;
		client?.closeInput();
		if (grace) await deadline(this.closedProcess, 5000);
		// --kill implements the start-time/nonce rules, SIGTERM, the 5 s grace,
		// SIGKILL and confirmation. A nonzero exit never releases the lease.
		await this.options.driver.exec(
			`terminay-bot-${this.options.botId}`,
			['terminay-run', '--kill', this.options.sessionId],
			{ user: 'root', deadlineMs: 20_000 },
		);
		client?.dispose();
		this.clientValue = undefined;
		this.spawned = false;
	}
}
/** The pinned socket receives credentials only in the exec request body.
 * Extension launch settings apply only inside the container. */
export function spawnBotAgent(
	driver: EngineDriver,
	botId: string,
	command: readonly string[],
	environment: Readonly<Record<string, string>>,
	containerEnvironment: Readonly<Record<string, string>> = {},
): BotAcpProcess {
	const names = Object.keys(environment);
	if (
		[...names, ...Object.keys(containerEnvironment)].some(
			(name) => !/^(?:[A-Z][A-Z0-9_]*)$/.test(name),
		)
	)
		throw new BotError('validation', 'invalid agent environment');
	if (
		names.some((name) =>
			/^(?:PATH|HOME|SHELL|ENV|BASH_ENV|IFS|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|RUBYOPT|PERL5OPT|LD_.*|DYLD_.*|DOCKER_.*|PODMAN_.*|CONTAINER_.*|TERMINAY_.*)$/.test(
				name,
			),
		)
	)
		throw new BotError(
			'validation',
			'credential variable is reserved for the container runtime',
		);
	return driver.execStream(`terminay-bot-${botId}`, command, {
		user: 'root',
		env: { ...containerEnvironment, ...environment },
		environmentNames: [
			...new Set([...Object.keys(containerEnvironment), ...names]),
		],
	}) as BotAcpProcess;
}
