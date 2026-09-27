import type { AutomationEventKind } from '@terminay/server-core';
import type { ControlError, ControlRequestContext } from './controlEndpoint.js';

/**
 * Parameter contracts for the MCP automation tools (ADR-0031). Automations
 * are server-wide, so no parameter names a project; a subject terminal is an
 * opaque handle the caller could already address with its own reach.
 * Definitions are validated by the automation service itself, exactly as the
 * Automations section's saves are.
 */

export interface AutomationIdParams {
	readonly automationId: string;
}
export interface ListAutomationRunsParams {
	readonly automationId: string;
	readonly limit: number;
}
export interface AutomationDefinitionParams {
	readonly name?: unknown;
	readonly enabled?: unknown;
	readonly trigger?: unknown;
	readonly action?: unknown;
	readonly settings?: unknown;
}
export interface CreateAutomationParams {
	readonly definition: AutomationDefinitionParams;
}
export interface UpdateAutomationParams {
	readonly automationId: string;
	readonly revision: number;
	readonly definition: AutomationDefinitionParams;
}
export interface DeleteAutomationParams {
	readonly automationId: string;
	readonly revision?: number;
}
export interface SetAutomationEnabledParams {
	readonly automationId: string;
	readonly enabled: boolean;
	readonly revision?: number;
}
export interface RunAutomationParams {
	readonly automationId: string;
	/** Opaque terminal handle for a subject-terminal action. */
	readonly terminal?: string;
}
export interface StopAutomationRunParams {
	readonly runId: string;
}

type Handler<P> = (
	params: P,
	context: ControlRequestContext,
	signal: AbortSignal,
) => unknown | Promise<unknown>;

/** Host binding for the automation tools; every method is already past the
 * MCP permission gate when it is called. */
export interface AutomationControlAdapter {
	readonly listAutomations: (
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	readonly getAutomation: Handler<AutomationIdParams>;
	readonly listAutomationRuns: Handler<ListAutomationRunsParams>;
	readonly createAutomation: Handler<CreateAutomationParams>;
	readonly updateAutomation: Handler<UpdateAutomationParams>;
	readonly deleteAutomation: Handler<DeleteAutomationParams>;
	readonly setAutomationEnabled: Handler<SetAutomationEnabledParams>;
	readonly runAutomation: Handler<RunAutomationParams>;
	readonly stopAutomationRun: Handler<StopAutomationRunParams>;
}

/** The Terminay events an automation can be triggered by. Kept free of a
 * runtime server-core import so the stdio entry stays small. */
export const MCP_AUTOMATION_EVENT_KINDS = [
	'agent.finished',
	'agent.needsInput',
	'agent.blocked',
	'terminal.needsAttention',
	'terminal.commandFinished',
	'terminal.idle',
	'project.opened',
	'project.closed',
	'device.connected',
] as const satisfies readonly AutomationEventKind[];

export const DEFAULT_AUTOMATION_RUNS_LIMIT = 20;
export const MAX_AUTOMATION_RUNS_LIMIT = 50;
const AUTOMATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_TERMINAL_REF_CHARS = 256;
const DEFINITION_KEYS = [
	'name',
	'enabled',
	'trigger',
	'action',
	'settings',
] as const;

type Failure = { readonly ok: false; readonly error: ControlError };
type Parsed<T> = T | Failure;

export function isAutomationParamFailure(value: unknown): value is Failure {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { ok?: unknown }).ok === false &&
		typeof (value as { error?: unknown }).error === 'object'
	);
}

export function parseAutomationId(
	params: Record<string, unknown>,
): Parsed<AutomationIdParams> {
	const automationId = id(params.automation_id, 'automation_id');
	return typeof automationId === 'string' ? { automationId } : automationId;
}

export function parseListAutomationRuns(
	params: Record<string, unknown>,
): Parsed<ListAutomationRunsParams> {
	const automationId = id(params.automation_id, 'automation_id');
	if (typeof automationId !== 'string') return automationId;
	const limit =
		params.limit === undefined ? DEFAULT_AUTOMATION_RUNS_LIMIT : params.limit;
	if (
		typeof limit !== 'number' ||
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > MAX_AUTOMATION_RUNS_LIMIT
	)
		return badRequest(
			`limit must be an integer from 1 to ${MAX_AUTOMATION_RUNS_LIMIT}`,
		);
	return { automationId, limit };
}

export function parseCreateAutomation(
	params: Record<string, unknown>,
): Parsed<CreateAutomationParams> {
	const extra = unexpectedKeys(params, DEFINITION_KEYS);
	if (extra !== undefined) return extra;
	for (const key of ['name', 'trigger', 'action'] as const)
		if (params[key] === undefined) return badRequest(`${key} is required`);
	return { definition: definitionOf(params) };
}

export function parseUpdateAutomation(
	params: Record<string, unknown>,
): Parsed<UpdateAutomationParams> {
	const extra = unexpectedKeys(params, [
		'automation_id',
		'revision',
		...DEFINITION_KEYS,
	]);
	if (extra !== undefined) return extra;
	const automationId = id(params.automation_id, 'automation_id');
	if (typeof automationId !== 'string') return automationId;
	const revision = requiredRevision(params.revision);
	if (typeof revision !== 'number') return revision;
	const definition = definitionOf(params);
	if (Object.keys(definition).length === 0)
		return badRequest('give at least one field to change');
	return { automationId, revision, definition };
}

export function parseDeleteAutomation(
	params: Record<string, unknown>,
): Parsed<DeleteAutomationParams> {
	const automationId = id(params.automation_id, 'automation_id');
	if (typeof automationId !== 'string') return automationId;
	const revision = optionalRevision(params.revision);
	if (isAutomationParamFailure(revision)) return revision;
	return {
		automationId,
		...(revision === undefined ? {} : { revision }),
	};
}

export function parseSetAutomationEnabled(
	params: Record<string, unknown>,
): Parsed<SetAutomationEnabledParams> {
	const automationId = id(params.automation_id, 'automation_id');
	if (typeof automationId !== 'string') return automationId;
	if (typeof params.enabled !== 'boolean')
		return badRequest('enabled must be true or false');
	const revision = optionalRevision(params.revision);
	if (isAutomationParamFailure(revision)) return revision;
	return {
		automationId,
		enabled: params.enabled,
		...(revision === undefined ? {} : { revision }),
	};
}

export function parseRunAutomation(
	params: Record<string, unknown>,
): Parsed<RunAutomationParams> {
	const automationId = id(params.automation_id, 'automation_id');
	if (typeof automationId !== 'string') return automationId;
	if (params.terminal === undefined) return { automationId };
	if (
		typeof params.terminal !== 'string' ||
		params.terminal.length === 0 ||
		params.terminal.length > MAX_TERMINAL_REF_CHARS
	)
		return badRequest('terminal must be a terminal handle');
	return { automationId, terminal: params.terminal };
}

export function parseStopAutomationRun(
	params: Record<string, unknown>,
): Parsed<StopAutomationRunParams> {
	const runId = id(params.run_id, 'run_id');
	return typeof runId === 'string' ? { runId } : runId;
}

function definitionOf(params: Record<string, unknown>): AutomationDefinitionParams {
	const definition: Record<string, unknown> = {};
	for (const key of DEFINITION_KEYS)
		if (params[key] !== undefined) definition[key] = params[key];
	return definition;
}

function unexpectedKeys(
	params: Record<string, unknown>,
	allowed: readonly string[],
): Failure | undefined {
	const unexpected = Object.keys(params).find((key) => !allowed.includes(key));
	return unexpected === undefined
		? undefined
		: badRequest(`unexpected parameter ${unexpected.slice(0, 64)}`);
}

function id(value: unknown, name: string): string | Failure {
	return typeof value === 'string' && AUTOMATION_ID_PATTERN.test(value)
		? value
		: badRequest(`${name} is invalid`);
}

function requiredRevision(value: unknown): number | Failure {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? value
		: badRequest(
				'revision is required: pass the revision from list_automations or get_automation',
			);
}

function optionalRevision(value: unknown): number | undefined | Failure {
	return value === undefined ? undefined : requiredRevision(value);
}

function badRequest(message: string): Failure {
	return { ok: false, error: { code: 'bad_request', message } };
}

const AUTOMATION_ERROR_CODES: Readonly<Record<string, ControlError['code']>> =
	Object.freeze({
		invalid_automation: 'bad_request',
		invalid_combination: 'bad_request',
		automation_not_found: 'not_found',
		run_not_found: 'not_found',
		conflict: 'conflict',
		limit: 'limit_exceeded',
		forbidden: 'forbidden',
		unavailable: 'unsupported_op',
	});

/**
 * An automation service failure as a public control error. Its messages name
 * the field at fault and never carry secrets, so they are kept (bounded);
 * anything else is left to the dispatcher's generic mapping.
 */
export function automationControlError(error: unknown): ControlError | undefined {
	if (!(error instanceof Error) || error.name !== 'AutomationServiceError')
		return undefined;
	const code = AUTOMATION_ERROR_CODES[(error as Error & { code?: string }).code ?? ''];
	return code === undefined
		? undefined
		: { code, message: error.message.slice(0, 1024) };
}
