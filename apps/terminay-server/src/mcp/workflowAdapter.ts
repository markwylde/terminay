import type { JsonValue } from '@terminay/protocol';
import {
	type SessionWorkflowView,
	WORKFLOW_OPERATIONS,
	type Workflow,
	type WorkflowTemplate,
	type WorkflowTemplateState,
} from '@terminay/server-core';
import { serverControlError } from './appControlAdapter.js';
import {
	ControlEndpointError,
	type ControlRequestContext,
	hasNoCallingTerminal,
} from './controlEndpoint.js';
import type {
	TemplateStepContent,
	WorkflowControlAdapter,
} from './workflowTools.js';

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
		/** The revision the command was planned against; a stale one conflicts. */
		expectedRevision?: number,
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
	/** The named terminal, or the calling one; a chat or bot has none to default to. */
	const target = (
		context: ControlRequestContext,
		reference: string | undefined,
	): WorkflowControlTarget => {
		if (reference === undefined && hasNoCallingTerminal(context))
			throw new ControlEndpointError(
				'bad_request',
				`${context.bot === undefined ? 'A chat' : 'A bot'} has no terminal of its own: name one with terminal, from list_terminals.`,
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
			const replace =
				params.replaceWorkflowId === undefined
					? {}
					: { replaceWorkflowId: params.replaceWorkflowId };
			const payload =
				params.templateId !== undefined
					? { target: { ...where }, templateId: params.templateId, ...replace }
					: {
							target: { ...where },
							workflow: {
								name: params.name,
								openingPrompt: params.openingPrompt,
								steps: params.steps.map((step) => ({ ...step })),
							},
							...replace,
						};
			const view = (await run(() =>
				options.command(
					WORKFLOW_OPERATIONS.create,
					payload as JsonValue,
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
		listWorkflowTemplates: async (_params, _context, signal) => {
			const state = await templates(signal);
			return {
				categories: [...state.categories],
				templates: state.templates.map((template) => ({
					id: template.id,
					name: template.name,
					...(template.description === ''
						? {}
						: { description: template.description }),
					...(template.category === '' ? {} : { category: template.category }),
					step_count: template.steps.length,
				})),
			};
		},
		getWorkflowTemplate: async (params, _context, signal) =>
			describeTemplate(
				existing(await templates(signal), params.templateId),
			),
		createWorkflowTemplate: async (params, _context, signal) => {
			// No id: the server assigns the template's and every step's.
			const state = (await run(() =>
				options.command(
					WORKFLOW_OPERATIONS.templatesUpsert,
					{
						template: {
							name: params.name,
							description: params.description,
							category: params.category,
							openingPrompt: params.openingPrompt,
							steps: params.steps.map((step) => ({ ...step })),
						},
					} as JsonValue,
					signal,
				),
			)) as WorkflowTemplateState;
			const created = state.templates.at(-1);
			if (created === undefined)
				throw new ControlEndpointError(
					'internal',
					'The template was not saved.',
				);
			return describeTemplate(created);
		},
		updateWorkflowTemplate: async (params, _context, signal) =>
			withRevision(signal, async (state) => {
				const stored = existing(state, params.templateId);
				const merged = {
					id: stored.id,
					name: params.name ?? stored.name,
					description: params.description ?? stored.description,
					category: params.category ?? stored.category,
					openingPrompt: params.openingPrompt ?? stored.openingPrompt,
					steps: (params.steps ?? stored.steps).map(
						(step: TemplateStepContent) => ({ ...step }),
					),
				};
				const next = (await options.command(
					WORKFLOW_OPERATIONS.templatesUpsert,
					{ template: merged } as JsonValue,
					signal,
					state.revision,
				)) as WorkflowTemplateState;
				return describeTemplate(existing(next, stored.id));
			}),
		deleteWorkflowTemplate: async (params, _context, signal) =>
			withRevision(signal, async (state) => {
				const stored = existing(state, params.templateId);
				await options.command(
					WORKFLOW_OPERATIONS.templatesRemove,
					{ templateId: stored.id } as JsonValue,
					signal,
					state.revision,
				);
				return { deleted: stored.id, name: stored.name };
			}),
	};

	async function templates(signal: AbortSignal): Promise<WorkflowTemplateState> {
		return (await run(() =>
			options.query(WORKFLOW_OPERATIONS.templatesGet, {}, signal),
		)) as WorkflowTemplateState;
	}

	/**
	 * Read, then write against the revision read, so a change another client
	 * committed meanwhile is never overwritten and a template deleted
	 * meanwhile is never re-created. A conflict is retried on a fresh read.
	 */
	async function withRevision<T>(
		signal: AbortSignal,
		work: (state: WorkflowTemplateState) => Promise<T>,
	): Promise<T> {
		for (let attempt = 1; ; attempt += 1) {
			const state = await templates(signal);
			try {
				return await work(state);
			} catch (error) {
				const failure = serverControlError(error);
				if (
					failure.code !== 'conflict' ||
					attempt >= TEMPLATE_WRITE_ATTEMPTS ||
					signal.aborted
				)
					throw failure;
			}
		}
	}
}

const TEMPLATE_WRITE_ATTEMPTS = 3;

function existing(
	state: WorkflowTemplateState,
	templateId: string,
): WorkflowTemplate {
	const template = state.templates.find((item) => item.id === templateId);
	if (template === undefined)
		throw new ControlEndpointError(
			'template_not_found',
			'No workflow template has that id. List them with list_workflow_templates.',
			[templateId],
		);
	return template;
}

/** A reusable workflow template, as an agent reads it. It has no status. */
function describeTemplate(template: WorkflowTemplate): unknown {
	return {
		template: {
			id: template.id,
			name: template.name,
			...(template.description === ''
				? {}
				: { description: template.description }),
			...(template.category === '' ? {} : { category: template.category }),
			...(template.openingPrompt === ''
				? {}
				: { opening_prompt: template.openingPrompt }),
			steps: template.steps.map((step) => ({
				id: step.id,
				title: step.title,
				...(step.prompt === '' ? {} : { prompt: step.prompt }),
				...(step.icon === '' ? {} : { icon: step.icon }),
			})),
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
		template_id: workflow.templateId,
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
