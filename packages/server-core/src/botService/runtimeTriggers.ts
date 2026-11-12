import { createHash } from 'node:crypto';
import type { BotTrigger, BotTriggerDraft } from '@terminay/protocol';
import type { BotService } from './service.js';
import { BotError, object, text } from './store.js';
import { triggerId } from './triggerState.js';

const string = { type: 'string' };
const revision = { type: 'integer', minimum: 0 };
const schema = (
	properties: Record<string, unknown>,
	required: string[] = [],
) => ({
	type: 'object',
	properties,
	required,
	additionalProperties: false,
});
const match = {
	type: 'object',
	properties: {
		kind: { enum: ['changed', 'contains', 'regex', 'exit', 'items'] },
		text: string,
		repeat: { type: 'boolean' },
		code: { type: 'integer' },
		items: string,
		identity: string,
		initial: { enum: ['process', 'baseline'] },
	},
	required: ['kind'],
	additionalProperties: false,
};
const network = {
	url: string,
	headers: { type: 'object', additionalProperties: { type: 'string' } },
};
const periodic = {
	intervalMs: { type: 'integer', minimum: 60000 },
	timeoutMs: { type: 'integer', minimum: 1000, maximum: 300000 },
};
const condition = {
	oneOf: [
		schema(
			{
				kind: { const: 'once' },
				at: {
					type: 'integer',
					minimum: 0,
					description: 'Unix time in milliseconds.',
				},
			},
			['kind', 'at'],
		),
		schema(
			{
				kind: { const: 'every' },
				intervalMs: { type: 'integer', minimum: 60000 },
			},
			['kind', 'intervalMs'],
		),
		schema(
			{
				kind: { const: 'cron' },
				cron: {
					type: 'string',
					description: 'Five-field cron in the server time zone.',
				},
			},
			['kind', 'cron'],
		),
		schema(
			{
				kind: { const: 'command' },
				command: string,
				cwd: string,
				...periodic,
				match,
			},
			['kind', 'command', 'intervalMs', 'match'],
		),
		schema(
			{
				kind: { const: 'http' },
				...network,
				...periodic,
				select: string,
				match,
			},
			['kind', 'url', 'intervalMs'],
		),
		schema({ kind: { const: 'sse' }, ...network, eventName: string }, [
			'kind',
			'url',
		]),
		schema(
			{
				kind: { const: 'files' },
				path: string,
				recursive: { type: 'boolean' },
				include: string,
				exclude: string,
				debounceMs: { type: 'integer', minimum: 0, maximum: 60000 },
			},
			['kind', 'path'],
		),
	],
};
const draft = schema(
	{
		recovery: {
			enum: ['skip', 'once', 'replay', 'ignore-gap', 'recover-available'],
		},
		name: string,
		enabled: { type: 'boolean' },
		prompt: string,
		condition,
		startupRetries: {
			type: 'integer',
			minimum: 0,
			maximum: 3,
			description:
				'How many times a run retries a temporary startup failure. Default 3.',
		},
		onNeedsHuman: {
			enum: ['pause', 'keep-running'],
			description:
				'While the user owes this trigger an action: pause it (default) or keep running.',
		},
	},
	['name', 'enabled', 'prompt', 'condition'],
);

export const BOT_TRIGGER_TOOLS = [
	{
		name: 'triggers_test',
		description:
			'Execute a source test in your container, without AI sessions or changing observation memory. Commands may have side effects.',
		inputSchema: schema({ condition, triggerId: string }, ['condition']),
	},
	{
		name: 'triggers_memory',
		description: 'Read up to 25 remembered item IDs; offset pagination.',
		inputSchema: schema(
			{ triggerId: string, offset: { type: 'integer', minimum: 0 } },
			['triggerId'],
		),
	},
	{
		name: 'triggers_reset',
		description:
			'Reset observation memory. Explicit confirmed=true required: existing items may run again.',
		inputSchema: schema(
			{ triggerId: string, confirmed: { type: 'boolean' }, revision },
			['triggerId', 'confirmed', 'revision'],
		),
	},
	{
		name: 'triggers_retry',
		description: 'Retry a failed/blocked source or event dispatch.',
		inputSchema: schema({ triggerId: string, revision }, [
			'triggerId',
			'revision',
		]),
	},
	{
		name: 'triggers_list',
		description:
			'List/search your own trigger metadata without prompts. Default 10, max 25; paginate. Re-list if the server revision changes.',
		inputSchema: schema({
			cursor: string,
			limit: { type: 'integer', minimum: 1, maximum: 25 },
			search: string,
		}),
	},
	{
		name: 'triggers_get',
		description:
			'Read one of your triggers and a bounded prompt slice. Follow nextCursor for the rest.',
		inputSchema: schema({ triggerId: string, cursor: string }, ['triggerId']),
	},
	{
		name: 'triggers_create',
		description:
			'Create a trigger for your bot using the current server revision. Maximum 50 triggers; intervals must be at least 1 minute.',
		inputSchema: schema({ revision, draft }, ['revision', 'draft']),
	},
	{
		name: 'triggers_update',
		description:
			'Replace your trigger definition with a complete draft, using the current server revision. Use triggers_enable for a simple enable/disable.',
		inputSchema: schema({ triggerId: string, revision, draft }, [
			'triggerId',
			'revision',
			'draft',
		]),
	},
	{
		name: 'triggers_delete',
		description:
			'Delete your trigger and cancel its pending firing, using the current server revision. Already running work is not undone.',
		inputSchema: schema({ triggerId: string, revision }, [
			'triggerId',
			'revision',
		]),
	},
	{
		name: 'triggers_enable',
		description:
			'Enable or disable your trigger using the current server revision. Disabling cancels pending firings.',
		inputSchema: schema(
			{ triggerId: string, enabled: { type: 'boolean' }, revision },
			['triggerId', 'enabled', 'revision'],
		),
	},
	{
		name: 'triggers_preview',
		description:
			'Validate a condition and preview its next five dates in the server time zone. Event triggers have no scheduled dates.',
		inputSchema: schema({ condition }, ['condition']),
	},
	{
		name: 'triggers_run',
		description:
			'Run your trigger now as an independent session, even if disabled. Use the current server revision; inspect after a conflict rather than retrying blindly.',
		inputSchema: schema({ triggerId: string, revision }, [
			'triggerId',
			'revision',
		]),
	},
] as const;

function exact(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	const result = object(value);
	if (Object.keys(result).some((key) => !keys.includes(key)))
		throw new BotError('validation', 'Unknown trigger argument');
	return result;
}
function parseCondition(value: unknown): unknown {
	const c = object(value);
	if (['command', 'http', 'sse', 'files'].includes(String(c.kind))) return c;
	const keys =
		c.kind === 'once'
			? ['kind', 'at']
			: c.kind === 'every'
				? ['kind', 'intervalMs']
				: c.kind === 'cron'
					? ['kind', 'cron']
					: ['kind', 'event'];
	return exact(c, keys);
}
function parseDraft(value: unknown): BotTriggerDraft {
	const d = exact(value, [
		'name',
		'enabled',
		'prompt',
		'condition',
		'recovery',
		'startupRetries',
		'onNeedsHuman',
	]);
	parseCondition(d.condition);
	// BotTriggers owns all value validation and normalization, shared with the UI.
	return d as unknown as BotTriggerDraft;
}
function summary(trigger: BotTrigger) {
	const {
		prompt,
		botId: _botId,
		evaluatedThrough: _evaluated,
		...metadata
	} = trigger;
	return { ...metadata, promptBytes: Buffer.byteLength(prompt) };
}

export async function callTriggerTool(
	service: BotService,
	botId: string,
	name: string,
	a: Record<string, unknown>,
): Promise<unknown> {
	const triggers = service.triggers;
	if (name === 'triggers_test')
		return triggers.test(botId, a.condition, a.triggerId as string | undefined);
	if (name === 'triggers_memory')
		return triggers.memory(
			botId,
			triggerId(a.triggerId),
			a.offset as number | undefined,
		);
	if (name === 'triggers_preview')
		return {
			next: triggers.preview(parseCondition(a.condition)),
			timeZone: triggers.timeZoneName,
		};
	const snapshot = triggers.list(botId);
	const context = () => ({
		revision: triggers.list(botId).revision,
		eventsCursor: service.messages.eventCursor(botId),
		timeZone: triggers.timeZoneName,
	});
	if (name === 'triggers_list') {
		const search =
			a.search === undefined
				? ''
				: text(a.search, 256, 'search', true).toLocaleLowerCase();
		const rows = snapshot.triggers
			.filter(
				(t) =>
					!search ||
					`${t.name}\n${t.prompt}`.toLocaleLowerCase().includes(search),
			)
			.sort((x, y) => x.id.localeCompare(y.id));
		return {
			...context(),
			total: rows.length,
			...service.messages.pageRecords(
				botId,
				'triggers',
				`${snapshot.revision}:${search}`,
				rows.map(summary),
				a.cursor === undefined ? undefined : text(a.cursor, 4096, 'cursor'),
				a.limit as number | undefined,
			),
		};
	}
	const get = () => {
		const id = triggerId(a.triggerId);
		const trigger = snapshot.triggers.find((t) => t.id === id);
		if (!trigger) throw new BotError('not_found', 'Trigger not found');
		return trigger;
	};
	if (name === 'triggers_get') {
		const trigger = get();
		const metadata = { ...context(), trigger: summary(trigger) };
		// Content binding stays stable across scheduler evaluation and unrelated edits.
		const hash = createHash('sha256')
			.update(JSON.stringify({ ...summary(trigger), prompt: trigger.prompt }))
			.digest('hex');
		return {
			...metadata,
			...service.messages.sliceText(
				botId,
				'trigger-prompt',
				`${trigger.id}:${hash}`,
				1,
				trigger.prompt,
				metadata,
				a.cursor === undefined ? undefined : text(a.cursor, 4096, 'cursor'),
			),
		};
	}
	if (!Number.isSafeInteger(a.revision) || (a.revision as number) < 0)
		throw new BotError('validation', 'revision must be a non-negative integer');
	if (a.revision !== snapshot.revision)
		throw new BotError(
			'conflict',
			'Trigger server revision changed; re-read triggers before changing them',
		);
	if (name === 'triggers_create') {
		const created = await triggers.prepare(
			botId,
			undefined,
			parseDraft(a.draft),
			snapshot.revision,
		);
		return { ...context(), trigger: summary(created) };
	}
	const trigger = get();
	switch (name) {
		case 'triggers_reset':
			triggers.reset(botId, triggerId(a.triggerId), a.confirmed === true);
			return context();
		case 'triggers_retry':
			triggers.retry(botId, triggerId(a.triggerId));
			return context();
		case 'triggers_update': {
			const updated = await triggers.prepare(
				botId,
				trigger.id,
				parseDraft(a.draft),
				snapshot.revision,
			);
			return { ...context(), trigger: summary(updated) };
		}
		case 'triggers_delete':
			triggers.remove(botId, trigger.id, snapshot.revision);
			return { ...context(), deleted: trigger.id };
		case 'triggers_enable':
			triggers.enable(
				botId,
				trigger.id,
				a.enabled as boolean,
				snapshot.revision,
			);
			return {
				...context(),
				trigger: summary(
					triggers.list(botId).triggers.find((t) => t.id === trigger.id)!,
				),
			};
		case 'triggers_run': {
			const firing = await triggers.runNow(botId, trigger.id);
			return { ...context(), firing };
		}
		default:
			throw new BotError('validation', 'Unknown trigger tool');
	}
}
