import {
	type BotAgentContribution,
	type BotAgentResult,
	validateBotAgentLaunchRequest,
} from '@terminay/extension-api';
import { BotAgentRuntimeHost } from '@terminay/extension-api/testing';
import type { HostFrame } from './protocol.js';

/** Description-only IPC. No bot ids, credentials, sessions, or process handles cross it. */
export class BotAgentChild {
	private runtime = new BotAgentRuntimeHost([], false);
	constructor(
		private readonly io: {
			result(id: string, payload?: unknown): void;
			failure(id: string, error: unknown): void;
			disposed(agentId: string): void;
		},
	) {}
	reset(
		declarations: readonly BotAgentContribution[],
		permitted: boolean,
		deadlineMs: number,
	): void {
		this.runtime.deactivate();
		this.runtime = new BotAgentRuntimeHost(declarations, permitted, deadlineMs);
	}
	deactivate(): void {
		this.runtime.deactivate();
	}
	registry(): { registerBotAgent: BotAgentRuntimeHost['registerBotAgent'] } {
		const runtime = this.runtime;
		return Object.freeze({
			registerBotAgent: (agentId, value) => {
				const registration = runtime.registerBotAgent(agentId, value);
				let disposed = false;
				return Object.freeze({
					agentId,
					dispose: () => {
						if (disposed || this.runtime !== runtime) return;
						disposed = true;
						registration.dispose();
						this.io.disposed(agentId);
					},
				});
			},
		});
	}
	ids(): readonly string[] {
		return this.runtime.ids();
	}
	handles(kind: HostFrame['kind']): boolean {
		return kind.startsWith('agent.bot.');
	}
	async receive(frame: HostFrame): Promise<void> {
		try {
			const payload = frame.payload as
				| { agentId?: unknown; request?: unknown }
				| undefined;
			if (typeof payload?.agentId !== 'string')
				throw new Error('invalid bot agent id');
			let result: BotAgentResult<unknown>;
			switch (frame.kind) {
				case 'agent.bot.models':
					result = await this.runtime.models(payload.agentId);
					break;
				case 'agent.bot.status':
					result = await this.runtime.status(payload.agentId);
					break;
				case 'agent.bot.launch': {
					const request = validateBotAgentLaunchRequest(payload.request);
					if (!request.ok) throw new Error('invalid bot agent launch request');
					result = await this.runtime.launch(payload.agentId, request.value);
					break;
				}
				default:
					throw new Error('unknown bot agent request');
			}
			if (!result.available) throw new Error('bot agent unavailable');
			this.io.result(frame.id, result.value);
		} catch {
			this.io.failure(frame.id, new Error('bot agent unavailable'));
		}
	}
}
