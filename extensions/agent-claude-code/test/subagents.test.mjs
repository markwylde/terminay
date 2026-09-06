import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension from '../dist/index.js';

/**
 * Shaped from a real Claude Code 2.1.263 session directory captured during a
 * conformance run: a root journal that launches three subagents with the
 * `Agent` tool and completes each on its task notification, plus the three
 * child journals the CLI wrote below `<session-uuid>/subagents/` and the
 * `agent-<agentId>.meta.json` sidecar it wrote beside each one. Prompt and
 * assistant bodies are placeholders; only the fields this mapping reads are
 * kept, with the real identifiers preserved.
 */
const sessionId = 'd9a64f5f-9145-4cba-8a50-aea68c4325a4';
const projects = '/home/test/.claude/projects/-workspace';
const root = `${projects}/${sessionId}.jsonl`;
const startedAt = '2026-09-06T11:00:00.000Z';

/** The real agent id / tool-use id pairing, taken from the captured sidecars. */
const subagents = [
	{
		agentId: 'a3ddf86251fae325c',
		toolUseId: 'toolu_01D1cbJZ2N34422RCwsBSwiP',
		description: 'Compute 17*19 after sleep 5',
		/** This child's journal ends on `end_turn`. */
		endsTurn: true,
	},
	{
		agentId: 'ad5dc6ff0409b70d6',
		toolUseId: 'toolu_01SADFJKc1c5CcTgk71meoSz',
		description: 'Compute 2^12 after sleep 30',
		endsTurn: true,
	},
	{
		agentId: 'af3e0478c1220c04c',
		toolUseId: 'toolu_01Sjv5J8WjTkBKatHi5uZizr',
		description: 'Sum 1..100 after sleep 15',
		/** The real journal for this child stops without an `end_turn` record. */
		endsTurn: false,
	},
];

const launch = (subagent, index) => [
	{
		type: 'assistant',
		sessionId,
		uuid: `launch-${index}`,
		isSidechain: false,
		message: {
			role: 'assistant',
			model: 'claude-opus-5',
			stop_reason: 'tool_use',
			content: [
				{
					type: 'tool_use',
					id: subagent.toolUseId,
					name: 'Agent',
					input: {
						description: subagent.description,
						subagent_type: 'general-purpose',
					},
				},
			],
		},
	},
	{
		type: 'user',
		sessionId,
		uuid: `launch-result-${index}`,
		isSidechain: false,
		message: {
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: subagent.toolUseId }],
		},
	},
];

const notification = (subagent, index) => [
	{
		type: 'user',
		sessionId,
		uuid: `notify-${index}`,
		isSidechain: false,
		message: {
			role: 'user',
			content: `<task-notification>\n<task-id>${subagent.agentId}</task-id>\n<tool-use-id>${subagent.toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
		},
	},
	{
		type: 'assistant',
		sessionId,
		uuid: `notify-reply-${index}`,
		isSidechain: false,
		message: {
			role: 'assistant',
			model: 'claude-opus-5',
			stop_reason: 'end_turn',
			content: [{ type: 'text', text: 'placeholder' }],
		},
	},
	{ type: 'system', subtype: 'turn_duration', sessionId, isSidechain: false },
];

const rootJournal = [
	{ type: 'mode', sessionId, version: '2.1.263' },
	{ type: 'permission-mode', sessionId, permissionMode: 'default' },
	{ type: 'last-prompt', sessionId, lastPrompt: 'placeholder prompt' },
	{
		type: 'user',
		sessionId,
		uuid: 'prompt-1',
		promptId: 'prompt-1',
		isSidechain: false,
		message: { role: 'user', content: 'placeholder prompt' },
	},
	...subagents.flatMap(launch),
	{
		type: 'assistant',
		sessionId,
		uuid: 'launched',
		isSidechain: false,
		message: {
			role: 'assistant',
			model: 'claude-opus-5',
			stop_reason: 'end_turn',
			content: [{ type: 'text', text: 'placeholder' }],
		},
	},
	{ type: 'system', subtype: 'turn_duration', sessionId, isSidechain: false },
	...subagents.flatMap(notification),
];

const childJournal = (subagent) => [
	{
		type: 'user',
		sessionId,
		uuid: `${subagent.agentId}-0`,
		parentUuid: null,
		promptId: 'prompt-1',
		agentId: subagent.agentId,
		isSidechain: true,
		message: { role: 'user', content: 'placeholder child prompt' },
	},
	{
		type: 'assistant',
		sessionId,
		uuid: `${subagent.agentId}-1`,
		parentUuid: `${subagent.agentId}-0`,
		agentId: subagent.agentId,
		isSidechain: true,
		message: {
			role: 'assistant',
			model: 'claude-opus-5',
			stop_reason: 'tool_use',
			content: [
				{
					type: 'tool_use',
					id: `toolu_child_${subagent.agentId}`,
					name: 'Bash',
					input: {},
				},
			],
		},
	},
	{
		type: 'user',
		sessionId,
		uuid: `${subagent.agentId}-2`,
		parentUuid: `${subagent.agentId}-1`,
		agentId: subagent.agentId,
		isSidechain: true,
		message: {
			role: 'user',
			content: [
				{ type: 'tool_result', tool_use_id: `toolu_child_${subagent.agentId}` },
			],
		},
	},
	{
		type: 'assistant',
		sessionId,
		uuid: `${subagent.agentId}-3`,
		parentUuid: `${subagent.agentId}-2`,
		agentId: subagent.agentId,
		isSidechain: true,
		message: {
			role: 'assistant',
			model: 'claude-opus-5',
			...(subagent.endsTurn ? { stop_reason: 'end_turn' } : {}),
			content: [{ type: 'text', text: 'placeholder' }],
		},
	},
];

function resumedTerminal() {
	const files = { [root]: rootJournal };
	for (const subagent of subagents) {
		files[
			`${projects}/${sessionId}/subagents/agent-${subagent.agentId}.jsonl`
		] = childJournal(subagent);
		files[
			`${projects}/${sessionId}/subagents/agent-${subagent.agentId}.meta.json`
		] = [
			{
				agentType: 'general-purpose',
				description: subagent.description,
				toolUseId: subagent.toolUseId,
				spawnDepth: 1,
			},
		];
	}
	return fixtureTerminal({
		foregroundExecutable: 'claude',
		arguments: ['--continue'],
		cwd: '/workspace',
		startedAt,
		openFilePaths: [],
		files,
		// `claude --continue` appends to a journal an earlier process created,
		// and the subagents directory already exists when the session rebinds.
		fileCreatedAt: { [root]: '2026-09-05T09:00:00.000Z' },
		fileModifiedAt: { [root]: '2026-09-06T11:00:20.000Z' },
	});
}

test('a resumed session with existing child journals projects each subagent once', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(resumedTerminal());
		const events = harness.events();
		const started = events.filter((event) => event.kind === 'subagent.started');
		const startedIds = new Set(started.map((event) => event.subagentId));
		assert.equal(
			startedIds.size,
			3,
			`expected three distinct subagents, saw ${[...startedIds].join(', ')}`,
		);
		assert.deepEqual(
			[...startedIds].sort(),
			subagents.map((subagent) => subagent.toolUseId).sort(),
			'every subagent is keyed by the tool-use id its meta sidecar names',
		);
		for (const subagent of subagents) {
			assert.equal(
				events.some(
					(event) =>
						event.kind === 'subagent.done' &&
						event.subagentId === subagent.toolUseId,
				),
				true,
				`${subagent.toolUseId} never completed`,
			);
			assert.equal(
				events.some((event) =>
					JSON.stringify(event).includes(subagent.agentId),
				),
				false,
				`${subagent.agentId} was projected as a second child`,
			);
		}
		const lastFor = (id) =>
			events.findLast(
				(event) =>
					(event.kind === 'subagent.started' ||
						event.kind === 'subagent.done') &&
					event.subagentId === id,
			)?.kind;
		for (const subagent of subagents)
			assert.equal(
				lastFor(subagent.toolUseId),
				'subagent.done',
				`${subagent.toolUseId} went back to working after completing`,
			);
		assert.equal(
			harness.projection().working,
			false,
			'the root is left working by a child that never completes',
		);
	} finally {
		await harness.dispose();
	}
});
