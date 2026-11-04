/**
 * The workflow template library as Settings edits it, as pure functions. The
 * server owns templates (ADR-0097); this is only the pending change set and
 * the checks the editor shows before a save would be refused.
 */

import {
	WORKFLOW_CLIENT_LIMITS,
	type WorkflowIconName,
	type WorkflowTemplate,
	type WorkflowTemplateInput,
	type WorkflowTemplateState,
	workflowErrorCode,
	workflowErrorDetails,
	workflowSerializedSize,
} from '@terminay/client-core';
import {
	composeWorkflowGoal,
	WORKFLOW_LAUNCH_INSTRUCTION,
} from '@terminay/protocol';

export interface DraftStep {
	/** A key for the editor's own rows; never sent. */
	readonly key: string;
	/** The server's id; absent for a step not yet saved. */
	readonly id?: string;
	readonly title: string;
	readonly prompt: string;
	readonly icon: WorkflowIconName | '';
}

export interface DraftTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly category: string;
	readonly openingPrompt: string;
	readonly steps: readonly DraftStep[];
}

export interface WorkflowDraft {
	readonly templates: readonly DraftTemplate[];
	readonly categories: readonly string[];
}

let nextKey = 0;
export function newKey(prefix: string): string {
	nextKey += 1;
	return `${prefix}-${Date.now().toString(36)}-${nextKey.toString(36)}`;
}

export function draftFrom(
	state: Pick<WorkflowTemplateState, 'templates' | 'categories'>,
): WorkflowDraft {
	return {
		categories: [...state.categories],
		templates: state.templates.map(draftTemplate),
	};
}

function draftTemplate(template: WorkflowTemplate): DraftTemplate {
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		category: template.category,
		openingPrompt: template.openingPrompt,
		// The server's id is the row's key, so a saved step keeps its row.
		steps: template.steps.map((step) => ({
			key: step.id,
			id: step.id,
			title: step.title,
			prompt: step.prompt,
			icon: step.icon,
		})),
	};
}

/** What is sent: a step keeps its server id, a new one has none. */
export function templateInput(template: DraftTemplate): WorkflowTemplateInput {
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		category: template.category,
		openingPrompt: template.openingPrompt,
		steps: template.steps.map((step) => ({
			...(step.id === undefined ? {} : { id: step.id }),
			title: step.title,
			prompt: step.prompt,
			icon: step.icon,
		})),
	};
}

/** A template's comparable content, to tell whether it has unsaved changes. */
export function templateFingerprint(template: DraftTemplate): string {
	return JSON.stringify(templateInput(template));
}

export function emptyTemplate(index: number, category: string): DraftTemplate {
	return {
		id: `tpl-${Date.now().toString(36)}-${index}`,
		name: `Workflow ${index}`,
		description: '',
		category,
		openingPrompt: '',
		steps: [emptyStep(1)],
	};
}

export function emptyStep(index: number): DraftStep {
	return { key: newKey('row'), title: `Step ${index}`, prompt: '', icon: '' };
}

/** Everything a filter matches: name, description, category, brief, step titles and prompts. */
export function templateSearchText(template: DraftTemplate): string {
	return [
		template.description,
		template.category,
		template.openingPrompt,
		...template.steps.flatMap((step) => [step.title, step.prompt]),
	].join('\n');
}

export function serializedSize(template: DraftTemplate): number {
	return workflowSerializedSize({
		name: template.name,
		openingPrompt: template.openingPrompt,
		steps: template.steps,
	});
}

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const chars = (value: string) => [...value].length;

/** Why the server would refuse this template; empty when it would not. */
export function templateProblems(template: DraftTemplate): string[] {
	const limits = WORKFLOW_CLIENT_LIMITS;
	const problems: string[] = [];
	const name = template.name.trim() || 'A workflow';
	if (template.name.trim() === '') problems.push('A workflow needs a name.');
	else if (chars(template.name) > limits.maxNameChars)
		problems.push(`“${name}”: the name is longer than ${limits.maxNameChars} characters.`);
	if (chars(template.description) > limits.maxDescriptionChars)
		problems.push(`“${name}”: the description is longer than ${limits.maxDescriptionChars} characters.`);
	if (bytes(template.openingPrompt) > limits.maxPromptBytes)
		problems.push(`“${name}”: the opening prompt is larger than 8 KiB.`);
	if (template.steps.length === 0) problems.push(`“${name}” has no steps.`);
	if (template.steps.length > limits.maxSteps)
		problems.push(`“${name}” has more than ${limits.maxSteps} steps.`);
	template.steps.forEach((step, index) => {
		if (step.title.trim() === '') problems.push(`“${name}”: step ${index + 1} needs a title.`);
		else if (chars(step.title) > limits.maxTitleChars)
			problems.push(`“${name}”: step ${index + 1}’s title is longer than ${limits.maxTitleChars} characters.`);
		if (bytes(step.prompt) > limits.maxPromptBytes)
			problems.push(`“${name}”: step ${index + 1}’s prompt is larger than 8 KiB.`);
	});
	const size = serializedSize(template);
	if (size > limits.maxSerializedBytes)
		problems.push(`“${name}” is ${formatKiB(size)}; a workflow may be at most 56 KiB.`);
	return problems;
}

export function formatKiB(size: number): string {
	return `${(size / 1024).toFixed(1)} KiB`;
}

/** What launching this template types into the terminal. */
export function launchPreview(openingPrompt: string): string {
	return composeWorkflowGoal(openingPrompt, WORKFLOW_LAUNCH_INSTRUCTION);
}

/** Move one entry by one place; the same list when it cannot move. */
export function moveBy<T>(list: readonly T[], index: number, direction: -1 | 1): readonly T[] {
	const target = index + direction;
	if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
	const next = [...list];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item as T);
	return next;
}

/** Move an entry to stand before another, by drag. */
export function moveBefore<T>(
	list: readonly T[],
	from: number,
	before: number,
): readonly T[] {
	if (from < 0 || from >= list.length || before < 0 || before > list.length) return list;
	if (before === from || before === from + 1) return list;
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(before > from ? before - 1 : before, 0, item as T);
	return next;
}

export function describeSaveError(error: unknown): string {
	const code = workflowErrorCode(error);
	const reason = workflowErrorDetails(error)?.reason;
	const message = error instanceof Error ? error.message : String(error);
	if (reason === 'stale_revision' || code === 'conflict' || /stale/i.test(message))
		return 'These workflows changed on the server after you started editing. Discard your changes to load the current ones.';
	return message;
}
