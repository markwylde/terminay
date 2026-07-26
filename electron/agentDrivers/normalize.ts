import type {
	AgentCompletionOutcome,
	AgentLifecycleEvent,
	AgentModelMetadata,
	AgentProvider,
	AgentToolOutcome,
} from '../../src/types/agentStatus';
import { isPlainObject } from './managedHooks';
import type { AgentDriverContext } from './types';

const INTERACTIVE_TOOL_NAMES = new Set([
	'askuserquestion',
	'request_user_input',
	'requestuserinput',
]);

export interface NormalizedNativeHook {
	payload: Record<string, unknown>;
	eventName: string;
	sessionId: string;
	agentId?: string;
	subagentId?: string;
	parentAgentId?: string;
	toolName?: string;
	toolId?: string;
	reason?: string;
	summary?: string;
}

export function prepareNativeHook(
	nativePayload: unknown,
	context: AgentDriverContext,
): NormalizedNativeHook | null {
	if (!isPlainObject(nativePayload)) {
		return null;
	}

	const eventName = firstString(
		nativePayload.hook_event_name,
		nativePayload.hookEventName,
		nativePayload.event_name,
		nativePayload.event,
		nativePayload.type,
	);
	if (!eventName) {
		return null;
	}

	const sessionId =
		boundedFirstString(
			512,
			nativePayload.session_id,
			nativePayload.sessionId,
			nativePayload.thread_id,
			nativePayload.threadId,
			context.providerSessionId,
		) ?? context.activationTerminalSessionId;
	const rawAgentId = boundedFirstString(
		512,
		nativePayload.agent_id,
		nativePayload.agentId,
	);
	const agentId =
		rawAgentId && rawAgentId !== sessionId ? rawAgentId : undefined;
	const subagentId =
		boundedFirstString(
			512,
			nativePayload.subagent_id,
			nativePayload.subagentId,
			nativePayload.agent_id,
			nativePayload.agentId,
		) ?? undefined;
	const toolName = boundedFirstString(
		200,
		nativePayload.tool_name,
		nativePayload.toolName,
		getNestedString(nativePayload.tool, 'name'),
	);
	const toolId =
		boundedFirstString(
			512,
			nativePayload.tool_use_id,
			nativePayload.toolUseId,
			nativePayload.tool_call_id,
			nativePayload.toolCallId,
			getNestedString(nativePayload.tool, 'id'),
		) ?? toolName;

	return {
		payload: nativePayload,
		eventName,
		sessionId,
		agentId,
		subagentId,
		parentAgentId: boundedFirstString(
			512,
			nativePayload.parent_agent_id,
			nativePayload.parentAgentId,
		),
		toolName,
		toolId,
		reason: boundedFirstString(
			4_000,
			nativePayload.reason,
			nativePayload.message,
			nativePayload.error,
		),
		summary: boundedFirstString(
			8_000,
			nativePayload.last_assistant_message,
			nativePayload.lastAssistantMessage,
			nativePayload.summary,
		),
	};
}

export function normalizePreparedHook(
	provider: AgentProvider,
	native: NormalizedNativeHook,
	context: AgentDriverContext,
): AgentLifecycleEvent | null {
	const promptText = extractPrompt(native.payload);
	const model = extractModel(native.payload);
	const base = {
		provider,
		sessionId: native.sessionId,
		activationTerminalSessionId: context.activationTerminalSessionId,
		sequence: context.sequence,
		occurredAt: context.occurredAt ?? Date.now(),
		...(promptText ? { promptText } : {}),
		...(model ? { model } : {}),
	} as const;
	const eventKey = canonicalEventKey(native.eventName);
	const target = native.agentId ? { agentId: native.agentId } : {};

	if (isSessionStart(eventKey)) {
		return {
			...base,
			kind: 'session.started',
			displayName: boundedFirstString(
				200,
				native.payload.display_name,
				native.payload.displayName,
			),
		};
	}
	if (isSessionStop(eventKey)) {
		return { ...base, kind: 'session.stopped', reason: native.reason };
	}
	if (isSubagentStart(eventKey)) {
		if (!native.subagentId) {
			return null;
		}
		return {
			...base,
			kind: 'subagent.started',
			subagentId: native.subagentId,
			parentAgentId: native.parentAgentId,
			displayName: boundedFirstString(
				200,
				native.payload.agent_type,
				native.payload.agentType,
				native.payload.display_name,
				native.payload.displayName,
			),
		};
	}
	if (isSubagentStop(eventKey)) {
		if (!native.subagentId) {
			return null;
		}
		return {
			...base,
			kind: 'subagent.stopped',
			subagentId: native.subagentId,
			outcome: completionOutcome(native.payload),
			summary: native.summary,
		};
	}
	if (isPermissionRequest(eventKey) || isInteractiveTool(native.toolName)) {
		return {
			...base,
			...target,
			kind: 'wait.started',
			state: 'waiting',
			reason: native.reason ?? native.toolName,
		};
	}
	if (isPrompt(eventKey)) {
		return {
			...base,
			...target,
			kind: 'turn.started',
			turnId: boundedFirstString(
				512,
				native.payload.turn_id,
				native.payload.turnId,
			),
		};
	}
	if (isToolStart(eventKey)) {
		if (!native.toolName) {
			return null;
		}
		const subagentLaunch = extractSubagentLaunch(
			native.toolName,
			native.payload.tool_input,
		);
		return {
			...base,
			...target,
			kind: 'tool.started',
			tool: {
				id: native.toolId ?? native.toolName,
				name: native.toolName,
				description: describeToolInput(native.payload.tool_input),
				...(subagentLaunch ? { subagentLaunch } : {}),
			},
		};
	}
	if (isToolFinish(eventKey)) {
		if (!native.toolId) {
			return null;
		}
		return {
			...base,
			...target,
			kind: 'tool.finished',
			toolId: native.toolId,
			outcome: toolOutcome(eventKey),
		};
	}
	if (isStop(eventKey)) {
		return {
			...base,
			...target,
			kind: 'agent.done',
			outcome: completionOutcome(native.payload),
			summary: native.summary,
		};
	}
	if (isAgentExit(eventKey)) {
		return {
			...base,
			...target,
			kind: 'agent.exited',
			exitCode: finiteNumber(native.payload.exit_code, native.payload.exitCode),
			signal: boundedFirstString(100, native.payload.signal),
		};
	}
	return null;
}

function canonicalEventKey(eventName: string): string {
	return eventName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSessionStart(key: string): boolean {
	return key === 'sessionstart' || key === 'sessionstarted';
}

function isSessionStop(key: string): boolean {
	return (
		key === 'sessionend' || key === 'sessionstop' || key === 'sessionstopped'
	);
}

function isPrompt(key: string): boolean {
	return (
		key === 'userpromptsubmit' ||
		key === 'prompt' ||
		key === 'promptsubmit' ||
		key === 'turnstart' ||
		key === 'turnstarted'
	);
}

function isToolStart(key: string): boolean {
	return (
		key === 'pretooluse' ||
		key === 'toolstart' ||
		key === 'toolstarted' ||
		key === 'beforetool'
	);
}

function isToolFinish(key: string): boolean {
	return (
		key === 'posttooluse' ||
		key === 'posttoolusefailure' ||
		key === 'toolfinish' ||
		key === 'toolfinished' ||
		key === 'aftertool'
	);
}

function isPermissionRequest(key: string): boolean {
	return (
		key === 'permissionrequest' ||
		key === 'requestuserinput' ||
		key === 'askuserquestion'
	);
}

function isStop(key: string): boolean {
	return (
		key === 'stop' ||
		key === 'stopfailure' ||
		key === 'turndone' ||
		key === 'turncompleted'
	);
}

function isSubagentStart(key: string): boolean {
	return key === 'subagentstart' || key === 'subagentstarted';
}

function isSubagentStop(key: string): boolean {
	return key === 'subagentstop' || key === 'subagentstopped';
}

function isAgentExit(key: string): boolean {
	return key === 'agentexit' || key === 'agentexited';
}

function isInteractiveTool(toolName: string | undefined): boolean {
	return Boolean(
		toolName &&
			INTERACTIVE_TOOL_NAMES.has(
				toolName.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase(),
			),
	);
}

function completionOutcome(
	payload: Record<string, unknown>,
): AgentCompletionOutcome | undefined {
	const key = canonicalEventKey(
		firstString(payload.hook_event_name, payload.event, payload.type) ?? '',
	);
	if (
		key.includes('failure') ||
		payload.error !== undefined ||
		payload.success === false
	) {
		return 'error';
	}
	if (payload.cancelled === true || payload.canceled === true) {
		return 'cancelled';
	}
	return 'success';
}

function toolOutcome(eventKey: string): AgentToolOutcome {
	return eventKey.includes('failure') ? 'error' : 'success';
}

function describeToolInput(value: unknown): string | undefined {
	if (typeof value === 'string') {
		return value.slice(0, 500);
	}
	if (!isPlainObject(value)) {
		return undefined;
	}
	return firstString(
		value.command,
		value.cmd,
		value.file_path,
		value.path,
		value.query,
		value.message,
		value.prompt,
		value.description,
	)?.slice(0, 500);
}

function extractSubagentLaunch(
	toolName: string,
	toolInput: unknown,
):
	| {
			displayName?: string;
			promptText?: string;
	  }
	| undefined {
	const key = canonicalEventKey(toolName);
	if (
		key !== 'agent' &&
		key !== 'task' &&
		key !== 'spawnagent' &&
		!key.endsWith('spawnagent')
	) {
		return undefined;
	}
	if (!isPlainObject(toolInput)) {
		return {};
	}

	const displayName = boundedFirstString(
		200,
		toolInput.task_name,
		toolInput.taskName,
		toolInput.name,
		toolInput.agent_type,
		toolInput.agentType,
	);
	const promptText = boundedFirstString(
		4_000,
		toolInput.message,
		toolInput.prompt,
		toolInput.description,
		toolInput.task,
	);
	return {
		...(displayName ? { displayName } : {}),
		...(promptText ? { promptText } : {}),
	};
}

function extractPrompt(payload: Record<string, unknown>): string | undefined {
	return firstString(
		payload.prompt,
		payload.prompt_text,
		payload.promptText,
		payload.user_prompt,
		payload.userPrompt,
	)?.slice(0, 4_000);
}

function extractModel(
	payload: Record<string, unknown>,
): AgentModelMetadata | undefined {
	const value = payload.model;
	if (typeof value === 'string' && value.trim()) {
		return { id: value.trim().slice(0, 200) };
	}
	if (!isPlainObject(value)) {
		return undefined;
	}
	const id = firstString(value.id, value.model_id, value.modelId, value.name);
	if (!id) {
		return undefined;
	}
	const contextWindowTokens = finiteNumber(
		value.context_window_tokens,
		value.contextWindowTokens,
	);
	return {
		id: id.slice(0, 200),
		displayName: firstString(value.display_name, value.displayName)?.slice(
			0,
			200,
		),
		reasoningEffort: firstString(
			value.reasoning_effort,
			value.reasoningEffort,
		)?.slice(0, 100),
		contextWindowTokens:
			contextWindowTokens !== undefined && contextWindowTokens >= 0
				? contextWindowTokens
				: undefined,
	};
}

function getNestedString(value: unknown, key: string): string | undefined {
	return isPlainObject(value) ? firstString(value[key]) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function boundedFirstString(
	maxLength: number,
	...values: unknown[]
): string | undefined {
	return firstString(...values)?.slice(0, maxLength);
}

function finiteNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			return value;
		}
	}
	return undefined;
}
