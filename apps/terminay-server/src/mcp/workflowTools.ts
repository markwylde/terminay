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
});

export interface GetWorkflowParams {
	/** Absent means the calling terminal. */
	readonly terminal?: string;
}
export interface CreateWorkflowParams {
	readonly terminal?: string;
	readonly name: string;
	readonly openingPrompt: string;
	readonly steps: readonly {
		readonly title: string;
		readonly prompt: string;
		readonly icon: string;
	}[];
	readonly replaceWorkflowId?: string;
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
}

/** The tools a `WorkflowControlAdapter` binds; without one they are unavailable. */
export const WORKFLOW_CONTROL_OPERATIONS = Object.freeze([
	'get_workflow',
	'create_workflow',
	'update_workflow_step',
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
	const limits = WORKFLOW_TOOL_LIMITS;
	if (
		typeof params.name !== 'string' ||
		params.name.trim().length === 0 ||
		[...params.name].length > limits.maxNameChars
	)
		return badRequest(
			`name must be 1 to ${limits.maxNameChars} characters`,
		);
	const openingPrompt = params.opening_prompt ?? '';
	if (
		typeof openingPrompt !== 'string' ||
		Buffer.byteLength(openingPrompt, 'utf8') > limits.maxPromptBytes
	)
		return badRequest(
			`opening_prompt must be text of at most ${limits.maxPromptBytes} bytes`,
		);
	if (
		!Array.isArray(params.steps) ||
		params.steps.length === 0 ||
		params.steps.length > limits.maxSteps
	)
		return badRequest(`steps must list 1 to ${limits.maxSteps} steps`);
	const steps: { title: string; prompt: string; icon: string }[] = [];
	for (const [index, candidate] of params.steps.entries()) {
		if (typeof candidate !== 'object' || candidate === null)
			return badRequest(`steps[${index}] must be an object`);
		const { title, prompt = '', icon = '' } = candidate as Record<
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
		steps.push({ title, prompt, icon });
	}
	const name = params.name;
	const size = serializedSize({ name, openingPrompt, steps });
	if (size > limits.maxSerializedBytes)
		return badRequest(
			`the workflow is ${size} bytes as JSON; the limit is ${limits.maxSerializedBytes}`,
		);
	const replace = params.replace_workflow_id;
	if (
		replace !== undefined &&
		(typeof replace !== 'string' || !ID_PATTERN.test(replace))
	)
		return badRequest(
			'replace_workflow_id must be the workflow id get_workflow returned',
		);
	return {
		...(terminal === undefined ? {} : { terminal }),
		name,
		openingPrompt,
		steps,
		...(replace === undefined ? {} : { replaceWorkflowId: replace }),
	};
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
