import { AutomationServiceError } from './errors.js';
import {
	cronValidator,
	normalizeAutomation,
	normalizePersistedAutomation,
} from './normalize.js';
import {
	AUTOMATION_SCHEMA_VERSION,
	type AutomationApplyResult,
	type AutomationBackend,
	type AutomationCommandEnvelope,
	type AutomationCronValidator,
	type AutomationDefinition,
	type AutomationMacroResolver,
	type AutomationRepositoryOptions,
	type AutomationState,
} from './types.js';

const DEFAULT_MAX_AUTOMATIONS = 1024;
const MAX_REMEMBERED_OUTCOMES = 1024;

/** Durable, revisioned, server-owned automation definitions. Mirrors the
 * macro repository envelope: `commandId` idempotency and `expectedRevision`
 * conflicts. */
export class AutomationRepository {
	private current: AutomationState | undefined;
	private loading: Promise<AutomationState> | undefined;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly outcomes = new Map<string, AutomationApplyResult>();
	private readonly listeners = new Set<(state: AutomationState) => void>();
	private readonly now: () => number;
	private readonly validateCron: AutomationCronValidator;
	private readonly resolveMacro: AutomationMacroResolver | undefined;
	private readonly generateId: () => string;
	private readonly maxAutomations: number;

	constructor(
		private readonly backend: AutomationBackend,
		options: AutomationRepositoryOptions = {},
	) {
		this.now = options.now ?? Date.now;
		this.validateCron = options.validateCron ?? cronValidator;
		this.resolveMacro = options.resolveMacro;
		this.generateId = options.generateId ?? (() => crypto.randomUUID());
		this.maxAutomations = options.maxAutomations ?? DEFAULT_MAX_AUTOMATIONS;
	}

	async load(): Promise<AutomationState> {
		if (this.current !== undefined) return clone(this.current);
		this.loading ??= this.loadFromBackend();
		return clone(await this.loading);
	}

	get state(): AutomationState {
		if (this.current === undefined)
			throw new Error('automation repository is not loaded');
		return clone(this.current);
	}

	get revision(): number {
		return this.state.revision;
	}

	find(automationId: string): AutomationDefinition | undefined {
		const found = this.current?.automations.find(
			(candidate) => candidate.id === automationId,
		);
		return found === undefined ? undefined : clone(found);
	}

	/** Observes committed definition changes (not `evaluatedThrough`). */
	subscribe(listener: (state: AutomationState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	apply(envelope: AutomationCommandEnvelope): Promise<AutomationApplyResult> {
		return this.serialize(() => this.applyNow(envelope));
	}

	upsert(
		automation: unknown,
		expectedRevision?: number,
		commandId?: string,
	): Promise<AutomationApplyResult> {
		return this.apply({
			commandId,
			expectedRevision,
			command: { type: 'upsert', automation },
		});
	}

	remove(
		automationId: string,
		expectedRevision?: number,
		commandId?: string,
	): Promise<AutomationApplyResult> {
		return this.apply({
			commandId,
			expectedRevision,
			command: { type: 'remove', automationId },
		});
	}

	setEnabled(
		automationId: string,
		enabled: boolean,
		expectedRevision?: number,
		commandId?: string,
	): Promise<AutomationApplyResult> {
		return this.apply({
			commandId,
			expectedRevision,
			command: { type: 'setEnabled', automationId, enabled },
		});
	}

	/** Server-maintained schedule progress. Persisted, but it neither advances
	 * the revision nor notifies subscribers, so a ticking schedule never makes
	 * a client's edit conflict. It only moves forward. */
	markEvaluated(automationId: string, through: number): Promise<void> {
		return this.serialize(async () => {
			const current = this.current ?? (await this.load());
			let changed = false;
			const automations = current.automations.map((automation) => {
				if (
					automation.id !== automationId ||
					automation.evaluatedThrough >= through
				)
					return automation;
				changed = true;
				return { ...automation, evaluatedThrough: through };
			});
			if (!changed) return;
			const next = { ...current, automations };
			await this.backend.commit(clone(next));
			this.current = next;
		});
	}

	private async loadFromBackend(): Promise<AutomationState> {
		const raw = await this.backend.load();
		const { state, dropped } = this.normalizeState(raw);
		if (raw !== undefined && (dropped || !sameJson(raw, state))) {
			if (this.backend.backup !== undefined && dropped)
				await this.backend.backup(clone(state));
			await this.backend.commit(clone(state));
		}
		this.current = state;
		return state;
	}

	private normalizeState(raw: unknown): {
		readonly state: AutomationState;
		readonly dropped: boolean;
	} {
		const record =
			typeof raw === 'object' && raw !== null && !Array.isArray(raw)
				? (raw as Record<string, unknown>)
				: {};
		const revision =
			typeof record.revision === 'number' &&
			Number.isSafeInteger(record.revision) &&
			record.revision >= 0
				? record.revision
				: 0;
		const rawAutomations = Array.isArray(record.automations)
			? record.automations
			: [];
		const now = this.now();
		const automations: AutomationDefinition[] = [];
		const ids = new Set<string>();
		let dropped = false;
		for (const candidate of rawAutomations.slice(0, this.maxAutomations)) {
			try {
				const automation = normalizePersistedAutomation(
					candidate,
					this.validateCron,
					now,
				);
				if (ids.has(automation.id)) {
					dropped = true;
					continue;
				}
				ids.add(automation.id);
				automations.push(automation);
			} catch {
				dropped = true;
			}
		}
		if (rawAutomations.length > this.maxAutomations) dropped = true;
		return {
			state: {
				schemaVersion: AUTOMATION_SCHEMA_VERSION,
				revision,
				cursor: String(revision),
				automations,
			},
			dropped,
		};
	}

	private async applyNow(
		envelope: AutomationCommandEnvelope,
	): Promise<AutomationApplyResult> {
		const current = this.current ?? (await this.load());
		if (envelope.commandId !== undefined) {
			const previous = this.outcomes.get(envelope.commandId);
			if (previous !== undefined) return clone(previous);
		}
		if (
			envelope.expectedRevision !== undefined &&
			envelope.expectedRevision !== current.revision
		) {
			const conflict: AutomationApplyResult = {
				ok: false,
				conflict: {
					code: 'conflict',
					currentRevision: current.revision,
					currentCursor: current.cursor,
					message: 'automation revision is stale',
				},
			};
			this.remember(envelope.commandId, conflict);
			return clone(conflict);
		}

		let automations: readonly AutomationDefinition[];
		const command = envelope.command;
		switch (command.type) {
			case 'upsert': {
				const candidateId = idOf(command.automation);
				const existing =
					candidateId === undefined
						? undefined
						: current.automations.find((item) => item.id === candidateId);
				const automation = normalizeAutomation(command.automation, {
					...(existing === undefined ? {} : { existing }),
					now: this.now(),
					generateId: this.generateId,
					validateCron: this.validateCron,
				});
				await this.assertMacroFields(automation);
				const index = current.automations.findIndex(
					(item) => item.id === automation.id,
				);
				if (index === -1) {
					if (current.automations.length >= this.maxAutomations)
						throw new AutomationServiceError(
							'limit',
							'automation count exceeds the limit',
						);
					automations = [...current.automations, automation];
				} else {
					automations = current.automations.map((item, position) =>
						position === index ? automation : item,
					);
				}
				break;
			}
			case 'remove':
				if (!current.automations.some((item) => item.id === command.automationId))
					throw new AutomationServiceError(
						'automation_not_found',
						'automation is unavailable',
					);
				automations = current.automations.filter(
					(item) => item.id !== command.automationId,
				);
				break;
			case 'setEnabled': {
				if (typeof command.enabled !== 'boolean')
					throw new AutomationServiceError(
						'invalid_automation',
						'automation enabled must be true or false',
						{ field: 'enabled' },
					);
				const existing = current.automations.find(
					(item) => item.id === command.automationId,
				);
				if (existing === undefined)
					throw new AutomationServiceError(
						'automation_not_found',
						'automation is unavailable',
					);
				const now = this.now();
				automations = current.automations.map((item) =>
					item.id !== command.automationId || item.enabled === command.enabled
						? item
						: {
								...item,
								enabled: command.enabled,
								// Occurrences while disabled are neither run nor missed.
								evaluatedThrough: command.enabled
									? Math.max(item.evaluatedThrough, now)
									: item.evaluatedThrough,
							},
				);
				break;
			}
			default:
				throw new AutomationServiceError(
					'invalid_automation',
					'unknown automation command',
				);
		}
		const next: AutomationState = {
			schemaVersion: AUTOMATION_SCHEMA_VERSION,
			revision: current.revision + 1,
			cursor: String(current.revision + 1),
			automations: clone(automations),
		};
		await this.backend.commit(clone(next));
		this.current = next;
		const result: AutomationApplyResult = {
			ok: true,
			revision: next.revision,
			cursor: next.cursor,
			state: clone(next),
		};
		this.remember(envelope.commandId, result);
		for (const listener of [...this.listeners]) {
			try {
				listener(clone(next));
			} catch {
				// A failing observer never undoes a committed change.
			}
		}
		return clone(result);
	}

	private async assertMacroFields(
		automation: AutomationDefinition,
	): Promise<void> {
		const action = automation.action;
		if (action.kind !== 'runMacro' || this.resolveMacro === undefined) return;
		const macro = await this.resolveMacro(action.macroId);
		if (macro === undefined)
			throw new AutomationServiceError(
				'invalid_automation',
				'automation macro is unavailable',
				{ field: 'action.macroId' },
			);
		for (const field of macro.fields) {
			if (!field.required) continue;
			const supplied = action.fieldValues[field.name] ?? field.defaultValue;
			if (supplied === undefined || supplied === '')
				throw new AutomationServiceError(
					'invalid_automation',
					`automation macro field "${field.name}" has no value`,
					{ field: 'action.fieldValues', name: field.name },
				);
		}
	}

	private remember(
		commandId: string | undefined,
		result: AutomationApplyResult,
	): void {
		if (commandId === undefined) return;
		this.outcomes.set(commandId, result);
		if (this.outcomes.size > MAX_REMEMBERED_OUTCOMES) {
			const oldest = this.outcomes.keys().next().value;
			if (oldest !== undefined) this.outcomes.delete(oldest);
		}
	}

	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.queue.then(operation, operation);
		this.queue = next.catch(() => undefined);
		return next;
	}
}

function idOf(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return undefined;
	const id = (value as Record<string, unknown>).id;
	return typeof id === 'string' ? id : undefined;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function sameJson(left: unknown, right: unknown): boolean {
	try {
		return JSON.stringify(left) === JSON.stringify(right);
	} catch {
		return false;
	}
}
