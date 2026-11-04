import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * The workflow tools (ADR-0097): an agent attaches a checklist to a terminal,
 * reads it, and reports each step's status. Terminay never runs a step.
 * Parsing lives here; the binding to the workflow service lives in
 * workflowAdapter.ts, which loads server-core.
 */

export const WORKFLOW_STEP_STATUSES = Object.freeze([
	'not_started',
	'running',
	'done',
	'failed',
	'needs_input',
] as const);
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

/** The service's bounds, repeated here so parsing needs no server-core. */
export const WORKFLOW_TOOL_LIMITS = Object.freeze({
	maxSteps: 50,
	maxNameChars: 120,
	maxTitleChars: 120,
	maxPromptBytes: 8 * 1024,
	maxSerializedBytes: 56 * 1024,
	maxNoteChars: 200,
	maxDescriptionChars: 1024,
	maxCategoryChars: 64,
});

export interface GetWorkflowParams {
	/** Absent means the calling terminal. */
	readonly terminal?: string;
}
export type CreateWorkflowParams =
	| {
			readonly terminal?: string;
			readonly name: string;
			readonly openingPrompt: string;
			readonly steps: readonly WorkflowStepContent[];
			readonly replaceWorkflowId?: string;
			readonly templateId?: undefined;
	  }
	| {
			readonly terminal?: string;
			/** Copy this workflow template into the terminal's workflow. */
			readonly templateId: string;
			readonly replaceWorkflowId?: string;
	  };
export interface WorkflowStepContent {
	readonly title: string;
	readonly prompt: string;
	readonly icon: string;
}
export interface TemplateStepContent extends WorkflowStepContent {
	/** A step id of the template being updated, to keep it. */
	readonly id?: string;
}
export interface TemplateIdParams {
	readonly templateId: string;
}
export interface CreateWorkflowTemplateParams {
	readonly name: string;
	readonly description: string;
	readonly category: string;
	readonly openingPrompt: string;
	readonly steps: readonly WorkflowStepContent[];
}
/** Fields left out keep their stored value. */
export interface UpdateWorkflowTemplateParams {
	readonly templateId: string;
	readonly name?: string;
	readonly description?: string;
	readonly category?: string;
	readonly openingPrompt?: string;
	readonly steps?: readonly TemplateStepContent[];
}
export interface UpdateWorkflowStepParams {
	readonly terminal?: string;
	readonly stepId: string;
	readonly status: WorkflowStepStatus;
	readonly note?: string;
}

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;
type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the workflow tools, already past the permission gate. */
export interface WorkflowControlAdapter {
	readonly getWorkflow: Handler<GetWorkflowParams>;
	readonly createWorkflow: Handler<CreateWorkflowParams>;
	readonly updateWorkflowStep: Handler<UpdateWorkflowStepParams>;
	readonly listWorkflowTemplates: Handler<Record<string, never>>;
	readonly getWorkflowTemplate: Handler<TemplateIdParams>;
	readonly createWorkflowTemplate: Handler<CreateWorkflowTemplateParams>;
	readonly updateWorkflowTemplate: Handler<UpdateWorkflowTemplateParams>;
	readonly deleteWorkflowTemplate: Handler<TemplateIdParams>;
}

/** The tools a `WorkflowControlAdapter` binds; without one they are unavailable. */
export const WORKFLOW_CONTROL_OPERATIONS = Object.freeze([
	'get_workflow',
	'create_workflow',
	'update_workflow_step',
	'list_workflow_templates',
	'get_workflow_template',
	'create_workflow_template',
	'update_workflow_template',
	'delete_workflow_template',
] as const);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TERMINAL_REF_CHARS = 256;
const MAX_ICON_CHARS = 64;

export function isWorkflowParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseGetWorkflow(
	params: Record<string, unknown>,
): Parsed<GetWorkflowParams> {
	const terminal = optionalTerminal(params.terminal);
	if (isWorkflowParamFailure(terminal)) return terminal;
	return terminal === undefined ? {} : { terminal };
}

export function parseCreateWorkflow(
	params: Record<string, unknown>,
): Parsed<CreateWorkflowParams> {
	const terminal = optionalTerminal(params.terminal);
	if (isWorkflowParamFailure(terminal)) return terminal;
	const replace = params.replace_workflow_id;
	if (
		replace !== undefined &&
		(typeof replace !== 'string' || !ID_PATTERN.test(replace))
	)
		return badRequest(
			'replace_workflow_id must be the workflow id get_workflow returned',
		);
	const common = {
		...(terminal === undefined ? {} : { terminal }),
		...(replace === undefined ? {} : { replaceWorkflowId: replace }),
	};
	if (params.template_id !== undefined) {
		const templateId = templateIdOf(params.template_id);
		if (isWorkflowParamFailure(templateId)) return templateId;
		if (
			params.name !== undefined ||
			params.opening_prompt !== undefined ||
			params.steps !== undefined
		)
			return badRequest(
				'give template_id to copy a workflow template, or name and steps, not both',
			);
		return { ...common, templateId };
	}
	const name = nameOf(params.name);
	if (isWorkflowParamFailure(name)) return name;
	const openingPrompt = promptOf(params.opening_prompt, 'opening_prompt');
	if (isWorkflowParamFailure(openingPrompt)) return openingPrompt;
	const steps = stepsOf(params.steps, false);
	if (isWorkflowParamFailure(steps)) return steps;
	const size = serializedSize({ name, openingPrompt, steps });
	if (size > WORKFLOW_TOOL_LIMITS.maxSerializedBytes)
		return badRequest(
			`the workflow is ${size} bytes as JSON; the limit is ${WORKFLOW_TOOL_LIMITS.maxSerializedBytes}`,
		);
	return { ...common, name, openingPrompt, steps };
}

export function parseTemplateId(
	params: Record<string, unknown>,
): Parsed<TemplateIdParams> {
	const templateId = templateIdOf(params.template_id);
	if (isWorkflowParamFailure(templateId)) return templateId;
	return { templateId };
}

export function parseListWorkflowTemplates(): Parsed<Record<string, never>> {
	return {};
}

export function parseCreateWorkflowTemplate(
	params: Record<string, unknown>,
): Parsed<CreateWorkflowTemplateParams> {
	const name = nameOf(params.name);
	if (isWorkflowParamFailure(name)) return name;
	const description = descriptionOf(params.description ?? '');
	if (isWorkflowParamFailure(description)) return description;
	const category = categoryOf(params.category ?? '');
	if (isWorkflowParamFailure(category)) return category;
	const openingPrompt = promptOf(params.opening_prompt, 'opening_prompt');
	if (isWorkflowParamFailure(openingPrompt)) return openingPrompt;
	const steps = stepsOf(params.steps, false);
	if (isWorkflowParamFailure(steps)) return steps;
	const size = serializedSize({ name, openingPrompt, steps });
	if (size > WORKFLOW_TOOL_LIMITS.maxSerializedBytes)
		return badRequest(
			`the template is ${size} bytes as JSON; the limit is ${WORKFLOW_TOOL_LIMITS.maxSerializedBytes}`,
		);
	return { name, description, category, openingPrompt, steps };
}

export function parseUpdateWorkflowTemplate(
	params: Record<string, unknown>,
): Parsed<UpdateWorkflowTemplateParams> {
	const templateId = templateIdOf(params.template_id);
	if (isWorkflowParamFailure(templateId)) return templateId;
	const out: {
		templateId: string;
		name?: string;
		description?: string;
		category?: string;
		openingPrompt?: string;
		steps?: readonly TemplateStepContent[];
	} = { templateId };
	if (params.name !== undefined) {
		const name = nameOf(params.name);
		if (isWorkflowParamFailure(name)) return name;
		out.name = name;
	}
	if (params.description !== undefined) {
		const description = descriptionOf(params.description);
		if (isWorkflowParamFailure(description)) return description;
		out.description = description;
	}
	if (params.category !== undefined) {
		const category = categoryOf(params.category);
		if (isWorkflowParamFailure(category)) return category;
		out.category = category;
	}
	if (params.opening_prompt !== undefined) {
		const openingPrompt = promptOf(params.opening_prompt, 'opening_prompt');
		if (isWorkflowParamFailure(openingPrompt)) return openingPrompt;
		out.openingPrompt = openingPrompt;
	}
	if (params.steps !== undefined) {
		const steps = stepsOf(params.steps, true);
		if (isWorkflowParamFailure(steps)) return steps;
		out.steps = steps;
	}
	if (Object.keys(out).length === 1)
		return badRequest(
			'give at least one of name, description, category, opening_prompt, or steps',
		);
	return out;
}

function templateIdOf(value: unknown): string | Failure {
	if (typeof value !== 'string' || !ID_PATTERN.test(value))
		return badRequest(
			'template_id must be a template id from list_workflow_templates',
		);
	return value;
}

function nameOf(value: unknown): string | Failure {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		[...value].length > WORKFLOW_TOOL_LIMITS.maxNameChars
	)
		return badRequest(
			`name must be 1 to ${WORKFLOW_TOOL_LIMITS.maxNameChars} characters`,
		);
	return value;
}

function descriptionOf(value: unknown): string | Failure {
	if (
		typeof value !== 'string' ||
		[...value].length > WORKFLOW_TOOL_LIMITS.maxDescriptionChars
	)
		return badRequest(
			`description must be text of at most ${WORKFLOW_TOOL_LIMITS.maxDescriptionChars} characters`,
		);
	return value;
}

function categoryOf(value: unknown): string | Failure {
	if (
		typeof value !== 'string' ||
		[...value.trim()].length > WORKFLOW_TOOL_LIMITS.maxCategoryChars ||
		/[\r\n]/u.test(value)
	)
		return badRequest(
			`category must be one line of at most ${WORKFLOW_TOOL_LIMITS.maxCategoryChars} characters; empty for none`,
		);
	return value.trim();
}

function promptOf(value: unknown, field: string): string | Failure {
	const text = value ?? '';
	if (
		typeof text !== 'string' ||
		Buffer.byteLength(text, 'utf8') > WORKFLOW_TOOL_LIMITS.maxPromptBytes
	)
		return badRequest(
			`${field} must be text of at most ${WORKFLOW_TOOL_LIMITS.maxPromptBytes} bytes`,
		);
	return text;
}

function stepsOf(
	value: unknown,
	keepIds: boolean,
): TemplateStepContent[] | Failure {
	const limits = WORKFLOW_TOOL_LIMITS;
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > limits.maxSteps
	)
		return badRequest(`steps must list 1 to ${limits.maxSteps} steps`);
	const steps: TemplateStepContent[] = [];
	for (const [index, candidate] of value.entries()) {
		if (typeof candidate !== 'object' || candidate === null)
			return badRequest(`steps[${index}] must be an object`);
		const { id, title, prompt = '', icon = '' } = candidate as Record<
			string,
			unknown
		>;
		if (
			typeof title !== 'string' ||
			title.trim().length === 0 ||
			[...title].length > limits.maxTitleChars
		)
			return badRequest(
				`steps[${index}].title must be 1 to ${limits.maxTitleChars} characters`,
			);
		if (
			typeof prompt !== 'string' ||
			Buffer.byteLength(prompt, 'utf8') > limits.maxPromptBytes
		)
			return badRequest(
				`steps[${index}].prompt must be text of at most ${limits.maxPromptBytes} bytes`,
			);
		if (typeof icon !== 'string' || icon.length > MAX_ICON_CHARS)
			return badRequest(`steps[${index}].icon must be an icon name`);
		if (keepIds && id !== undefined) {
			if (typeof id !== 'string' || !ID_PATTERN.test(id))
				return badRequest(
					`steps[${index}].id must be a step id from get_workflow_template`,
				);
			steps.push({ id, title, prompt, icon });
		} else steps.push({ title, prompt, icon });
	}
	return steps;
}

export function parseUpdateWorkflowStep(
	params: Record<string, unknown>,
): Parsed<UpdateWorkflowStepParams> {
	const terminal = optionalTerminal(params.terminal);
	if (isWorkflowParamFailure(terminal)) return terminal;
	if (typeof params.step_id !== 'string' || !ID_PATTERN.test(params.step_id))
		return badRequest('step_id must be a step id from get_workflow');
	if (
		typeof params.status !== 'string' ||
		!(WORKFLOW_STEP_STATUSES as readonly string[]).includes(params.status)
	)
		return badRequest(
			`status must be one of ${WORKFLOW_STEP_STATUSES.join(', ')}`,
		);
	const note = params.note;
	if (
		note !== undefined &&
		(typeof note !== 'string' ||
			[...note].length > WORKFLOW_TOOL_LIMITS.maxNoteChars ||
			/[\r\n]/u.test(note))
	)
		return badRequest(
			`note must be one line of at most ${WORKFLOW_TOOL_LIMITS.maxNoteChars} characters`,
		);
	return {
		...(terminal === undefined ? {} : { terminal }),
		stepId: params.step_id,
		status: params.status as WorkflowStepStatus,
		...(note === undefined ? {} : { note }),
	};
}

/**
 * The serialized size the workflow service bounds: the JSON encoding of the
 * name, opening prompt and steps, escaping included.
 */
export function serializedSize(content: {
	readonly name: string;
	readonly openingPrompt: string;
	readonly steps: readonly {
		readonly title: string;
		readonly prompt: string;
		readonly icon: string;
	}[];
}): number {
	return Buffer.byteLength(
		JSON.stringify({
			name: content.name,
			openingPrompt: content.openingPrompt,
			steps: content.steps.map(({ title, prompt, icon }) => ({
				title,
				prompt,
				icon,
			})),
		}),
		'utf8',
	);
}

function optionalTerminal(value: unknown): string | undefined | Failure {
	if (value === undefined) return undefined;
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		value.length > MAX_TERMINAL_REF_CHARS ||
		value.includes('\0')
	)
		return badRequest('terminal must be a terminal handle from list_terminals');
	return value;
}

export function workflowFailure(
	code: ControlError['code'],
	message: string,
): Failure {
	return { ok: false, error: { code, message } };
}

function badRequest(message: string): Failure {
	return workflowFailure('bad_request', message);
}
