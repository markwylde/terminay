import type { BotActionTarget } from '@terminay/protocol';
import { describeBotAction } from '@terminay/server-core';
import type {
	ControlDispatcher,
	ControlDispatchResult,
	ControlRequestContext,
} from './controlEndpoint.js';

/**
 * The Terminay MCP operations a bot execution's call is recorded for in its
 * chat (ADR-0134). An explicit list: a new operation records nothing until it
 * is added here with its wording.
 */
export const BOT_ACTION_OPERATIONS: ReadonlySet<string> = new Set([
	'open_terminal',
	'split_terminal',
	'write_terminal',
	'run_command',
	'close_terminal',
	'focus_terminal',
	'rename_terminal',
	'update_terminal',
	'move_terminal_to_project',
	'run_macro',
	'cancel_macro',
	'focus_tab',
	'move_tab',
	'resize_pane',
	'arrange_tabs',
	'close_tab',
	'focus_home',
	'select_folder',
	'create_folder',
	'rename_folder',
	'delete_folder',
	'reorder_folders',
	'move_tab_to_folder',
	'open_file',
	'create_project',
	'update_project',
	'move_project',
	'close_project',
	'focus_project',
	'open_workspace_window',
	'rename_workspace_window',
	'close_workspace_window',
	'create_workflow',
	'update_workflow_step',
	'create_workflow_template',
	'update_workflow_template',
	'delete_workflow_template',
	'create_automation',
	'update_automation',
	'delete_automation',
	'set_automation_enabled',
	'run_automation',
	'stop_automation_run',
	'remove_automation_run',
	'prune_automation_runs',
	'dismiss_missed_runs',
	'update_settings',
	'save_shell_profile',
	'delete_shell_profile',
	'reorder_shell_profiles',
	'set_default_shell_profile',
]);

/** Ops whose `terminal` parameter is the terminal they act on and link to. */
const TERMINAL_TARGET = new Set([
	'write_terminal',
	'run_command',
	'focus_terminal',
	'rename_terminal',
	'update_terminal',
	'move_terminal_to_project',
	'run_macro',
]);
/** Ops whose terminal is named only for the description. */
const TERMINAL_NAMED = new Set([
	...TERMINAL_TARGET,
	'split_terminal',
	'close_terminal',
	'create_workflow',
	'update_workflow_step',
]);
const WORKFLOW_TARGET = new Set(['create_workflow', 'update_workflow_step']);
const PROJECT_TARGET = new Set([
	'update_project',
	'move_project',
	'focus_project',
]);
const PROJECT_NAMED = new Set([...PROJECT_TARGET, 'close_project']);
const AUTOMATION_TARGET = new Set([
	'update_automation',
	'set_automation_enabled',
	'run_automation',
	'stop_automation_run',
]);
const SETTINGS_TARGET = new Set([
	'update_settings',
	'save_shell_profile',
	'reorder_shell_profiles',
	'set_default_shell_profile',
]);

export interface BotActionResolvedTerminal {
	readonly sessionId: string;
	readonly title?: string;
}

export interface BotActionDeps {
	/** The bot's message-log epoch now, or undefined if unknown. */
	epoch(botId: string): string | undefined;
	/** A terminal reference the caller can address, as its session. */
	terminal(
		context: ControlRequestContext,
		reference: string,
	): BotActionResolvedTerminal | undefined;
	/** The project a live terminal session is in now. */
	sessionProject(sessionId: string): string | undefined;
	/** A project handle as a project ID and display name. */
	project(handle: string):
		| { readonly projectId: string; readonly name?: string }
		| undefined;
	record(
		botId: string,
		executionId: string,
		action: {
			readonly text: string;
			readonly tool: string;
			readonly outcome: 'done' | 'failed';
			readonly reason?: string;
			readonly target?: BotActionTarget;
		},
		epoch: string | undefined,
	): Promise<unknown>;
	/** Defer recording past the tool's response. Defaults to setImmediate. */
	defer?: (work: () => void) => void;
	onError?: (error: unknown) => void;
}

type Outcome =
	| { readonly outcome: 'done'; readonly result: unknown }
	| { readonly outcome: 'failed'; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorReason(error: unknown): string {
	if (isRecord(error)) {
		const code = typeof error.code === 'string' ? error.code : 'internal';
		const message =
			typeof error.message === 'string' ? error.message : 'The call failed.';
		return `${code}: ${message}`;
	}
	return `internal: ${String(error)}`;
}

/** A dispatcher result as done with its result, or failed with a reason. */
export function normalizeDispatchResult(value: ControlDispatchResult): Outcome {
	if (isRecord(value) && value.ok === false && 'error' in value)
		return { outcome: 'failed', reason: errorReason(value.error) };
	if (isRecord(value) && value.ok === true && 'result' in value)
		return { outcome: 'done', result: value.result };
	return { outcome: 'done', result: value };
}

const str = (value: unknown): string | undefined =>
	typeof value === 'string' && value !== '' ? value : undefined;

/**
 * Wrap the control dispatcher so each recorded call a bot execution makes is
 * written to its chat once the handler has finished, after the response
 * (ADR-0134). Calls from terminals and chats pass straight through.
 */
export function withBotActions(
	dispatch: ControlDispatcher,
	deps: BotActionDeps,
): ControlDispatcher {
	const defer = deps.defer ?? ((work) => void setImmediate(work));
	const report = deps.onError ?? (() => undefined);
	return async (request, context) => {
		const bot = context.bot;
		if (bot === undefined || !BOT_ACTION_OPERATIONS.has(request.op))
			return dispatch(request, context);
		const op = request.op;
		const params: Record<string, unknown> = isRecord(request.params)
			? request.params
			: {};
		// Before dispatch: close, rename and move still see the original.
		let epoch: string | undefined;
		let terminal: BotActionResolvedTerminal | undefined;
		let project: { projectId: string; name?: string } | undefined;
		try {
			epoch = deps.epoch(bot.botId);
			const reference = str(params.terminal);
			if (TERMINAL_NAMED.has(op) && reference !== undefined)
				terminal = deps.terminal(context, reference);
			const handle = str(params.project);
			if (PROJECT_NAMED.has(op) && handle !== undefined)
				project = deps.project(handle);
		} catch (error) {
			report(error);
		}
		let settled: Outcome;
		let value: ControlDispatchResult;
		try {
			value = await dispatch(request, context);
			settled = normalizeDispatchResult(value);
		} catch (error) {
			settled = { outcome: 'failed', reason: errorReason(error) };
			defer(() => record(settled));
			throw error;
		}
		defer(() => record(settled));
		return value;

		function record(outcome: Outcome): void {
			try {
				const result =
					outcome.outcome === 'done' && isRecord(outcome.result)
						? outcome.result
						: {};
				const target =
					outcome.outcome === 'done'
						? doneTarget(result)
						: failedTarget();
				const text = describeBotAction(op, params, outcome.outcome, {
					...(terminal?.title ? { terminal: terminal.title } : {}),
					...(project?.name ? { project: project.name } : {}),
				});
				void deps
					.record(
						bot!.botId,
						bot!.executionId,
						{
							text,
							tool: op,
							outcome: outcome.outcome,
							...(outcome.outcome === 'failed'
								? { reason: outcome.reason }
								: {}),
							...(target === undefined ? {} : { target }),
						},
						epoch,
					)
					.catch(report);
			} catch (error) {
				report(error);
			}
		}

		function terminalTarget(
			kind: 'terminal' | 'workflow',
			sessionId: string | undefined,
		): BotActionTarget | undefined {
			if (sessionId === undefined) return undefined;
			// The project it is in now, so a moved terminal links to its new one.
			const projectId = deps.sessionProject(sessionId);
			return projectId === undefined
				? undefined
				: { kind, projectId, sessionId };
		}

		/** A failed call links only to something that still exists. */
		function failedTarget(): BotActionTarget | undefined {
			if (TERMINAL_TARGET.has(op))
				return terminalTarget('terminal', terminal?.sessionId);
			if (WORKFLOW_TARGET.has(op))
				return terminalTarget('workflow', terminal?.sessionId);
			if (PROJECT_TARGET.has(op) && project !== undefined)
				return { kind: 'project', projectId: project.projectId };
			return undefined;
		}

		function doneTarget(
			result: Record<string, unknown>,
		): BotActionTarget | undefined {
			switch (op) {
				case 'create_project': {
					const handle = str(result.project);
					const created = handle === undefined ? undefined : deps.project(handle);
					return created === undefined
						? undefined
						: { kind: 'project', projectId: created.projectId };
				}
				case 'open_terminal':
				case 'split_terminal': {
					const reference = str(result.terminal);
					const opened =
						reference === undefined
							? undefined
							: deps.terminal(context, reference);
					return terminalTarget('terminal', opened?.sessionId);
				}
				case 'create_automation': {
					const automation = isRecord(result.automation)
						? str(result.automation.id)
						: undefined;
					return automation === undefined
						? undefined
						: { kind: 'automation', automationId: automation };
				}
				case 'create_workflow_template': {
					const template = isRecord(result.template)
						? str(result.template.id)
						: undefined;
					return template === undefined
						? undefined
						: { kind: 'workflowTemplate', templateId: template };
				}
				case 'update_workflow_template': {
					const template = str(params.template_id);
					return template === undefined
						? undefined
						: { kind: 'workflowTemplate', templateId: template };
				}
			}
			if (AUTOMATION_TARGET.has(op)) {
				const automation = str(params.automation_id);
				return automation === undefined
					? undefined
					: { kind: 'automation', automationId: automation };
			}
			if (SETTINGS_TARGET.has(op)) return { kind: 'settings' };
			return failedTarget();
		}
	};
}
