import { type JsonValue, protocolError } from '@terminay/protocol';
import { withinClientBoundary } from '../appWindows/mirror.js';
import type {
	CommandRequest,
	OperationRegistries,
	OrderedEventJournalLike,
	QueryRequest,
	RequestContext,
} from '../types.js';
import { isWorkflowServiceError, WorkflowServiceError } from './errors.js';
import { workflowLaunchText, workflowResumeText } from './launchText.js';
import {
	instantiateWorkflow,
	isWorkflowId,
	isWorkflowStepStatus,
	validateWorkflowInput,
} from './normalize.js';
import type { WorkflowStore } from './store.js';
import type { WorkflowTemplateRepository } from './templateRepository.js';
import type {
	SessionWorkflowView,
	WorkflowTemplateApplyResult,
	WorkflowTemplateCommand,
} from './types.js';

export const WORKFLOW_OPERATIONS = Object.freeze({
	templatesGet: 'workflows.templates.get',
	templatesUpsert: 'workflows.templates.upsert',
	templatesRemove: 'workflows.templates.remove',
	templatesReorder: 'workflows.templates.reorder',
	templatesReplace: 'workflows.templates.replace',
	list: 'workflows.list',
	get: 'workflows.get',
	launch: 'workflow.launch',
	resume: 'workflow.resume',
	create: 'workflow.create',
	updateStep: 'workflow.update-step',
	remove: 'workflow.remove',
} as const);

export const WORKFLOW_EVENTS = Object.freeze({
	/** Carries the new revision only; clients refetch the templates. */
	templatesChanged: 'workflows.templates.changed',
	/** Carries a session id and its state only; clients refetch through
	 * `workflows.get`, which applies their boundary. */
	changed: 'workflows.changed',
} as const);

/** The exact terminal a workflow command names. */
export interface WorkflowTarget {
	readonly serverId: string;
	readonly projectId: string;
	readonly sessionId: string;
}

export interface WorkflowOperationRegistryOptions {
	readonly serverId: string;
	readonly templates: WorkflowTemplateRepository;
	readonly store: WorkflowStore;
	readonly eventJournal: OrderedEventJournalLike;
	/** The project a running session is in now; undefined when not running. */
	readonly sessionProject: (sessionId: string) => string | undefined;
	/**
	 * Type text into the target terminal once: one paste, bracketed when the
	 * terminal enables it, submitted once (the window-message write path).
	 */
	readonly typeText: (
		request: CommandRequest,
		target: WorkflowTarget,
		text: string,
	) => Promise<void> | void;
}

export interface WorkflowOperationRegistry {
	readonly operations: OperationRegistries;
	/** Stop publishing store changes. */
	readonly dispose: () => void;
}

/**
 * Server operations for workflow templates and the workflows of terminal
 * sessions (ADR-0097). Terminay records progress; it never runs a step. The
 * only text it types is built here from a template or workflow plus a fixed
 * instruction, never taken from a client.
 */
export function createWorkflowOperationRegistry(
	options: WorkflowOperationRegistryOptions,
): WorkflowOperationRegistry {
	const { templates, store } = options;
	const stop = store.onChange((change) => {
		// Journal events reach every subscriber whatever its authority, so
		// they carry only the session and its state.
		options.eventJournal.append(WORKFLOW_EVENTS.changed, {
			sessionId: change.sessionId,
			state: change.state,
		});
	});

	const operations: OperationRegistries = {
		queries: {
			[WORKFLOW_OPERATIONS.templatesGet]: async () =>
				asJson(await templates.load()),
			[WORKFLOW_OPERATIONS.list]: list,
			[WORKFLOW_OPERATIONS.get]: get,
		},
		commands: {
			[WORKFLOW_OPERATIONS.templatesUpsert]: (request) =>
				applyTemplates(request, (payload) => ({
					type: 'upsert',
					template: payload.template,
				})),
			[WORKFLOW_OPERATIONS.templatesRemove]: (request) =>
				applyTemplates(request, (payload) => ({
					type: 'remove',
					templateId: boundedId(payload.templateId, 'template id'),
				})),
			[WORKFLOW_OPERATIONS.templatesReorder]: (request) =>
				applyTemplates(request, (payload) => ({
					type: 'reorder',
					templateIds: arrayOf(payload.templateIds, 'template ids'),
					...optionalCategories(payload),
				})),
			[WORKFLOW_OPERATIONS.templatesReplace]: (request) =>
				applyTemplates(request, (payload) => ({
					type: 'replace',
					templates: arrayOf(payload.templates, 'templates'),
					...optionalCategories(payload),
				})),
			[WORKFLOW_OPERATIONS.launch]: launch,
			[WORKFLOW_OPERATIONS.resume]: resume,
			[WORKFLOW_OPERATIONS.create]: create,
			[WORKFLOW_OPERATIONS.updateStep]: updateStep,
			[WORKFLOW_OPERATIONS.remove]: remove,
		},
		policies: {
			[WORKFLOW_OPERATIONS.templatesGet]: { scope: 'read' },
			[WORKFLOW_OPERATIONS.list]: { scope: 'read' },
			[WORKFLOW_OPERATIONS.get]: { scope: 'read' },
			[WORKFLOW_OPERATIONS.templatesUpsert]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.templatesRemove]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.templatesReorder]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.templatesReplace]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.launch]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.resume]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.create]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.updateStep]: { scope: 'write' },
			[WORKFLOW_OPERATIONS.remove]: { scope: 'write' },
		},
	};

	return { operations, dispose: stop };

	function visible(context: RequestContext, sessionId: string): boolean {
		const projectId = options.sessionProject(sessionId);
		return (
			projectId !== undefined &&
			withinClientBoundary(context, { projectId, terminalSessionId: sessionId })
		);
	}

	async function list(request: QueryRequest): Promise<JsonValue> {
		return asJson({
			workflows: store
				.list()
				.filter((view) => visible(request.context, view.sessionId)),
		});
	}

	async function get(request: QueryRequest): Promise<JsonValue> {
		try {
			const sessionId = boundedId(
				objectPayload(request.envelope.payload).terminalSessionId,
				'terminal session id',
			);
			if (!visible(request.context, sessionId))
				throw notFound('that terminal is unavailable');
			return asJson(viewOrNone(store.get(sessionId), sessionId));
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	async function applyTemplates(
		request: CommandRequest,
		build: (
			payload: Readonly<Record<string, JsonValue>>,
		) => WorkflowTemplateCommand,
	): Promise<{ readonly result: JsonValue; readonly revision: number }> {
		try {
			const command = build(objectPayload(request.envelope.payload));
			const outcome: WorkflowTemplateApplyResult = await templates.apply({
				command,
				commandId: request.envelope.commandId,
				...(request.envelope.expectedRevision === undefined
					? {}
					: { expectedRevision: request.envelope.expectedRevision }),
			});
			if (!outcome.ok)
				throw protocolError('conflict', outcome.conflict.message, {
					details: {
						currentRevision: outcome.conflict.currentRevision,
						currentCursor: outcome.conflict.currentCursor,
					},
					retryable: true,
				});
			options.eventJournal.append(WORKFLOW_EVENTS.templatesChanged, {
				revision: outcome.revision,
				cursor: outcome.cursor,
			});
			return { result: asJson(outcome.state), revision: outcome.revision };
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	/** The exact terminal a command names, refused unless it is running in
	 * that project and inside the caller's boundary. */
	function target(request: CommandRequest): WorkflowTarget {
		const payload = objectPayload(objectPayload(request.envelope.payload).target);
		if (payload.serverId !== options.serverId)
			throw notFound('that terminal is not on this server');
		const projectId = boundedId(payload.projectId, 'project id');
		const sessionId = boundedId(payload.sessionId, 'session id');
		if (
			options.sessionProject(sessionId) !== projectId ||
			!withinClientBoundary(request.context, {
				projectId,
				terminalSessionId: sessionId,
			})
		)
			// The same answer as for a terminal that does not exist.
			throw notFound('that terminal is unavailable');
		return { serverId: options.serverId, projectId, sessionId };
	}

	async function launch(request: CommandRequest): Promise<JsonValue> {
		try {
			const payload = objectPayload(request.envelope.payload);
			const where = target(request);
			const templateId = boundedId(payload.templateId, 'template id');
			const replaceWorkflowId = optionalId(
				payload.replaceWorkflowId,
				'workflow id',
			);
			const template = await templates.template(templateId);
			// The terminal may have moved, or ended, while the template was read:
			// authorise it again before anything changes.
			target(request);
			if (template === undefined)
				throw new WorkflowServiceError(
					'template_not_found',
					'that workflow template no longer exists',
					{ templateId },
				);
			// Everything that can refuse is checked before anything changes.
			const text = workflowLaunchText(template.openingPrompt);
			store.assertReplaceable(where.sessionId, replaceWorkflowId);
			const workflow = instantiateWorkflow(template, template.id, Date.now());
			const view = store.attach(where.sessionId, workflow, replaceWorkflowId);
			await options.typeText(request, where, text);
			return asJson(view);
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	async function resume(request: CommandRequest): Promise<JsonValue> {
		try {
			const where = target(request);
			const workflow = store.workflowOf(where.sessionId);
			const text = workflowResumeText(workflow.openingPrompt);
			await options.typeText(request, where, text);
			return asJson(store.get(where.sessionId) ?? null);
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	async function create(request: CommandRequest): Promise<JsonValue> {
		try {
			const payload = objectPayload(request.envelope.payload);
			const where = target(request);
			const replaceWorkflowId = optionalId(
				payload.replaceWorkflowId,
				'workflow id',
			);
			const templateId = optionalId(payload.templateId, 'template id');
			if (templateId === undefined) {
				const content = validateWorkflowInput(objectPayload(payload.workflow));
				const workflow = instantiateWorkflow(content, null, Date.now());
				return asJson(
					store.attach(where.sessionId, workflow, replaceWorkflowId),
				);
			}
			if (payload.workflow !== undefined && payload.workflow !== null)
				throw new WorkflowServiceError(
					'invalid_workflow',
					'give a template id or a workflow, not both',
				);
			// A copy of the template, as a launch makes, but nothing is typed:
			// the caller is the agent that will work through it.
			const template = await templates.template(templateId);
			// The terminal may have moved, or ended, while the template was read.
			target(request);
			if (template === undefined)
				throw new WorkflowServiceError(
					'template_not_found',
					'that workflow template does not exist',
					{ templateId },
				);
			store.assertReplaceable(where.sessionId, replaceWorkflowId);
			const workflow = instantiateWorkflow(template, template.id, Date.now());
			return asJson(store.attach(where.sessionId, workflow, replaceWorkflowId));
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	async function updateStep(request: CommandRequest): Promise<JsonValue> {
		try {
			const payload = objectPayload(request.envelope.payload);
			const where = target(request);
			const stepId = boundedId(payload.stepId, 'step id');
			if (!isWorkflowStepStatus(payload.status))
				throw new WorkflowServiceError(
					'invalid_workflow',
					'status must be not_started, running, done, failed or needs_input',
					{ field: 'status' },
				);
			return asJson(
				store.updateStep(where.sessionId, stepId, payload.status, payload.note),
			);
		} catch (error) {
			throw toProtocolError(error);
		}
	}

	async function remove(request: CommandRequest): Promise<JsonValue> {
		try {
			const where = target(request);
			store.remove(where.sessionId);
			return asJson({ sessionId: where.sessionId, state: 'none' });
		} catch (error) {
			throw toProtocolError(error);
		}
	}
}

function viewOrNone(
	view: SessionWorkflowView | undefined,
	sessionId: string,
): SessionWorkflowView | { readonly sessionId: string; readonly state: 'none' } {
	return view ?? { sessionId, state: 'none' };
}

function objectPayload(
	value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: {};
}

function arrayOf(value: JsonValue | undefined, name: string): JsonValue[] {
	if (!Array.isArray(value))
		throw new WorkflowServiceError('invalid_workflow', `${name} must be a list`);
	return value;
}

function optionalCategories(
	payload: Readonly<Record<string, JsonValue>>,
): { readonly categories?: JsonValue[] } {
	return payload.categories === undefined
		? {}
		: { categories: arrayOf(payload.categories, 'categories') };
}

function boundedId(value: JsonValue | undefined, name: string): string {
	if (!isWorkflowId(value))
		throw new WorkflowServiceError('invalid_workflow', `${name} is invalid`);
	return value;
}

function optionalId(
	value: JsonValue | undefined,
	name: string,
): string | undefined {
	return value === undefined || value === null
		? undefined
		: boundedId(value, name);
}

function notFound(message: string): Error {
	return protocolError('not_found', message) as unknown as Error;
}

function asJson(value: unknown): JsonValue {
	return value as JsonValue;
}

/**
 * Map a workflow refusal onto the protocol. The workflow code travels as
 * `details.reason`, with the id it names, so an MCP caller receives it intact.
 */
export function toProtocolError(error: unknown): unknown {
	if (!isWorkflowServiceError(error)) return error;
	const code =
		error.code === 'invalid_workflow'
			? 'validation'
			: error.code === 'template_not_found' ||
					error.code === 'no_workflow' ||
					error.code === 'step_not_found' ||
					error.code === 'unauthorized_target'
				? 'not_found'
				: error.code === 'workflow_exists' || error.code === 'step_active'
					? 'conflict'
					: 'internal';
	const details =
		typeof error.details === 'object' && error.details !== null
			? (error.details as Record<string, JsonValue>)
			: {};
	return protocolError(code, error.message, {
		details: { ...details, reason: error.code },
	});
}
