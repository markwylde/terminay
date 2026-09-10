import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension, { PROVIDER_ID } from '../dist/index.js';
import { PID, sessionFile, sessionFilePath } from './claude-terminal.mjs';

const sessionId = '5f2aff08-eab3-4852-96eb-48235fc7f471';
const projects = '/home/test/.claude/projects/-workspace';
const journal = `${projects}/${sessionId}.jsonl`;
const startedAt = '2026-09-06T11:00:00.000Z';

/**
 * The evidence a real Claude Code CLI presents: the pid-keyed session file the
 * running process wrote for itself, naming the journal it is appending to. The
 * journal exists on disk and the process holds no writable handle on it,
 * because Claude Code appends and closes.
 */
function claudeFixture({ files = {}, boundSession = sessionId, ...options }) {
	return fixtureTerminal({
		startedAt,
		pid: PID,
		openFilePaths: [],
		cwd: '/workspace',
		...options,
		files: {
			...files,
			[sessionFilePath(PID)]: [
				sessionFile({
					sessionId: boundSession,
					cwd: options.cwd ?? '/workspace',
					startedAt: Date.parse(startedAt),
				}),
			],
		},
	});
}

test('Claude Code registers its public provider and maps root lifecycle facts', async () => {
	assert.equal(PROVIDER_ID, 'com.terminay.agent.claude-code/cli');
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeFixture({
				foregroundExecutable: 'claude',
				files: {
					[journal]: [
						{
							type: 'permission-mode',
							mode: 'default',
							sessionId,
							version: '2.1.201',
						},
						{ type: 'ai-title', sessionId, aiTitle: 'Investigate the parser' },
						{
							type: 'user',
							sessionId,
							promptId: 'prompt-1',
							message: { role: 'user', content: 'Inspect the parser' },
						},
						{
							type: 'assistant',
							sessionId,
							uuid: 'assistant-1',
							message: {
								role: 'assistant',
								model: 'claude-opus-4-8',
								content: [
									{
										type: 'tool_use',
										id: 'toolu-shell',
										name: 'Bash',
										input: { command: 'private command' },
									},
									{
										type: 'tool_use',
										id: 'toolu-agent',
										name: 'Agent',
										input: {
											description: 'Research parser',
											prompt: 'Inspect the journal',
											subagent_type: 'general-purpose',
										},
									},
									{
										type: 'tool_use',
										id: 'toolu-question',
										name: 'AskUserQuestion',
										input: { questions: 'private' },
									},
								],
							},
						},
						{
							type: 'user',
							sessionId,
							uuid: 'result-1',
							message: {
								role: 'user',
								content: [
									{
										type: 'tool_result',
										tool_use_id: 'toolu-shell',
										is_error: false,
										content: 'private output',
									},
								],
							},
						},
						{
							type: 'assistant',
							sessionId,
							uuid: 'assistant-2',
							message: {
								role: 'assistant',
								model: 'claude-opus-4-8',
								content: [],
								stop_reason: 'end_turn',
							},
						},
					],
				},
			}),
		);
		assert.deepEqual(harness.events(), [
			{ kind: 'session.started', title: 'Claude Code' },
			{ kind: 'agent.metadata', title: 'Investigate the parser' },
			{
				kind: 'turn.started',
				turnId: 'prompt-1',
				promptText: 'Inspect the parser',
			},
			{ kind: 'agent.metadata', model: { id: 'claude-opus-4-8' } },
			{ kind: 'turn.started', turnId: 'assistant-1' },
			{ kind: 'tool.started', toolId: 'toolu-shell', name: 'Bash' },
			{
				kind: 'subagent.started',
				subagentId: 'toolu-agent',
				parentAgentId: sessionId,
				title: 'Research parser',
				promptText: 'Inspect the journal',
				model: { id: 'claude-opus-4-8' },
			},
			// AskUserQuestion is flushed with its answer, so it is an ordinary
			// completed tool and never a live wait.
			{
				kind: 'tool.started',
				toolId: 'toolu-question',
				name: 'AskUserQuestion',
			},
			{ kind: 'tool.finished', toolId: 'toolu-shell', outcome: 'success' },
			{ kind: 'agent.metadata', model: { id: 'claude-opus-4-8' } },
			{ kind: 'turn.started', turnId: 'assistant-2' },
			{ kind: 'agent.done', outcome: 'success' },
		]);
	} finally {
		await harness.dispose();
	}
});

test('Claude Code rejects sidechains and injected command metadata', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeFixture({
				foregroundExecutable: 'claude',
				files: {
					[journal]: [
						{ type: 'permission-mode', sessionId, isSidechain: true },
						{
							type: 'user',
							sessionId,
							uuid: 'unsafe',
							message: { role: 'user', content: '<command-name>private' },
						},
					],
				},
			}),
		);
		assert.deepEqual(harness.events(), []);
	} finally {
		await harness.dispose();
	}
});

test('Claude Code never chooses among journals by filename or time', async () => {
	// Both journals were appended at the same instant, which the deleted rule
	// treated as unresolvable ambiguity. The session file resolves it outright.
	const otherSession = 'bf0b34e1-4afc-4b93-8389-80caa0b589a4';
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeFixture({
				foregroundExecutable: 'claude',
				files: {
					[journal]: [
						{ type: 'permission-mode', sessionId },
						{ type: 'ai-title', aiTitle: 'Mine' },
					],
					[`${projects}/${otherSession}.jsonl`]: [
						{ type: 'permission-mode', sessionId: otherSession },
						{ type: 'ai-title', aiTitle: 'Not mine' },
					],
				},
				fileModifiedAt: {
					[journal]: '2026-09-06T12:00:00.000Z',
					[`${projects}/${otherSession}.jsonl`]: '2026-09-06T12:00:00.000Z',
				},
			}),
		);
		assert.deepEqual(harness.events(), [
			{ kind: 'session.started', title: 'Claude Code' },
			{ kind: 'agent.metadata', title: 'Mine' },
		]);
	} finally {
		await harness.dispose();
	}
});

test('Claude Code binds a resumed session before the CLI opens its journal for writing', async () => {
	// The resumed identity is read from the session file, never from the
	// command line, and no writable handle is consulted.
	const resumedJournal = `/home/test/.claude/projects/-workspace-github-io/${sessionId}.jsonl`;
	const harness = await createAgentExtensionHarness(extension);
	try {
		const terminal = claudeFixture({
			foregroundExecutable: 'claude',
			arguments: ['--resume', sessionId],
			cwd: '/workspace.github.io',
			files: {
				[resumedJournal]: [
					{ type: 'permission-mode', sessionId, version: '2.1.201' },
				],
			},
		});
		terminal.observation.processes.openFiles = async () => [];
		await harness.observe(terminal);
		assert.deepEqual(harness.events(), [
			{ kind: 'session.started', title: 'Claude Code' },
		]);
	} finally {
		await harness.dispose();
	}
});

test('Claude Code rejects a journal whose root header does not prove the named session', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		const terminal = claudeFixture({
			foregroundExecutable: 'claude',
			arguments: [`--resume=${sessionId}`],
			cwd: '/workspace.github.io',
			files: {
				[`/home/test/.claude/projects/-workspace-github-io/${sessionId}.jsonl`]:
					[
						{
							type: 'permission-mode',
							sessionId: 'bf0b34e1-4afc-4b93-8389-80caa0b589a4',
						},
					],
			},
		});
		terminal.observation.processes.openFiles = async () => [];
		await harness.observe(terminal);
		assert.deepEqual(harness.events(), []);
	} finally {
		await harness.dispose();
	}
});
