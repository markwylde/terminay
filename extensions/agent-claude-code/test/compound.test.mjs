import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension, { mapClaudeRecord } from '../dist/index.js';
import { sessionFile, sessionFilePath } from './claude-terminal.mjs';

const firstId = '5f2aff08-eab3-4852-96eb-48235fc7f471';
const secondId = 'bf0b34e1-4afc-4b93-8389-80caa0b589a4';

const startedAt = '2026-09-06T11:00:00.000Z';

/**
 * One terminal running one `claude`, with the pid-keyed session file that
 * process wrote for itself. That file is the only reason anything binds, so
 * every fixture below supplies one.
 */
function claudeTerminal({ pid, sessionId, cwd, files, ...rest }) {
	return fixtureTerminal({
		foregroundExecutable: 'claude',
		cwd,
		pid,
		startedAt,
		openFilePaths: [],
		files: {
			...files,
			[sessionFilePath(pid)]: [
				sessionFile({ pid, sessionId, cwd, startedAt: Date.parse(startedAt) }),
			],
		},
		...rest,
	});
}

function root(sessionId, prompt) {
	return [
		{ type: 'permission-mode', mode: 'default', sessionId, version: '2.1.201' },
		{
			type: 'user',
			sessionId,
			promptId: `prompt-${sessionId}`,
			message: { role: 'user', content: prompt },
		},
	];
}

test('two terminal process trees bind independent new Claude roots without cross-terminal leakage', async () => {
	const left = await createAgentExtensionHarness(extension);
	const right = await createAgentExtensionHarness(extension);
	try {
		await Promise.all([
			left.observe(
				claudeTerminal({
					pid: 4101,
					sessionId: firstId,
					cwd: '/left',
					files: {
						[`/home/test/.claude/projects/-left/${firstId}.jsonl`]: root(
							firstId,
							'left-only',
						),
					},
				}),
			),
			right.observe(
				claudeTerminal({
					pid: 4102,
					sessionId: secondId,
					cwd: '/right',
					files: {
						[`/home/test/.claude/projects/-right/${secondId}.jsonl`]: root(
							secondId,
							'right-only',
						),
					},
				}),
			),
		]);
		assert.equal(JSON.stringify(left.events()).includes('left-only'), true);
		assert.equal(JSON.stringify(left.events()).includes('right-only'), false);
		assert.equal(JSON.stringify(right.events()).includes('right-only'), true);
		assert.equal(JSON.stringify(right.events()).includes('left-only'), false);
	} finally {
		await Promise.all([left.dispose(), right.dispose()]);
	}
});

test('a resumed session binds its own project journal even when unrelated history exists', async () => {
	// The resumed identity comes from the process's own session file. The
	// command line is not parsed for it, so the argument here is only realism.
	const harness = await createAgentExtensionHarness(extension);
	try {
		const resumed = `/home/test/.claude/projects/-work-repo/${secondId}.jsonl`;
		const unrelated = `/home/test/.claude/projects/-other/${firstId}.jsonl`;
		const terminal = claudeTerminal({
			pid: 4103,
			sessionId: secondId,
			arguments: ['--resume', secondId],
			cwd: '/work/repo',
			files: {
				[resumed]: root(secondId, 'resumed-only'),
				[unrelated]: root(firstId, 'unrelated'),
			},
		});
		await harness.observe(terminal);
		assert.equal(
			JSON.stringify(harness.events()).includes('resumed-only'),
			true,
		);
		assert.equal(JSON.stringify(harness.events()).includes('unrelated'), false);
	} finally {
		await harness.dispose();
	}
});

test('topology replacement re-observes a new exact writer rather than retaining the old session', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			claudeTerminal({
				pid: 4104,
				sessionId: firstId,
				cwd: '/one',
				files: {
					[`/home/test/.claude/projects/-one/${firstId}.jsonl`]: root(
						firstId,
						'first topology',
					),
				},
			}),
		);
		await harness.observe(
			claudeTerminal({
				pid: 4105,
				sessionId: secondId,
				cwd: '/two',
				files: {
					[`/home/test/.claude/projects/-two/${secondId}.jsonl`]: root(
						secondId,
						'second topology',
					),
				},
			}),
		);
		assert.deepEqual(
			harness.events().filter((event) => event.kind === 'session.started')
				.length,
			2,
		);
		assert.deepEqual(
			harness
				.events()
				.filter((event) => event.kind === 'turn.started')
				.map((event) => event.promptText),
			['first topology', 'second topology'],
		);
	} finally {
		await harness.dispose();
	}
});

test('malformed, oversized and content-bearing Claude records fail closed', async () => {
	const events = [];
	const publish = new Proxy(
		{ publish: (event) => events.push(event) },
		{
			get(target, name) {
				return name in target
					? target[name]
					: (event) => events.push({ kind: String(name), ...event });
			},
		},
	);
	const context = { binding: { providerSessionId: firstId }, publish };
	for (const record of [
		null,
		[],
		{},
		{
			type: 'user',
			sessionId: firstId,
			promptId: 'oversized',
			message: { role: 'user', content: 'x'.repeat(4_001) },
		},
		{
			type: 'assistant',
			sessionId: firstId,
			uuid: 'assistant',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text: 'PRIVATE ASSISTANT' }],
			},
		},
		{
			type: 'progress',
			sessionId: firstId,
			data: { output: 'PRIVATE TOOL OUTPUT' },
		},
	])
		await mapClaudeRecord(record, context);
	assert.equal(JSON.stringify(events).includes('PRIVATE'), false);
	assert.equal(JSON.stringify(events).includes('xxxx'), false);
});
