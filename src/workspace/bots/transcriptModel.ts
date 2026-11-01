/**
 * A session's stored updates, folded into what Chat and Sessions show.
 *
 * The server stores the agent's ACP `session/update` payloads as they arrive,
 * plus a few records of its own (`kind: 'user' | 'permission-request' |
 * 'truncated'`). Message chunks are joined into one entry per run of text, a
 * tool call and its later updates become one entry, and the newest plan
 * replaces older ones. Anything unrecognised is skipped, so a newer agent can
 * never break the view.
 */

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type PlanStep = Readonly<{
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
}>;

export type TranscriptItem =
	| Readonly<{ kind: 'user'; key: string; text: string }>
	| Readonly<{ kind: 'agent'; key: string; text: string }>
	| Readonly<{ kind: 'thought'; key: string; text: string }>
	| Readonly<{
			kind: 'tool';
			key: string;
			toolCallId: string;
			title: string;
			toolKind: string;
			status: ToolStatus;
			input: string;
			output: string;
	  }>
	| Readonly<{ kind: 'plan'; key: string; steps: readonly PlanStep[] }>
	| Readonly<{ kind: 'permission'; key: string; title: string }>
	| Readonly<{ kind: 'truncated'; key: string }>;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** The text of an ACP content block or a list of them. */
export function contentText(content: unknown): string {
	if (Array.isArray(content)) return content.map(contentText).join('');
	const r = record(content);
	if (r === undefined) return '';
	if (r.type === 'text') return text(r.text);
	if (r.type === 'content') return contentText(r.content);
	if (r.type === 'diff') {
		const path = text(r.path);
		return path.length > 0 ? `Edited ${path}\n` : '';
	}
	if (r.type === 'terminal') return '';
	if (r.type === 'resource_link') return text(r.uri);
	if (r.type === 'resource') return text(record(r.resource)?.text);
	return '';
}

function inputText(raw: unknown): string {
	if (raw === undefined || raw === null) return '';
	const r = record(raw);
	if (r !== undefined && typeof r.command === 'string') return r.command;
	if (r !== undefined && Array.isArray(r.command))
		return r.command.map(String).join(' ');
	if (typeof raw === 'string') return raw;
	try {
		return JSON.stringify(raw, null, 2);
	} catch {
		return '';
	}
}

function toolStatus(value: unknown, fallback: ToolStatus): ToolStatus {
	return value === 'pending' ||
		value === 'in_progress' ||
		value === 'completed' ||
		value === 'failed'
		? value
		: fallback;
}

export function foldTranscript(
	updates: readonly unknown[],
): readonly TranscriptItem[] {
	const items: Mutable<TranscriptItem>[] = [];
	const tools = new Map<string, Mutable<TranscriptItem & { kind: 'tool' }>>();
	let plan: Mutable<TranscriptItem & { kind: 'plan' }> | undefined;
	const appendText = (kind: 'agent' | 'thought' | 'user', chunk: string) => {
		if (chunk.length === 0) return;
		const last = items.at(-1);
		if (last !== undefined && last.kind === kind) {
			(last as { text: string }).text += chunk;
			return;
		}
		items.push({ kind, key: `${kind}:${items.length}`, text: chunk });
	};
	for (const raw of updates) {
		const update = record(raw);
		if (update === undefined) continue;
		if (update.kind === 'user') {
			// A user message always starts its own entry.
			items.push({
				kind: 'user',
				key: `user:${items.length}`,
				text: text(update.text),
			});
			continue;
		}
		if (update.kind === 'truncated') {
			items.push({ kind: 'truncated', key: `truncated:${items.length}` });
			continue;
		}
		if (update.kind === 'permission-request') {
			const permission = record(update.permission);
			const title = text(record(permission?.toolCall)?.title);
			items.push({
				kind: 'permission',
				key: `permission:${items.length}`,
				title: title.length > 0 ? title : 'A tool',
			});
			continue;
		}
		switch (update.sessionUpdate) {
			case 'agent_message_chunk':
				appendText('agent', contentText(update.content));
				break;
			case 'agent_thought_chunk':
				appendText('thought', contentText(update.content));
				break;
			case 'user_message_chunk':
				// The server records the user's own message; the agent's echo of
				// it would show it twice.
				break;
			case 'tool_call':
			case 'tool_call_update': {
				const id = text(update.toolCallId);
				if (id.length === 0) break;
				let tool = tools.get(id);
				if (tool === undefined) {
					tool = {
						kind: 'tool',
						key: `tool:${id}`,
						toolCallId: id,
						title: '',
						toolKind: 'other',
						status: 'pending',
						input: '',
						output: '',
					};
					tools.set(id, tool);
					items.push(tool);
				}
				if (typeof update.title === 'string') tool.title = update.title;
				if (typeof update.kind === 'string') tool.toolKind = update.kind;
				tool.status = toolStatus(update.status, tool.status);
				if (update.rawInput !== undefined)
					tool.input = inputText(update.rawInput);
				if (update.content !== undefined) {
					const out = contentText(update.content);
					if (out.length > 0) tool.output = out;
				}
				if (update.rawOutput !== undefined && tool.output.length === 0)
					tool.output = inputText(update.rawOutput);
				break;
			}
			case 'plan': {
				const entries = Array.isArray(update.entries) ? update.entries : [];
				const steps = entries.flatMap((entry) => {
					const r = record(entry);
					if (r === undefined) return [];
					const status =
						r.status === 'completed' || r.status === 'in_progress'
							? r.status
							: 'pending';
					return [{ content: text(r.content), status } as PlanStep];
				});
				if (plan === undefined) {
					plan = { kind: 'plan', key: 'plan', steps };
					items.push(plan);
				} else plan.steps = steps;
				break;
			}
			default:
				break;
		}
	}
	for (const tool of tools.values())
		if (tool.title.length === 0) tool.title = tool.input || 'Tool';
	return items;
}

/** The latest plan in a transcript, for the context rail. */
export function latestPlan(
	items: readonly TranscriptItem[],
): readonly PlanStep[] | undefined {
	const plan = items.find((item) => item.kind === 'plan');
	return plan?.kind === 'plan' ? plan.steps : undefined;
}
