import { randomUUID } from 'node:crypto';
import { WorkflowServiceError } from './errors.js';
import {
	WORKFLOW_ICON_NAMES,
	WORKFLOW_LIMITS,
	WORKFLOW_RECORD_SCHEMA_VERSION,
	WORKFLOW_STEP_STATUSES,
	WORKFLOW_TEMPLATE_SCHEMA_VERSION,
	type SessionWorkflowRecord,
	type Workflow,
	type WorkflowIconName,
	type WorkflowStep,
	type WorkflowStepStatus,
	type WorkflowTemplate,
	type WorkflowTemplateState,
	type WorkflowTemplateStep,
} from './types.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ICONS: ReadonlySet<string> = new Set(WORKFLOW_ICON_NAMES);
const STATUSES: ReadonlySet<string> = new Set(WORKFLOW_STEP_STATUSES);

export function isWorkflowId(value: unknown): value is string {
	return typeof value === 'string' && ID_PATTERN.test(value);
}

export function newWorkflowId(prefix: 'wf' | 'step' | 'tpl'): string {
	return `${prefix}-${randomUUID()}`;
}

/** A known icon name, or none. Unknown names are not an error. */
export function normalizeIcon(value: unknown): WorkflowIconName | '' {
	return typeof value === 'string' && ICONS.has(value)
		? (value as WorkflowIconName)
		: '';
}

export function isWorkflowStepStatus(
	value: unknown,
): value is WorkflowStepStatus {
	return typeof value === 'string' && STATUSES.has(value);
}

/**
 * Bytes of the JSON encoding of what a `create_workflow` request carries, so
 * escaping is counted (design decision 6).
 */
export function serializedWorkflowSize(content: {
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
			steps: content.steps.map((step) => ({
				title: step.title,
				prompt: step.prompt,
				icon: step.icon,
			})),
		}),
		'utf8',
	);
}

function invalid(
	message: string,
	details?: Readonly<Record<string, unknown>>,
): never {
	throw new WorkflowServiceError('invalid_workflow', message, details);
}

function charCount(value: string): number {
	return [...value].length;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const LINE_CONTROL = /[\u0000-\u001f\u007f]/u;
// biome-ignore lint/suspicious/noControlCharactersInRegex: tabs and newlines are allowed in prompts
const PROMPT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function lineText(
	value: unknown,
	field: string,
	maxChars: number,
	required: boolean,
): string {
	if (value === undefined || value === null) {
		if (required) invalid(`${field} is required`, { field });
		return '';
	}
	if (typeof value !== 'string') invalid(`${field} must be text`, { field });
	const text = value.trim();
	if (required && text === '') invalid(`${field} is required`, { field });
	if (LINE_CONTROL.test(text))
		invalid(`${field} must be one line of text`, { field });
	if (charCount(text) > maxChars)
		invalid(`${field} is longer than ${maxChars} characters`, {
			field,
			limit: maxChars,
		});
	return text;
}

function promptText(value: unknown, field: string): string {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') invalid(`${field} must be text`, { field });
	if (PROMPT_CONTROL.test(value))
		invalid(`${field} contains a control character`, { field });
	const bytes = Buffer.byteLength(value, 'utf8');
	if (bytes > WORKFLOW_LIMITS.maxPromptBytes)
		invalid(`${field} is larger than ${WORKFLOW_LIMITS.maxPromptBytes} bytes`, {
			field,
			limit: WORKFLOW_LIMITS.maxPromptBytes,
			size: bytes,
		});
	return value;
}

/** Validate a step note: one line, at most 200 characters. */
export function validateNote(value: unknown): string {
	return lineText(value, 'note', WORKFLOW_LIMITS.maxNoteChars, false);
}

/**
 * Strict validation of steps for a command. A step keeps a supplied id when
 * it is valid, unused, and (when `knownIds` is given) one the caller already
 * holds; any other step gets a fresh server id.
 */
export function validateSteps(
	input: unknown,
	knownIds: ReadonlySet<string> | 'any',
): readonly WorkflowTemplateStep[] {
	if (!Array.isArray(input) || input.length === 0)
		invalid('a workflow needs at least one step', { field: 'steps' });
	if (input.length > WORKFLOW_LIMITS.maxSteps)
		invalid(`a workflow has at most ${WORKFLOW_LIMITS.maxSteps} steps`, {
			field: 'steps',
			limit: WORKFLOW_LIMITS.maxSteps,
		});
	const used = new Set<string>();
	return input.map((candidate, index) => {
		const step =
			typeof candidate === 'object' && candidate !== null
				? (candidate as Record<string, unknown>)
				: invalid(`step ${index + 1} is invalid`, { step: index + 1 });
		const keep =
			isWorkflowId(step.id) &&
			!used.has(step.id) &&
			(knownIds === 'any' || knownIds.has(step.id));
		const id = keep ? (step.id as string) : newWorkflowId('step');
		used.add(id);
		return {
			id,
			title: lineText(
				step.title,
				`step ${index + 1} title`,
				WORKFLOW_LIMITS.maxTitleChars,
				true,
			),
			prompt: promptText(step.prompt, `step ${index + 1} prompt`),
			icon: normalizeIcon(step.icon),
		};
	});
}

function checkSerialized(content: Parameters<typeof serializedWorkflowSize>[0]) {
	const size = serializedWorkflowSize(content);
	if (size > WORKFLOW_LIMITS.maxSerializedBytes)
		invalid(
			`the workflow is ${size} bytes; the limit is ${WORKFLOW_LIMITS.maxSerializedBytes}`,
			{ field: 'size', size, limit: WORKFLOW_LIMITS.maxSerializedBytes },
		);
}

/**
 * Strict validation of a template for a save. `knownIds` are the step ids the
 * stored template already has (kept); `'any'` keeps every valid stored id and
 * is only for loading committed state.
 */
export function validateTemplate(
	input: unknown,
	knownIds: ReadonlySet<string> | 'any' = new Set(),
): WorkflowTemplate {
	const value =
		typeof input === 'object' && input !== null
			? (input as Record<string, unknown>)
			: invalid('template is invalid');
	const id = isWorkflowId(value.id) ? value.id : newWorkflowId('tpl');
	const template: WorkflowTemplate = {
		id,
		name: lineText(value.name, 'name', WORKFLOW_LIMITS.maxNameChars, true),
		description: lineText(
			value.description,
			'description',
			WORKFLOW_LIMITS.maxDescriptionChars,
			false,
		),
		category:
			typeof value.category === 'string'
				? value.category.trim().slice(0, WORKFLOW_LIMITS.maxCategoryChars)
				: '',
		openingPrompt: promptText(value.openingPrompt, 'opening prompt'),
		// A new template's steps all get server ids; an edited one keeps the
		// ids it already had.
		steps: validateSteps(value.steps, knownIds),
	};
	checkSerialized(template);
	return template;
}

/** Strict validation of an agent-supplied workflow. */
export function validateWorkflowInput(input: {
	readonly name?: unknown;
	readonly openingPrompt?: unknown;
	readonly steps?: unknown;
}): {
	readonly name: string;
	readonly openingPrompt: string;
	readonly steps: readonly WorkflowTemplateStep[];
} {
	const content = {
		name: lineText(input.name, 'name', WORKFLOW_LIMITS.maxNameChars, true),
		openingPrompt: promptText(input.openingPrompt, 'opening prompt'),
		// Agent-supplied ids are never kept: the server assigns every one.
		steps: validateSteps(input.steps, new Set()),
	};
	checkSerialized(content);
	return content;
}

/** A fresh workflow from validated content, every step not started. */
export function instantiateWorkflow(
	content: {
		readonly name: string;
		readonly openingPrompt: string;
		readonly steps: readonly WorkflowTemplateStep[];
	},
	templateId: string | null,
	now: number,
): Workflow {
	return {
		id: newWorkflowId('wf'),
		name: content.name,
		openingPrompt: content.openingPrompt,
		templateId,
		createdAt: now,
		steps: content.steps.map((step) => ({
			id: newWorkflowId('step'),
			title: step.title,
			prompt: step.prompt,
			icon: step.icon,
			status: 'not_started',
			note: '',
			startedAt: null,
			endedAt: null,
		})),
	};
}

export function normalizeCategoryList(input: unknown): readonly string[] {
	if (!Array.isArray(input)) return [];
	const categories: string[] = [];
	const seen = new Set<string>();
	for (const value of input) {
		if (typeof value !== 'string') continue;
		const name = value.trim().slice(0, WORKFLOW_LIMITS.maxCategoryChars);
		if (name === '' || LINE_CONTROL.test(name)) continue;
		if (seen.has(name.toLowerCase())) continue;
		if (categories.length >= WORKFLOW_LIMITS.maxCategories) break;
		seen.add(name.toLowerCase());
		categories.push(name);
	}
	return categories;
}

/** Point every template at a listed category by canonical name, or none. */
export function reconcileTemplateCategories(
	templates: readonly WorkflowTemplate[],
	categories: readonly string[],
): readonly WorkflowTemplate[] {
	const canonical = new Map(
		categories.map((name) => [name.toLowerCase(), name]),
	);
	return templates.map((template) => {
		const category = canonical.get(template.category.toLowerCase()) ?? '';
		return category === template.category
			? template
			: { ...template, category };
	});
}

/**
 * Lenient load of stored template state: anything malformed in a template
 * drops that template rather than failing the library.
 */
export function normalizeTemplateState(raw: unknown): WorkflowTemplateState {
	const value =
		typeof raw === 'object' && raw !== null
			? (raw as Record<string, unknown>)
			: {};
	const categories = normalizeCategoryList(value.categories);
	const templates: WorkflowTemplate[] = [];
	const seen = new Set<string>();
	for (const candidate of Array.isArray(value.templates)
		? value.templates
		: []) {
		try {
			const template = validateTemplate(candidate, 'any');
			if (seen.has(template.id)) continue;
			seen.add(template.id);
			templates.push(template);
			if (templates.length >= WORKFLOW_LIMITS.maxTemplates) break;
		} catch {}
	}
	const revision =
		typeof value.revision === 'number' &&
		Number.isSafeInteger(value.revision) &&
		value.revision >= 0
			? value.revision
			: 0;
	return {
		schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
		revision,
		cursor: String(revision),
		categories,
		templates: reconcileTemplateCategories(templates, categories),
	};
}

function timeOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
		? value
		: null;
}

/**
 * Validate a stored session record. Returns undefined when it is not one, so
 * the durable reader treats the file as corrupt.
 */
export function validateSessionRecord(
	raw: unknown,
): SessionWorkflowRecord | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const value = raw as Record<string, unknown>;
	if (!isWorkflowId(value.sessionId)) return undefined;
	if (value.workflow === null)
		return {
			schemaVersion: WORKFLOW_RECORD_SCHEMA_VERSION,
			sessionId: value.sessionId,
			workflow: null,
		};
	const workflow = validateStoredWorkflow(value.workflow);
	if (workflow === undefined) return undefined;
	return {
		schemaVersion: WORKFLOW_RECORD_SCHEMA_VERSION,
		sessionId: value.sessionId,
		workflow,
	};
}

function validateStoredWorkflow(raw: unknown): Workflow | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const value = raw as Record<string, unknown>;
	if (!isWorkflowId(value.id)) return undefined;
	if (typeof value.name !== 'string' || typeof value.openingPrompt !== 'string')
		return undefined;
	if (!Array.isArray(value.steps) || value.steps.length === 0) return undefined;
	const steps: WorkflowStep[] = [];
	const ids = new Set<string>();
	for (const candidate of value.steps) {
		if (typeof candidate !== 'object' || candidate === null) return undefined;
		const step = candidate as Record<string, unknown>;
		if (!isWorkflowId(step.id) || ids.has(step.id)) return undefined;
		if (typeof step.title !== 'string' || typeof step.prompt !== 'string')
			return undefined;
		if (!isWorkflowStepStatus(step.status)) return undefined;
		ids.add(step.id);
		steps.push({
			id: step.id,
			title: step.title,
			prompt: step.prompt,
			icon: normalizeIcon(step.icon),
			status: step.status,
			note: typeof step.note === 'string' ? step.note : '',
			startedAt: timeOrNull(step.startedAt),
			endedAt: timeOrNull(step.endedAt),
		});
	}
	return {
		id: value.id,
		name: value.name,
		openingPrompt: value.openingPrompt,
		templateId: isWorkflowId(value.templateId) ? value.templateId : null,
		createdAt: timeOrNull(value.createdAt) ?? 0,
		steps,
	};
}
