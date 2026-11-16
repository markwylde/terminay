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
	typedWorkflowGoal,
	WORKFLOW_LAUNCH_INSTRUCTION,
} from '@terminay/protocol';
import {
	dependenciesFromOutline,
	impliedLinkCount,
	type Outline,
	outlineFromSteps,
	outlineKeys,
} from './workflowOutlineModel.ts';

export interface DraftStep {
	/** A key for the editor's own rows; never sent. */
	readonly key: string;
	/** The server's id; absent for a step not yet saved. */
	readonly id?: string;
	readonly title: string;
	readonly prompt: string;
	readonly icon: WorkflowIconName | '';
	/** The keys of the steps this step waits on, as stored (ADR-0128). */
	readonly after: readonly string[];
}

export interface DraftTemplate {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly category: string;
	readonly openingPrompt: string;
	/** Every step, in outline order once the shape has changed. */
	readonly steps: readonly DraftStep[];
	/** The plan's shape as the editor draws it. */
	readonly outline: Outline;
	/**
	 * Whether a step was added, removed, moved or placed alongside another.
	 * Until then saving keeps each step's stored dependencies; after, it
	 * derives every step's dependencies from the outline.
	 */
	readonly shapeChanged: boolean;
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
	// The server's id is the row's key, so a saved step keeps its row.
	const steps = template.steps.map((step) => ({
		key: step.id,
		id: step.id,
		title: step.title,
		prompt: step.prompt,
		icon: step.icon,
		after: step.after,
	}));
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		category: template.category,
		openingPrompt: template.openingPrompt,
		steps,
		outline: outlineFromSteps(steps.map((step) => ({ id: step.key, after: step.after }))),
		shapeChanged: false,
	};
}

/** A template with steps given as a list, drawn as the panel would draw them. */
export function withSteps(
	template: Omit<DraftTemplate, 'steps' | 'outline' | 'shapeChanged'>,
	steps: readonly DraftStep[],
): DraftTemplate {
	return {
		...template,
		steps,
		outline: outlineFromSteps(steps.map((step) => ({ id: step.key, after: step.after }))),
		shapeChanged: false,
	};
}

/**
 * The steps a save sends, in order, each with the keys it waits on: as stored
 * until the shape changes, then as the outline implies.
 */
export function effectiveSteps(template: DraftTemplate): readonly DraftStep[] {
	if (!template.shapeChanged) return template.steps;
	const derived = dependenciesFromOutline(template.outline);
	const byKey = new Map(template.steps.map((step) => [step.key, step]));
	return outlineKeys(template.outline).flatMap((key) => {
		const step = byKey.get(key);
		return step === undefined ? [] : [{ ...step, after: derived.get(key) ?? [] }];
	});
}

/**
 * What is sent: a step keeps its server id; a new one is sent without one,
 * or with its editor key when a later step waits on it, which names it for
 * that request only. `after` is left out where it is the step above.
 */
export function templateInput(template: DraftTemplate): WorkflowTemplateInput {
	const steps = effectiveSteps(template);
	const named = new Set(steps.flatMap((step) => step.after));
	const nameOf = (step: DraftStep) => step.id ?? step.key;
	const byKey = new Map(steps.map((item) => [item.key, item]));
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		category: template.category,
		openingPrompt: template.openingPrompt,
		steps: steps.map((step, index) => {
			const after = step.after.map((key) => {
				const target = byKey.get(key);
				return target === undefined ? key : nameOf(target);
			});
			const previous = steps[index - 1];
			const isDefault =
				index === 0
					? after.length === 0
					: after.length === 1 && previous !== undefined && after[0] === nameOf(previous);
			return {
				...(step.id !== undefined
					? { id: step.id }
					: named.has(step.key)
						? { id: step.key }
						: {}),
				title: step.title,
				prompt: step.prompt,
				icon: step.icon,
				...(isDefault ? {} : { after }),
			};
		}),
	};
}

/** A template's comparable content, to tell whether it has unsaved changes. */
export function templateFingerprint(template: DraftTemplate): string {
	return JSON.stringify(templateInput(template));
}

export function emptyTemplate(index: number, category: string): DraftTemplate {
	return withSteps(
		{
			id: `tpl-${Date.now().toString(36)}-${index}`,
			name: `Workflow ${index}`,
			description: '',
			category,
			openingPrompt: '',
		},
		[emptyStep(1)],
	);
}

export function emptyStep(index: number): DraftStep {
	return { key: newKey('row'), title: `Step ${index}`, prompt: '', icon: '', after: [] };
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
		steps: effectiveSteps(template).map((step) => ({
			id: step.key,
			title: step.title,
			prompt: step.prompt,
			icon: step.icon,
			after: step.after,
		})),
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
	if (template.shapeChanged) {
		const implied = impliedLinkCount(template.outline);
		if (implied > limits.maxDependencies)
			problems.push(
				`“${name}”: the outline implies ${implied} dependencies; a workflow may have at most ${limits.maxDependencies}.`,
			);
	}
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
	return typedWorkflowGoal(openingPrompt, WORKFLOW_LAUNCH_INSTRUCTION);
}

export function describeSaveError(error: unknown): string {
	const code = workflowErrorCode(error);
	const reason = workflowErrorDetails(error)?.reason;
	const message = error instanceof Error ? error.message : String(error);
	if (reason === 'stale_revision' || code === 'conflict' || /stale/i.test(message))
		return 'These workflows changed on the server after you started editing. Discard your changes to load the current ones.';
	return message;
}
