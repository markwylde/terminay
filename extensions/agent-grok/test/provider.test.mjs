import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	fixtureTerminal,
} from '@terminay/extension-api/testing';
import extension, {
	createGrokRecordMapper,
	effectiveGrokHome,
	grokAgentProvider,
	isGrokForeground,
} from '../dist/index.js';

const sessionId = '01a04dd9-f9f9-77c0-9ea0-8a8f627ea29c';
const journal = `/home/test/.grok/sessions/%2Fworkspace/${sessionId}/events.jsonl`;

async function records() {
	return (
		await readFile(
			new URL('../fixtures/v0.1/basic.jsonl', import.meta.url),
			'utf8',
		)
	)
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
}

test('registers a Grok provider and binds only an exact writable events journal', async () => {
	const input = await records();
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			fixtureTerminal({
				foregroundExecutable: 'grok',
				files: { [journal]: input },
			}),
		);
		assert.deepEqual(
			harness.events().map((event) => event.kind),
			[
				'session.started',
				'turn.started',
				'tool.started',
				'wait.started',
				'wait.finished',
				'tool.finished',
				'tool.started',
				'tool.finished',
				'agent.done',
			],
		);
		assert.equal(harness.events()[0]?.title, 'Grok');
		assert.deepEqual(harness.events()[0]?.model, { id: 'grok-4.6' });
		assert.equal(harness.events()[1]?.turnId, 'grok-turn-0');
		assert.equal(JSON.stringify(harness.events()).includes('private'), false);
		assert.equal(
			JSON.stringify(harness.events()).includes('call-private-1'),
			false,
		);
	} finally {
		await harness.dispose();
	}
});

test('summary.json titles the bound root and survives a later native turn', async () => {
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			fixtureTerminal({
				foregroundExecutable: 'grok',
				files: {
					[journal]: [
						{ type: 'mcp_config_resolved', servers: [], disabled: [] },
						{
							type: 'turn_started',
							session_id: sessionId,
							turn_number: 0,
							model_id: 'grok-4.6',
							session_relationship: 'primary',
						},
						{ type: 'turn_ended', outcome: 'completed' },
					],
					[`/home/test/.grok/sessions/%2Fworkspace/${sessionId}/summary.json`]:
						[
							{
								info: { id: sessionId },
								generated_title: 'Build Grok extension',
								current_model_id: 'grok-4.6',
							},
						],
				},
			}),
		);
		assert.equal(
			harness
				.events()
				.some(
					(event) =>
						event.kind === 'agent.metadata' &&
						event.title === 'Build Grok extension',
				),
			true,
		);
		assert.equal(
			harness.events().some((event) => event.kind === 'agent.done'),
			true,
		);
	} finally {
		await harness.dispose();
	}
});

test('does not bind a Grok-looking record outside an events journal', async () => {
	const input = await records();
	const harness = await createAgentExtensionHarness(extension);
	try {
		await harness.observe(
			fixtureTerminal({
				foregroundExecutable: 'grok',
				files: {
					[`/tmp/not-a-session/${sessionId}/chat_history.jsonl`]: input,
				},
			}),
		);
		assert.deepEqual(harness.events(), []);
	} finally {
		await harness.dispose();
	}
});

test('maps titles, waits, MCP tools, completion and privacy allowlists', () => {
	const events = [];
	const publish = {
		publish: (event) => events.push(event),
		sessionStarted: (event) =>
			events.push({ kind: 'session.started', ...event }),
		metadataChanged: (event) =>
			events.push({ kind: 'agent.metadata', ...event }),
		turnStarted: (event) => events.push({ kind: 'turn.started', ...event }),
		toolStarted: (event) => events.push({ kind: 'tool.started', ...event }),
		toolFinished: (event) => events.push({ kind: 'tool.finished', ...event }),
		waitStarted: (event) => events.push({ kind: 'wait.started', ...event }),
		waitFinished: (event) => events.push({ kind: 'wait.finished', ...event }),
		done: (event) => events.push({ kind: 'agent.done', ...event }),
	};
	const context = {
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
		publish,
	};
	const map = createGrokRecordMapper();
	map(
		{
			type: 'terminay.grok_metadata',
			sessionId,
			title: 'Build Grok extension',
			modelId: 'grok-4.6',
		},
		context,
	);
	map(
		{
			type: 'turn_started',
			session_id: sessionId,
			turn_number: 0,
			model_id: 'grok-4.6',
			session_relationship: 'primary',
		},
		context,
	);
	map(
		{
			type: 'terminay.grok_metadata',
			sessionId,
			title: 'Renamed Grok session',
		},
		context,
	);
	map({ type: 'assistant', content: 'private assistant output' }, context);
	map({ type: 'phase_changed', phase: 'streaming_reasoning' }, context);
	assert.deepEqual(
		events.map((event) => event.kind),
		['agent.metadata', 'session.started', 'turn.started', 'agent.metadata'],
	);
	assert.equal(events[0]?.title, 'Build Grok extension');
	assert.equal(events[1]?.title, 'Build Grok extension');
	assert.equal(events[3]?.title, 'Renamed Grok session');
	assert.equal(JSON.stringify(events).includes('private assistant'), false);
});

test('a later turn after turn_ended starts working again on the same root', () => {
	const events = [];
	const publish = {
		publish: (event) => events.push(event),
		sessionStarted: (event) =>
			events.push({ kind: 'session.started', ...event }),
		metadataChanged: (event) =>
			events.push({ kind: 'agent.metadata', ...event }),
		turnStarted: (event) => events.push({ kind: 'turn.started', ...event }),
		toolStarted: (event) => events.push({ kind: 'tool.started', ...event }),
		toolFinished: (event) => events.push({ kind: 'tool.finished', ...event }),
		waitStarted: (event) => events.push({ kind: 'wait.started', ...event }),
		waitFinished: (event) => events.push({ kind: 'wait.finished', ...event }),
		done: (event) => events.push({ kind: 'agent.done', ...event }),
	};
	const context = {
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
		publish,
	};
	const map = createGrokRecordMapper();
	map(
		{
			type: 'turn_started',
			session_id: sessionId,
			turn_number: 0,
			session_relationship: 'primary',
			model_id: 'grok-4.6',
		},
		context,
	);
	map({ type: 'turn_ended', outcome: 'completed' }, context);
	map(
		{
			type: 'turn_started',
			session_id: sessionId,
			turn_number: 1,
			session_relationship: 'primary',
			model_id: 'grok-4.6',
		},
		context,
	);
	assert.deepEqual(
		events.map((event) => event.kind),
		['session.started', 'turn.started', 'agent.done', 'turn.started'],
	);
	assert.equal(events.at(-1)?.turnId, 'grok-turn-1');
});

test('a completed turn followed by resume MCP records stays done, not working', () => {
	const events = [];
	const publish = {
		publish: (event) => events.push(event),
		sessionStarted: (event) =>
			events.push({ kind: 'session.started', ...event }),
		metadataChanged: (event) =>
			events.push({ kind: 'agent.metadata', ...event }),
		turnStarted: (event) => events.push({ kind: 'turn.started', ...event }),
		toolStarted: (event) => events.push({ kind: 'tool.started', ...event }),
		toolFinished: (event) => events.push({ kind: 'tool.finished', ...event }),
		waitStarted: (event) => events.push({ kind: 'wait.started', ...event }),
		waitFinished: (event) => events.push({ kind: 'wait.finished', ...event }),
		done: (event) => events.push({ kind: 'agent.done', ...event }),
	};
	const context = {
		binding: { providerSessionId: sessionId },
		journal: { role: 'root' },
		publish,
	};
	const map = createGrokRecordMapper();
	map(
		{
			type: 'turn_started',
			session_id: sessionId,
			turn_number: 2,
			session_relationship: 'primary',
			model_id: 'grok-4.6',
		},
		context,
	);
	map({ type: 'tool_started', tool_name: 'read_file' }, context);
	map(
		{ type: 'tool_completed', tool_name: 'read_file', outcome: 'success' },
		context,
	);
	map({ type: 'turn_ended', outcome: 'completed' }, context);
	map({ type: 'mcp_config_resolved', servers: [], disabled: [] }, context);
	map({ type: 'mcp_init_completed', succeeded: 1, failed: 0 }, context);
	assert.deepEqual(
		events.map((event) => event.kind),
		[
			'session.started',
			'turn.started',
			'tool.started',
			'tool.finished',
			'agent.done',
		],
	);
	assert.equal(events.at(-1)?.outcome, 'success');
});

test('recognizes Grok executables and honors GROK_HOME', () => {
	assert.equal(isGrokForeground('grok'), true);
	assert.equal(isGrokForeground('grok-macos-aarch64'), true);
	assert.equal(isGrokForeground('agent'), false);
	assert.equal(isGrokForeground('cursor-agent'), false);
	assert.equal(
		grokAgentProvider.matchesForeground({ executableName: 'grok' }),
		true,
	);
	assert.equal(
		grokAgentProvider.matchesForeground({ executableName: 'bash' }),
		false,
	);
	assert.match(
		effectiveGrokHome({ HOME: '/home/ignored', GROK_HOME: '/custom/grok' }),
		/\/custom\/grok$/u,
	);
});

function grokRegistryTerminal(options) {
	const cwd = options.cwd;
	const registryPath = '/home/test/.grok/active_sessions.json';
	const registry = { id: registryPath };
	const journals = options.journals ?? {
		[options.sessionId]: [
			{
				type: 'turn_started',
				session_id: options.sessionId,
				turn_number: 0,
				model_id: 'grok-4.6',
				session_relationship: 'primary',
			},
			{ type: 'turn_ended', outcome: 'completed' },
		],
	};
	const files = {
		[registryPath]: options.registry.map((entry) => ({
			session_id: entry.session_id,
			pid: entry.pid,
			cwd: entry.cwd,
			opened_at: '2026-09-06T11:00:00.000Z',
		})),
	};
	const handles = { [registryPath]: registry };
	for (const [id, records] of Object.entries(journals)) {
		const path = `/home/test/.grok/sessions/${encodeURIComponent(options.registry.find((entry) => entry.session_id === id)?.cwd ?? cwd)}/${id}/events.jsonl`;
		handles[path] = { id: path };
		files[path] = records;
	}
	let binding;
	return {
		foreground: { executableName: 'grok', arguments: options.arguments ?? [] },
		signal: { aborted: false, throwIfAborted() {} },
		async bindSession(request) {
			binding = request;
			return {
				providerSessionId: request.providerSessionId,
				mappingVersion: request.mappingVersion,
				journal: request.journal,
			};
		},
		get binding() {
			return binding;
		},
		observation: {
			processes: {
				async descendants() {
					return [
						{
							handle: { id: `grok-${options.pid}` },
							executableName: 'grok',
							pid: options.pid,
							cwd,
						},
						...(options.extraDescendants ?? []),
					];
				},
				async openFiles() {
					return [];
				},
				async environment() {
					return {};
				},
			},
			files: {
				async canonicalFile() {
					return undefined;
				},
				async resolveHomeRelative(relative) {
					if (relative === '.grok/active_sessions.json') return registry;
					const prefix = `.grok/sessions/`;
					if (
						!relative.startsWith(prefix) ||
						!relative.endsWith('/events.jsonl')
					)
						return undefined;
					const path = `/home/test/.grok/sessions/${relative.slice(prefix.length)}`;
					return handles[path];
				},
				async resolveRelativeToEnvironment() {
					return undefined;
				},
				async read(handle) {
					const value = files[handle.id];
					if (handle.id === registryPath)
						return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
					return new TextEncoder().encode(
						`${value.map((record) => JSON.stringify(record)).join('\n')}\n`,
					);
				},
				async stat() {
					return {
						kind: 'file',
						size: 1,
						modifiedAt: '2026-09-06T11:00:00.000Z',
					};
				},
				async follow() {
					return {
						async *[Symbol.asyncIterator]() {},
						dispose() {},
					};
				},
			},
		},
	};
}

function grokRestoreTerminal(arguments_) {
	return grokRegistryTerminal({
		arguments: arguments_,
		pid: 4242,
		sessionId,
		cwd: '/workspace',
		registry: [{ session_id: sessionId, pid: 4242, cwd: '/workspace' }],
	});
}

test('grok --continue binds through active_sessions.json without a writable journal', async () => {
	const terminal = grokRestoreTerminal(['--continue']);
	const result = await grokAgentProvider.observe(terminal);
	assert.equal(result.state, 'bound');
	assert.equal(result.binding.providerSessionId, sessionId);
});

test('grok --resume with no id binds through active_sessions.json without a writable journal', async () => {
	const terminal = grokRestoreTerminal(['--resume']);
	const result = await grokAgentProvider.observe(terminal);
	assert.equal(result.state, 'bound');
	assert.equal(result.binding.providerSessionId, sessionId);
});

test('two Grok PTYs bind independent roots from one shared active_sessions.json', async () => {
	const leftId = '01a0783a-6fec-76b1-ab14-3091be8aa032';
	const rightId = '01a0785e-4001-7570-b63f-9f397b1662a6';
	const registry = [
		{ session_id: leftId, pid: 19049, cwd: '/left' },
		{ session_id: rightId, pid: 44903, cwd: '/right' },
	];
	const left = grokRegistryTerminal({
		pid: 19049,
		sessionId: leftId,
		cwd: '/left',
		registry,
	});
	const right = grokRegistryTerminal({
		pid: 44903,
		sessionId: rightId,
		cwd: '/right',
		registry,
	});
	const [leftResult, rightResult] = await Promise.all([
		grokAgentProvider.observe(left),
		grokAgentProvider.observe(right),
	]);
	assert.equal(leftResult.state, 'bound');
	assert.equal(rightResult.state, 'bound');
	assert.equal(leftResult.binding.providerSessionId, leftId);
	assert.equal(rightResult.binding.providerSessionId, rightId);
});

test('a PTY with two live Grok pids in active_sessions.json still binds the primary journal', async () => {
	const helperId = '01a07859-e6a3-7be2-a0d5-5df0a9722dfc';
	const terminal = grokRegistryTerminal({
		pid: 44903,
		sessionId,
		cwd: '/workspace',
		registry: [
			{ session_id: helperId, pid: 13221, cwd: '/workspace' },
			{ session_id: sessionId, pid: 44903, cwd: '/workspace' },
		],
		extraDescendants: [
			{
				handle: { id: 'helper' },
				executableName: 'grok',
				pid: 13221,
				cwd: '/workspace',
			},
		],
		journals: {
			[sessionId]: [
				{
					type: 'turn_started',
					session_id: sessionId,
					turn_number: 1,
					model_id: 'grok-4.6',
					session_relationship: 'primary',
				},
			],
			[helperId]: [
				{
					type: 'turn_started',
					session_id: helperId,
					turn_number: 0,
					session_relationship: 'subagent',
				},
			],
		},
	});
	const result = await grokAgentProvider.observe(terminal);
	assert.equal(result.state, 'bound');
	assert.equal(result.binding.providerSessionId, sessionId);
});
