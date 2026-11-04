import type { JsonValue } from '@terminay/protocol';
import {
	type SessionWorkflowView,
	WORKFLOW_OPERATIONS,
	type Workflow,
} from '@terminay/server-core';
import { serverControlError } from './appControlAdapter.js';
import {
	ControlEndpointError,
	type ControlRequestContext,
} from './controlEndpoint.js';
import type { WorkflowControlAdapter } from './workflowTools.js';

/**
 * Binds the workflow tools (ADR-0097) to the server's workflow service, run
 * as the MCP principal. A named terminal is resolved against the caller's
 * reach before anything is read, so a workflow outside reach is reported
 * exactly as a terminal that does not exist (ADR-0072, ADR-0074).
 */

/** The exact terminal a workflow operation names. */
export interface WorkflowControlTarget {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
}

export interface WorkflowControlAdapterOptions {
	readonly query: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	readonly command: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	/**
	 * A terminal the caller can address. Throws `terminal_not_found` for one
	 * outside the caller's reach.
	 */
	readonly resolveTerminal: (
		context: ControlRequestContext,
		reference: string,
	) => WorkflowControlTarget;
}

export function createWorkflowControlAdapter(
	options: WorkflowControlAdapterOptions,
): WorkflowControlAdapter {
	const run = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			throw serverControlError(error);
		}
	};
	/** The named terminal, or the calling one; a chat has none to default to. */
	const target = (
		context: ControlRequestContext,
		reference: string | undefined,
	): WorkflowControlTarget => {
		if (reference === undefined && context.chat !== undefined)
			throw new ControlEndpointError(
				'bad_request',
				'A chat has no terminal of its own: name one with terminal, from list_terminals.',
			);
		return options.resolveTerminal(
			context,
			reference ?? context.terminalSessionId,
		);
	};

	return {
		getWorkflow: async (params, context, signal) => {
			const where = target(context, params.terminal);
			const view = (await run(() =>
				options.query(
					WORKFLOW_OPERATIONS.get,
					{ terminalSessionId: where.sessionId },
					signal,
				),
			)) as SessionWorkflowView | { state: 'none' };
			return describe(where.sessionId, view);
		},
		createWorkflow: async (params, context, signal) => {
			const where = target(context, params.terminal);
			const view = (await run(() =>
				options.command(
					WORKFLOW_OPERATIONS.create,
					{
						target: { ...where },
						workflow: {
							name: params.name,
							openingPrompt: params.openingPrompt,
							steps: params.steps.map((step) => ({ ...step })),
						},
						...(params.replaceWorkflowId === undefined
							? {}
							: { replaceWorkflowId: params.replaceWorkflowId }),
					} as JsonValue,
					signal,
				),
			)) as SessionWorkflowView;
			return describe(where.sessionId, view);
		},
		updateWorkflowStep: async (params, context, signal) => {
			const where = target(context, params.terminal);
			const view = (await run(() =>
				options.command(
					WORKFLOW_OPERATIONS.updateStep,
					{
						target: { ...where },
						stepId: params.stepId,
						status: params.status,
						...(params.note === undefined ? {} : { note: params.note }),
					} as JsonValue,
					signal,
				),
			)) as SessionWorkflowView;
			return describe(where.sessionId, view);
		},
	};
}

/** What an agent reads: the workflow, its resume point, and nothing else. */
function describe(
	terminal: string,
	view: SessionWorkflowView | { readonly state: 'none' },
): unknown {
	if (view.state === 'unrestorable')
		throw new ControlEndpointError(
			'no_workflow',
			'This terminal had a workflow that could not be restored. The user can remove it from the workflow panel.',
		);
	if (view.state !== 'attached')
		throw new ControlEndpointError(
			'no_workflow',
			'This terminal has no workflow. Create one with create_workflow.',
		);
	return {
		terminal,
		workflow: describeWorkflow(view.workflow),
		resume_step_id: view.resumeStepId,
		unfinished: view.unfinished,
	};
}

function describeWorkflow(workflow: Workflow): unknown {
	return {
		id: workflow.id,
		name: workflow.name,
		...(workflow.openingPrompt === ''
			? {}
			: { opening_prompt: workflow.openingPrompt }),
		steps: workflow.steps.map((step) => ({
			id: step.id,
			title: step.title,
			...(step.prompt === '' ? {} : { prompt: step.prompt }),
			...(step.icon === '' ? {} : { icon: step.icon }),
			status: step.status,
			...(step.note === '' ? {} : { note: step.note }),
			started_at: isoTime(step.startedAt),
			ended_at: isoTime(step.endedAt),
		})),
	};
}

function isoTime(time: number | null): string | null {
	return time === null ? null : new Date(time).toISOString();
}
