import { join } from 'node:path';
import {
	createJsonFileBackend,
	jsonObjectWith,
} from '../automationService/fileBackend.js';
import { WorkflowServiceError } from './errors.js';
import {
	normalizeCategoryList,
	normalizeTemplateState,
	reconcileTemplateCategories,
	validateTemplate,
} from './normalize.js';
import {
	WORKFLOW_LIMITS,
	WORKFLOW_TEMPLATE_SCHEMA_VERSION,
	type WorkflowTemplate,
	type WorkflowTemplateApplyResult,
	type WorkflowTemplateBackend,
	type WorkflowTemplateCommandEnvelope,
	type WorkflowTemplateState,
} from './types.js';

export const WORKFLOW_TEMPLATES_FILE = 'workflow-templates.v1.json';

/** The canonical template file in a server's data root (ADR-0088). */
export function createWorkflowTemplateFileBackend(
	dataRoot: string,
): WorkflowTemplateBackend {
	const backend = createJsonFileBackend<WorkflowTemplateState>(
		join(dataRoot, WORKFLOW_TEMPLATES_FILE),
		{
			store: 'workflow-templates',
			validate: jsonObjectWith('templates', 'array'),
		},
	);
	return { load: backend.load, commit: backend.commit };
}

/** An in-memory backend, for tests and hosts without a data root. */
export function createMemoryWorkflowTemplateBackend(
	initial?: unknown,
): WorkflowTemplateBackend & { readonly committed: () => unknown } {
	let stored: unknown = initial === undefined ? undefined : structuredClone(initial);
	return {
		load: async () => (stored === undefined ? undefined : structuredClone(stored)),
		commit: async (state) => {
			stored = structuredClone(state);
		},
		committed: () => (stored === undefined ? undefined : structuredClone(stored)),
	};
}

/** Durable, revisioned, server-owned workflow templates. */
export class WorkflowTemplateRepository {
	private current: WorkflowTemplateState | undefined;
	private readonly outcomes = new Map<string, WorkflowTemplateApplyResult>();
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private readonly backend: WorkflowTemplateBackend) {}

	async load(): Promise<WorkflowTemplateState> {
		if (this.current !== undefined) return structuredClone(this.current);
		const raw = await this.backend.load();
		this.current = normalizeTemplateState(raw);
		return structuredClone(this.current);
	}

	async template(id: string): Promise<WorkflowTemplate | undefined> {
		return (await this.load()).templates.find((item) => item.id === id);
	}

	/** Commands are applied one at a time, in arrival order. */
	apply(
		envelope: WorkflowTemplateCommandEnvelope,
	): Promise<WorkflowTemplateApplyResult> {
		const next = this.queue.then(() => this.applyNow(envelope));
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async applyNow(
		envelope: WorkflowTemplateCommandEnvelope,
	): Promise<WorkflowTemplateApplyResult> {
		const current = this.current ?? (await this.load());
		if (envelope.commandId !== undefined) {
			const previous = this.outcomes.get(envelope.commandId);
			if (previous !== undefined) return structuredClone(previous);
		}
		if (
			envelope.expectedRevision !== undefined &&
			envelope.expectedRevision !== current.revision
		) {
			const conflict: WorkflowTemplateApplyResult = {
				ok: false,
				conflict: {
					code: 'conflict',
					currentRevision: current.revision,
					currentCursor: current.cursor,
					message: 'workflow template revision is stale',
				},
			};
			this.remember(envelope, conflict);
			return structuredClone(conflict);
		}

		let templates: readonly WorkflowTemplate[] = current.templates;
		let categories = current.categories;
		const command = envelope.command;
		switch (command.type) {
			case 'upsert': {
				const id = (command.template as { id?: unknown } | null)?.id;
				const stored = current.templates.find((item) => item.id === id);
				const template = validateTemplate(
					command.template,
					new Set(stored?.steps.map((step) => step.id) ?? []),
				);
				templates =
					stored === undefined
						? [...current.templates, template]
						: current.templates.map((item) =>
								item.id === template.id ? template : item,
							);
				break;
			}
			case 'remove':
				templates = current.templates.filter(
					(item) => item.id !== command.templateId,
				);
				break;
			case 'reorder': {
				const byId = new Map(current.templates.map((item) => [item.id, item]));
				const ordered: WorkflowTemplate[] = [];
				for (const id of command.templateIds) {
					const template = typeof id === 'string' ? byId.get(id) : undefined;
					if (template === undefined) continue;
					ordered.push(template);
					byId.delete(template.id);
				}
				// A template the client did not list keeps its place at the end.
				templates = [...ordered, ...byId.values()];
				if (command.categories !== undefined)
					categories = normalizeCategoryList(command.categories);
				break;
			}
			case 'replace': {
				const seen = new Set<string>();
				const next: WorkflowTemplate[] = [];
				for (const candidate of command.templates) {
					const id = (candidate as { id?: unknown } | null)?.id;
					const stored = current.templates.find((item) => item.id === id);
					const template = validateTemplate(
						candidate,
						new Set(stored?.steps.map((step) => step.id) ?? []),
					);
					if (seen.has(template.id))
						throw new WorkflowServiceError(
							'invalid_workflow',
							'two templates share an id',
						);
					seen.add(template.id);
					next.push(template);
				}
				templates = next;
				if (command.categories !== undefined)
					categories = normalizeCategoryList(command.categories);
				break;
			}
			default:
				throw new WorkflowServiceError(
					'invalid_workflow',
					'unknown workflow template command',
				);
		}
		if (templates.length > WORKFLOW_LIMITS.maxTemplates)
			throw new WorkflowServiceError(
				'invalid_workflow',
				`a server holds at most ${WORKFLOW_LIMITS.maxTemplates} workflow templates`,
			);
		// A template saved under a category the list lacks adds it at the end,
		// rather than silently losing its category.
		if (command.type === 'upsert' || command.type === 'replace') {
			const wanted = [
				...categories,
				...templates.map((template) => template.category),
			];
			const known = new Set(categories.map((name) => name.toLowerCase()));
			for (const name of wanted) {
				const key = name.trim().toLowerCase();
				if (key === '' || known.has(key)) continue;
				known.add(key);
				// Refused, never silently dropped: a template would lose its
				// category.
				if (known.size > WORKFLOW_LIMITS.maxCategories)
					throw new WorkflowServiceError(
						'invalid_workflow',
						`a server holds at most ${WORKFLOW_LIMITS.maxCategories} workflow categories`,
						{ field: 'category', limit: WORKFLOW_LIMITS.maxCategories },
					);
			}
			categories = normalizeCategoryList(wanted);
		}
		const revision = current.revision + 1;
		const next: WorkflowTemplateState = {
			schemaVersion: WORKFLOW_TEMPLATE_SCHEMA_VERSION,
			revision,
			cursor: String(revision),
			categories: [...categories],
			templates: reconcileTemplateCategories(templates, categories),
		};
		await this.backend.commit(structuredClone(next));
		this.current = next;
		const result: WorkflowTemplateApplyResult = {
			ok: true,
			revision,
			cursor: next.cursor,
			state: structuredClone(next),
		};
		this.remember(envelope, result);
		return structuredClone(result);
	}

	private remember(
		envelope: WorkflowTemplateCommandEnvelope,
		result: WorkflowTemplateApplyResult,
	): void {
		if (envelope.commandId === undefined) return;
		this.outcomes.set(envelope.commandId, result);
		if (this.outcomes.size > 256) {
			const oldest = this.outcomes.keys().next().value;
			if (oldest !== undefined) this.outcomes.delete(oldest);
		}
	}
}
