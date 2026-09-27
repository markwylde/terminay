import type {
	McpApprovalDetail,
	McpApprovalService,
	McpPermissionGroup,
} from '@terminay/server-core';
import type {
	ControlError,
	ControlOperation,
	ControlRequestContext,
} from './controlEndpoint.js';
import type { ControlPermissionGate } from './dispatcher.js';

type ControlFailure = { readonly ok: false; readonly error: ControlError };

/** What a prompt shows about one request. */
export interface McpApprovalDescription {
	/** Detected agent name, or "An agent". */
	readonly agent: string;
	readonly terminalTitle: string;
	/** Completes "<agent> in <terminal> wants to …". */
	readonly summary: string;
	readonly details: readonly McpApprovalDetail[];
}

export interface McpPermissionGateOptions {
	readonly approvals: Pick<McpApprovalService, 'authorize' | 'effectivePolicy'>;
	/**
	 * Describe a request for its prompt. It may refuse a request that could
	 * never succeed (an invalid automation, say) so nobody is asked to approve
	 * it. Called only when the policy is `ask`.
	 */
	readonly describe: (request: {
		readonly op: ControlOperation;
		readonly group: McpPermissionGroup;
		readonly params: Readonly<Record<string, unknown>>;
		readonly context: ControlRequestContext;
	}) => Promise<McpApprovalDescription | ControlFailure>;
}

/** The server-side permission gate: stored policy, session grants, and
 * inline approvals. It never reads renderer state or caller-supplied claims. */
export function createMcpPermissionGate(
	options: McpPermissionGateOptions,
): ControlPermissionGate {
	return {
		async authorize(request) {
			const { context, group } = request;
			const policy = options.approvals.effectivePolicy(
				group,
				context.terminalSessionId,
			);
			if (policy === 'allow') return undefined;
			let description: McpApprovalDescription | undefined;
			if (policy === 'ask') {
				const described = await options.describe(request);
				if ('ok' in described) return described;
				description = described;
			}
			// The approval's own lifecycle bounds the wait, not the request timer.
			const resume = policy === 'ask' ? context.holdDeadline?.() : undefined;
			try {
				const outcome = await options.approvals.authorize({
					terminalSessionId: context.terminalSessionId,
					projectId: context.projectId,
					operation: request.op,
					group,
					agent: description?.agent ?? 'An agent',
					terminalTitle: description?.terminalTitle ?? 'a terminal',
					summary: description?.summary ?? request.op,
					details: description?.details ?? [],
					signal: context.signal,
				});
				if (outcome.ok) return undefined;
				return {
					ok: false,
					error: { code: outcome.error.code, message: outcome.error.message },
				};
			} finally {
				resume?.();
			}
		},
	};
}
