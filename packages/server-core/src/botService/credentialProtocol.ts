import type { BotAgentContribution } from '@terminay/extension-api';
import {
	botEnvironmentId,
	type JsonValue,
	BOT_CREDENTIAL_OPERATIONS as op,
} from '@terminay/protocol';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
	RequestContext,
} from '../types.js';
import {
	assertBotStreamAuthority,
	type BotStreamAuthority,
} from './streamAuthority.js';
import { BotError } from './store.js';
import type { BotTokenService } from './tokens.js';
export interface BotCredentialProtocolHooks {
	readonly authority: (context: RequestContext) => BotStreamAuthority;
	readonly agent: (botId: string) => BotAgentContribution;
	readonly tokens: BotTokenService;
	readonly changed?: (botId: string) => void;
	/** Whether the bot's own home holds a device sign-in. */
	readonly deviceSignedIn: (botId: string) => boolean;
	/** Run the agent's sign-out in the container and forget the device sign-in. */
	readonly deviceSignOut: (botId: string) => Promise<void>;
}
/** Secrets are accepted as binary command bodies; responses contain metadata
 * only. Token options and copy destinations are rechecked against manifests. */
export function createBotCredentialOperations(
	hooks: BotCredentialProtocolHooks,
): OperationRegistries {
	const payload = (request: QueryRequest | CommandRequest) => {
		assertBotStreamAuthority(hooks.authority(request.context));
		request.context.signal.throwIfAborted();
		const p = request.envelope.payload;
		if (!p || typeof p !== 'object' || Array.isArray(p))
			throw new TypeError('invalid credential payload');
		botEnvironmentId(p.botId);
		return p;
	};
	const secret = (p: Record<string, JsonValue>) => {
		const agent = hooks.agent(botEnvironmentId(p.botId));
		const found = agent.credentialSecrets?.find(
			(s) => s.environmentVariable === p.variable,
		);
		if (!found) throw new Error('undeclared bot credential');
		return found;
	};
	return {
		policies: Object.fromEntries(
			Object.values(op).map((name) => [name, { scope: 'write' as const }]),
		),
		queries: {
			[op.options]: async (request) => {
				const p = payload(request),
					agent = hooks.agent(botEnvironmentId(p.botId));
				return {
					device: agent.deviceSignIn
						? {
								label: agent.deviceSignIn.label,
								help: agent.deviceSignIn.help,
								signedIn: hooks.deviceSignedIn(p.botId as string),
							}
						: null,
					tokensReadableByTools: true,
					redactionLimits: [
						'device-login',
						'rotated-token',
						'transformed-credential',
					],
					tokens: (agent.credentialSecrets ?? []).map((s) => ({
						variable: s.environmentVariable,
						kind: s.kind,
						label: s.label,
						help: s.help,
						configured: hooks.tokens.configured(
							p.botId as string,
							s.environmentVariable,
						),
					})),
				};
			},
		},
		commands: {
			[op.save]: async (request) => {
				try {
					const p = payload(request),
						s = secret(p);
					await hooks.tokens.save(
						botEnvironmentId(p.botId),
						s.environmentVariable,
						request.body,
					);
					hooks.changed?.(botEnvironmentId(p.botId));
					return { result: null };
				} finally {
					request.body.fill(0);
				}
			},
			[op.copy]: async (request) => {
				const p = payload(request),
					s = secret(p),
					source = botEnvironmentId(p.sourceBotId);
				const sourceAgent = hooks.agent(source);
				if (
					!sourceAgent.credentialSecrets?.some(
						(d) => d.environmentVariable === s.environmentVariable,
					)
				)
					throw new Error('source credential does not match');
				await hooks.tokens.copy(
					source,
					botEnvironmentId(p.botId),
					s.environmentVariable,
				);
				hooks.changed?.(botEnvironmentId(p.botId));
				return { result: null };
			},
			[op.remove]: async (request) => {
				const p = payload(request),
					s = secret(p);
				await hooks.tokens.remove(
					botEnvironmentId(p.botId),
					s.environmentVariable,
				);
				hooks.changed?.(botEnvironmentId(p.botId));
				return { result: null };
			},
			[op.deviceSignOut]: async (request) => {
				const p = payload(request);
				if (!hooks.agent(botEnvironmentId(p.botId)).deviceSignIn)
					throw new BotError('validation', 'this agent has no device sign-in');
				await hooks.deviceSignOut(botEnvironmentId(p.botId));
				hooks.changed?.(botEnvironmentId(p.botId));
				return { result: null };
			},
		},
	};
}
