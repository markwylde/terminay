import { describeCron, localTimeZone, nextOccurrence } from '@terminay/cron';
import { AutomationServiceError } from './errors.js';
import { AUTOMATION_ID_PATTERN } from './normalize.js';
import type { McpApprovalDetail } from '../mcpApprovals/index.js';
import type { AutomationAuditRecord } from './protocol.js';
import type { AutomationRepository } from './repository.js';
import type { AutomationRunLog } from './runLog.js';
import type {
	AutomationAction,
	AutomationDefinition,
	AutomationEventKind,
	AutomationRunController,
	AutomationRunEntry,
	AutomationSubject,
	AutomationTrigger,
} from './types.js';

/**
 * MCP's route to automations (ADR-0031). It never goes through the client
 * wire operations, whose authority check refuses session- and project-bound
 * callers; the MCP permission gate has already allowed every call made here.
 * Results use the MCP tool surface's snake_case field names.
 */
export interface AutomationMcpOperations {
	list(): Promise<AutomationMcpList>;
	get(automationId: string): Promise<AutomationMcpDetail>;
	runs(
		automationId: string,
		limit: number,
		canSeeSubject: (subject: AutomationSubject) => boolean,
	): Promise<{ readonly runs: readonly AutomationMcpRun[] }>;
	/** Validates a create or update exactly as saving would, committing nothing. */
	preview(
		input: AutomationMcpDefinitionInput,
		automationId?: string,
	): Promise<AutomationDefinition>;
	create(
		input: AutomationMcpDefinitionInput,
		actor: AutomationMcpActor,
	): Promise<AutomationMcpDetail>;
	update(
		automationId: string,
		input: AutomationMcpDefinitionInput,
		expectedRevision: number,
		actor: AutomationMcpActor,
	): Promise<AutomationMcpDetail>;
	remove(
		automationId: string,
		expectedRevision: number | undefined,
		actor: AutomationMcpActor,
	): Promise<{ readonly revision: number; readonly deleted: string }>;
	setEnabled(
		automationId: string,
		enabled: boolean,
		expectedRevision: number | undefined,
		actor: AutomationMcpActor,
	): Promise<AutomationMcpDetail>;
	run(
		automationId: string,
		subject: AutomationSubject | undefined,
		actor: AutomationMcpActor,
	): Promise<AutomationMcpRun>;
	stop(
		runId: string,
		actor: AutomationMcpActor,
	): Promise<{ readonly run_id: string; readonly stopped: boolean }>;
	/**
	 * What an approval prompt shows for one request: a summary completing
	 * "<agent> in <terminal> wants to …" and every field it would apply.
	 * Refuses (throws) a request that could never succeed, so nobody is asked
	 * to approve it.
	 */
	describe(request: AutomationMcpDescribeRequest): Promise<AutomationMcpDescription>;
}

export type AutomationMcpDescribeRequest =
	| { readonly kind: 'create'; readonly input: AutomationMcpDefinitionInput }
	| {
			readonly kind: 'update';
			readonly automationId: string;
			readonly input: AutomationMcpDefinitionInput;
	  }
	| { readonly kind: 'delete'; readonly automationId: string }
	| {
			readonly kind: 'setEnabled';
			readonly automationId: string;
			readonly enabled: boolean;
	  }
	| {
			readonly kind: 'run';
			readonly automationId: string;
			readonly subjectTitle?: string;
	  }
	| { readonly kind: 'stop'; readonly runId: string };

export interface AutomationMcpDescription {
	readonly summary: string;
	readonly details: readonly McpApprovalDetail[];
}

/** The calling terminal, recorded for audit. Never a token. */
export interface AutomationMcpActor {
	readonly terminalSessionId: string;
}

/** The definition fields an MCP caller may set; the server owns the id. */
export interface AutomationMcpDefinitionInput {
	readonly name?: unknown;
	readonly enabled?: unknown;
	readonly trigger?: unknown;
	readonly action?: unknown;
	readonly settings?: unknown;
}

export interface AutomationMcpSummary {
	readonly id: string;
	readonly name: string;
	readonly enabled: boolean;
	readonly trigger: AutomationTrigger;
	readonly trigger_description: string;
	readonly action_kind: AutomationAction['kind'];
	readonly next_run_at?: string;
	readonly last_run?: {
		readonly status: AutomationRunEntry['status'];
		readonly outcome?: AutomationRunEntry['outcome'];
		readonly started_at: string;
	};
}

export interface AutomationMcpList {
	readonly revision: number;
	readonly time_zone: string;
	readonly automations: readonly AutomationMcpSummary[];
}

export interface AutomationMcpDetail {
	readonly revision: number;
	readonly time_zone: string;
	readonly automation: AutomationDefinitionView;
}

export type AutomationDefinitionView = Omit<
	AutomationDefinition,
	'evaluatedThrough'
> & { readonly trigger_description: string };

export interface AutomationMcpRun {
	readonly run_id: string;
	readonly automation_id: string;
	readonly started_by: AutomationRunEntry['startedBy'];
	readonly trigger_kind: AutomationRunEntry['triggerKind'];
	readonly event?: AutomationEventKind;
	readonly status: AutomationRunEntry['status'];
	readonly outcome?: AutomationRunEntry['outcome'];
	readonly skip_reason?: AutomationRunEntry['skipReason'];
	readonly reason?: string;
	readonly exit_code?: number;
	readonly fired_at: string;
	readonly started_at: string;
	readonly finished_at?: string;
	readonly duration_ms?: number;
	readonly subject?: AutomationSubject;
	readonly output_tail?: string;
}

export interface AutomationMcpOperationsOptions {
	readonly repository: AutomationRepository;
	readonly runLog: AutomationRunLog;
	readonly controller: AutomationRunController;
	readonly timeZone?: string;
	readonly now?: () => number;
	/** Called after a definition change or run request, for the audit trail. */
	readonly onAudit?: (record: AutomationAuditRecord) => void;
}

export const MAX_MCP_RUNS_PAGE = 50;

const EVENT_PHRASES: Readonly<Record<AutomationEventKind, string>> =
	Object.freeze({
		'agent.finished': 'When an agent finishes',
		'agent.needsInput': 'When an agent needs input',
		'agent.blocked': 'When an agent is blocked',
		'terminal.needsAttention': 'When a terminal needs attention',
		'terminal.commandFinished': 'When a command finishes',
		'terminal.idle': 'When a terminal goes idle',
		'project.opened': 'When a project opens',
		'project.closed': 'When a project closes',
		'device.connected': 'When a remote device connects',
	});

/** A trigger in plain words, as the Automations section shows it. */
export function describeAutomationTrigger(trigger: AutomationTrigger): string {
	if (trigger.kind === 'event') return EVENT_PHRASES[trigger.event];
	try {
		return describeCron(trigger.cron);
	} catch {
		return `On schedule ${trigger.cron}`;
	}
}

export function createAutomationMcpOperations(
	options: AutomationMcpOperationsOptions,
): AutomationMcpOperations {
	const { repository, runLog, controller } = options;
	const timeZone = options.timeZone ?? localTimeZone();
	const now = options.now ?? Date.now;

	const detail = async (automationId: string): Promise<AutomationMcpDetail> => {
		const state = await repository.load();
		const automation = state.automations.find((item) => item.id === automationId);
		if (automation === undefined) throw notFound();
		return { revision: state.revision, time_zone: timeZone, automation: view(automation) };
	};

	/** A create takes the input as the whole definition. An update takes each
	 * field the input omits from the current definition. */
	const definitionFrom = async (
		input: AutomationMcpDefinitionInput,
		automationId: string | undefined,
	): Promise<Record<string, unknown>> => {
		const record = asRecord(input);
		if (record === undefined)
			throw new AutomationServiceError('invalid_automation', 'automation must be an object');
		if ('id' in record)
			throw new AutomationServiceError(
				'invalid_automation',
				'the server assigns automation ids; pass automation_id to update one',
			);
		let existing: AutomationDefinition | undefined;
		if (automationId !== undefined) {
			await repository.load();
			existing = repository.find(automationId);
			if (existing === undefined) throw notFound();
		}
		const field = <K extends keyof AutomationMcpDefinitionInput>(key: K): unknown =>
			record[key] === undefined ? existing?.[key] : record[key];
		const enabled = field('enabled');
		const settings = field('settings');
		return {
			...(automationId === undefined ? {} : { id: automationId }),
			name: field('name'),
			...(enabled === undefined ? {} : { enabled }),
			trigger: field('trigger'),
			action: field('action'),
			...(settings === undefined ? {} : { settings }),
		};
	};

	const auditDefinition = (
		operation: string,
		automationId: string,
		revision: number,
		actor: AutomationMcpActor,
	): void =>
		options.onAudit?.({
			type: 'definition',
			operation: `mcp.${operation}`,
			automationId,
			revision,
			actor: mcpActor(actor),
		});
	const auditRun = (
		operation: string,
		automationId: string,
		runId: string,
		actor: AutomationMcpActor,
	): void =>
		options.onAudit?.({
			type: 'run',
			operation: `mcp.${operation}`,
			automationId,
			runId,
			actor: mcpActor(actor),
		});

	const operations: AutomationMcpOperations = {
		async list() {
			const state = await repository.load();
			await runLog.load();
			const at = now();
			return {
				revision: state.revision,
				time_zone: timeZone,
				automations: state.automations.map((automation) => {
					const next = nextRunAt(automation, at, timeZone);
					const last = runLog.list(automation.id).at(-1);
					return {
						id: automation.id,
						name: automation.name,
						enabled: automation.enabled,
						trigger: automation.trigger,
						trigger_description: describeAutomationTrigger(automation.trigger),
						action_kind: automation.action.kind,
						...(next === undefined ? {} : { next_run_at: iso(next) }),
						...(last === undefined
							? {}
							: {
									last_run: {
										status: last.status,
										...(last.outcome === undefined ? {} : { outcome: last.outcome }),
										started_at: iso(last.startedAt),
									},
								}),
					};
				}),
			};
		},

		get(automationId) {
			return detail(boundedId(automationId, 'automation id'));
		},

		async runs(automationId, limit, canSeeSubject) {
			const id = boundedId(automationId, 'automation id');
			await repository.load();
			if (repository.find(id) === undefined) throw notFound();
			await runLog.load();
			const page = Math.min(Math.max(1, Math.trunc(limit)), MAX_MCP_RUNS_PAGE);
			return {
				runs: runLog
					.list(id)
					.slice(-page)
					.reverse()
					.map((entry) => runView(entry, canSeeSubject)),
			};
		},

		async preview(input, automationId) {
			const id =
				automationId === undefined ? undefined : boundedId(automationId, 'automation id');
			return repository.preview(await definitionFrom(input, id));
		},

		async create(input, actor) {
			const result = await repository.upsert(await definitionFrom(input, undefined));
			if (!result.ok) throw conflict(result.conflict.message);
			const created = result.state.automations.at(-1);
			if (created === undefined) throw notFound();
			auditDefinition('create_automation', created.id, result.revision, actor);
			return { revision: result.revision, time_zone: timeZone, automation: view(created) };
		},

		async update(automationId, input, expectedRevision, actor) {
			const id = boundedId(automationId, 'automation id');
			const result = await repository.upsert(
				await definitionFrom(input, id),
				expectedRevision,
			);
			if (!result.ok) throw conflict(result.conflict.message);
			auditDefinition('update_automation', id, result.revision, actor);
			return detail(id);
		},

		async remove(automationId, expectedRevision, actor) {
			const id = boundedId(automationId, 'automation id');
			const result = await repository.remove(id, expectedRevision);
			if (!result.ok) throw conflict(result.conflict.message);
			// Runs in progress are not stopped; only the missed notice goes.
			await runLog.dismissMissed(id);
			auditDefinition('delete_automation', id, result.revision, actor);
			return { revision: result.revision, deleted: id };
		},

		async setEnabled(automationId, enabled, expectedRevision, actor) {
			const id = boundedId(automationId, 'automation id');
			const result = await repository.setEnabled(id, enabled, expectedRevision);
			if (!result.ok) throw conflict(result.conflict.message);
			auditDefinition('set_automation_enabled', id, result.revision, actor);
			return detail(id);
		},

		async run(automationId, subject, actor) {
			const id = boundedId(automationId, 'automation id');
			await repository.load();
			const automation = repository.find(id);
			if (automation === undefined) throw notFound();
			if (automation.action.kind !== 'runCommand' && subject?.kind !== 'terminal')
				throw new AutomationServiceError(
					'invalid_combination',
					'running this automation now needs a subject terminal',
					{ reason: 'a subject terminal is required' },
				);
			const entry = await controller.start({
				automation,
				startedBy: 'mcp',
				firedAt: now(),
				...(automation.trigger.kind === 'event' ? { event: automation.trigger.event } : {}),
				...(subject === undefined ? {} : { subject }),
				actor: mcpActor(actor),
			});
			await runLog.dismissMissed(id);
			auditRun('run_automation', id, entry.runId, actor);
			return runView(entry, () => true);
		},

		async stop(runId, actor) {
			const id = boundedId(runId, 'run id');
			await runLog.load();
			const entry = runLog.get(id);
			if (entry === undefined)
				throw new AutomationServiceError('run_not_found', 'automation run is unavailable');
			const stopped = await controller.stop(id);
			auditRun('stop_automation_run', entry.automationId, id, actor);
			return { run_id: id, stopped };
		},

		async describe(request) {
			switch (request.kind) {
				case 'create': {
					const definition = await operations.preview(request.input);
					return {
						summary: `add the automation "${definition.name}", which runs ${lowerFirst(describeAutomationTrigger(definition.trigger))}`,
						details: definitionDetails(definition),
					};
				}
				case 'update': {
					const id = boundedId(request.automationId, 'automation id');
					const before = await existing(id);
					const after = await operations.preview(request.input, id);
					const changed = changedFields(before, after);
					return {
						summary: `change the automation "${before.name}"`,
						details: [
							{ label: 'Changes', value: changed.length === 0 ? 'Nothing' : changed.join(', ') },
							...definitionDetails(after),
						],
					};
				}
				case 'delete': {
					const definition = await existing(boundedId(request.automationId, 'automation id'));
					return {
						summary: `delete the automation "${definition.name}"`,
						details: definitionDetails(definition),
					};
				}
				case 'setEnabled': {
					const definition = await existing(boundedId(request.automationId, 'automation id'));
					return {
						summary: `${request.enabled ? 'enable' : 'disable'} the automation "${definition.name}"`,
						details: definitionDetails(definition),
					};
				}
				case 'run': {
					const definition = await existing(boundedId(request.automationId, 'automation id'));
					return {
						summary: `run the automation "${definition.name}" now${request.subjectTitle === undefined ? '' : ` on ${request.subjectTitle}`}`,
						details: definitionDetails(definition),
					};
				}
				case 'stop': {
					const id = boundedId(request.runId, 'run id');
					await runLog.load();
					const entry = runLog.get(id);
					if (entry === undefined)
						throw new AutomationServiceError('run_not_found', 'automation run is unavailable');
					await repository.load();
					const name = repository.find(entry.automationId)?.name ?? entry.automationId;
					return {
						summary: `stop a run of the automation "${name}"`,
						details: [
							{ label: 'Run started', value: iso(entry.startedAt) },
							{ label: 'Status', value: entry.status },
						],
					};
				}
			}
		},
	};
	return operations;

	async function existing(automationId: string): Promise<AutomationDefinition> {
		await repository.load();
		const definition = repository.find(automationId);
		if (definition === undefined) throw notFound();
		return definition;
	}
}

/** Every field of a definition, the command or text in full. */
function definitionDetails(definition: AutomationDefinition): McpApprovalDetail[] {
	const { trigger, action, settings } = definition;
	const lines: McpApprovalDetail[] = [
		{ label: 'Name', value: definition.name },
		{
			label: 'Trigger',
			value:
				trigger.kind === 'schedule'
					? `${describeAutomationTrigger(trigger)} (${trigger.cron})`
					: describeAutomationTrigger(trigger),
		},
	];
	switch (action.kind) {
		case 'runCommand':
			lines.push(
				{ label: 'Runs', value: action.command, code: true },
				{ label: 'Working directory', value: action.cwd ?? 'Home directory' },
				{ label: 'Stops after', value: `${action.maxDurationSeconds} seconds` },
			);
			if (action.shellProfileId !== undefined)
				lines.push({ label: 'Shell profile', value: action.shellProfileId });
			break;
		case 'runMacro':
			lines.push({ label: 'Runs Macro', value: action.macroId });
			for (const [field, value] of Object.entries(action.fieldValues))
				lines.push({ label: `Macro field ${field}`, value: String(value), code: true });
			break;
		case 'writeText':
			lines.push({
				label: action.submit ? 'Types and submits' : 'Types',
				value: action.text,
				code: true,
			});
			break;
	}
	lines.push(
		{ label: 'Enabled', value: definition.enabled ? 'Yes' : 'No' },
		{ label: 'Keep terminal after run', value: settings.keepTerminalAfterRun ? 'Yes' : 'No' },
		{ label: 'Record session', value: settings.recordSession ? 'Yes' : 'No' },
		{ label: 'Cooldown', value: `${settings.cooldownSeconds} seconds` },
	);
	return lines;
}

function changedFields(
	before: AutomationDefinition,
	after: AutomationDefinition,
): string[] {
	const labels: Record<'name' | 'enabled' | 'trigger' | 'action' | 'settings', string> = {
		name: 'name',
		enabled: 'enabled',
		trigger: 'trigger',
		action: 'action',
		settings: 'settings',
	};
	return (Object.keys(labels) as (keyof typeof labels)[])
		.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
		.map((key) => labels[key]);
}

function lowerFirst(value: string): string {
	return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`;
}

/** How an MCP caller appears in the audit trail: never a client identity. */
function mcpActor(actor: AutomationMcpActor) {
	return { clientId: 'mcp', connectionId: `mcp:${actor.terminalSessionId}` };
}

function view(automation: AutomationDefinition): AutomationDefinitionView {
	const { evaluatedThrough: _evaluatedThrough, ...definition } = automation;
	return {
		...definition,
		trigger_description: describeAutomationTrigger(automation.trigger),
	};
}

function runView(
	entry: AutomationRunEntry,
	canSeeSubject: (subject: AutomationSubject) => boolean,
): AutomationMcpRun {
	// A subject outside the caller's reach hides the subject and the output
	// tail, which may show another project's terminal.
	const visible = entry.subject === undefined || canSeeSubject(entry.subject);
	return {
		run_id: entry.runId,
		automation_id: entry.automationId,
		started_by: entry.startedBy,
		trigger_kind: entry.triggerKind,
		...(entry.event === undefined ? {} : { event: entry.event }),
		status: entry.status,
		...(entry.outcome === undefined ? {} : { outcome: entry.outcome }),
		...(entry.skipReason === undefined ? {} : { skip_reason: entry.skipReason }),
		...(entry.reason === undefined || !visible ? {} : { reason: entry.reason }),
		...(entry.exitCode === undefined ? {} : { exit_code: entry.exitCode }),
		fired_at: iso(entry.firedAt),
		started_at: iso(entry.startedAt),
		...(entry.finishedAt === undefined ? {} : { finished_at: iso(entry.finishedAt) }),
		...(entry.durationMs === undefined ? {} : { duration_ms: entry.durationMs }),
		...(entry.subject === undefined || !visible ? {} : { subject: entry.subject }),
		...(entry.outputTail === undefined || !visible
			? {}
			: { output_tail: entry.outputTail }),
	};
}

function nextRunAt(
	automation: AutomationDefinition,
	at: number,
	timeZone: string,
): number | undefined {
	if (!automation.enabled || automation.trigger.kind !== 'schedule') return undefined;
	try {
		return nextOccurrence(automation.trigger.cron, new Date(at), timeZone)?.getTime();
	} catch {
		return undefined;
	}
}

function iso(epochMs: number): string {
	return new Date(epochMs).toISOString();
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !AUTOMATION_ID_PATTERN.test(value))
		throw new AutomationServiceError('invalid_automation', `${name} is invalid`);
	return value;
}

function notFound(): AutomationServiceError {
	return new AutomationServiceError('automation_not_found', 'automation is unavailable');
}

function conflict(message: string): AutomationServiceError {
	return new AutomationServiceError('conflict', message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
