import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	createAgentExtensionHarness,
	fixtureChatSessionRequest,
} from '@terminay/extension-api/testing';
import {
	CODEX_ARGUMENTS,
	createBuiltInAgentsExtension,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;
const CLAUDE = 'com.terminay.builtin-agents/claude-code';
const CODEX = 'com.terminay.builtin-agents/codex';
const fakeClaude = fileURLToPath(
	new URL('./fixtures/fake-claude.mjs', import.meta.url),
);
const fakeCodex = fileURLToPath(
	new URL('./fixtures/fake-codex.mjs', import.meta.url),
);

async function setup(t, env = {}) {
	const root = await mkdtemp(join(tmpdir(), 'builtin-agents-chat-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const logPath = join(root, 'agent.log');
	process.env.FAKE_AGENT_LOG = logPath;
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension({
			locator: {
				env: {
					PATH: '/nonexistent',
					TERMINAY_CLAUDE_CODE_COMMAND: fakeClaude,
					TERMINAY_CODEX_COMMAND: fakeCodex,
					...env,
				},
				homeDirectory: root,
				loginShellPath: async () => undefined,
			},
		}),
		{ manifest },
	);
	t.after(() => harness.dispose());
	const log = async () =>
		(await readFile(logPath, 'utf8'))
			.trim()
			.split('\n')
			.map((line) => JSON.parse(line));
	return { harness, root, log };
}

test('both chat providers are registered and report availability', async (t) => {
	const { harness } = await setup(t);
	assert.deepEqual(harness.registeredChatProviderIds(), [CLAUDE, CODEX]);
	assert.deepEqual(await harness.chatAvailability(CLAUDE), { available: true });
	assert.deepEqual(await harness.chatAvailability(CODEX), { available: true });
});

test('a missing CLI is not_installed', async (t) => {
	const { harness } = await setup(t, {
		TERMINAY_CLAUDE_CODE_COMMAND: '/nonexistent/claude',
		TERMINAY_CODEX_COMMAND: '',
	});
	assert.equal(
		(await harness.chatAvailability(CLAUDE)).reason,
		'not_installed',
	);
	assert.equal((await harness.chatAvailability(CODEX)).reason, 'not_installed');
	await assert.rejects(
		harness.openChatSession(CLAUDE, { workingDirectory: tmpdir() }),
	);
});

test('Claude Code is started confined, in the host directory, and streams a turn', async (t) => {
	const { harness, root, log } = await setup(t);
	const chat = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
	});
	await chat.prompt('hello');
	assert.equal(chat.text(), 'you said hello');
	assert.deepEqual(chat.violations(), []);
	assert.deepEqual(
		chat
			.events()
			.filter((event) => event.type === 'tool')
			.map((event) => event.tool),
		[
			{
				callId: 'toolu_1',
				server: 'terminay_chat',
				name: 'read_terminal',
				state: 'running',
			},
			{
				callId: 'toolu_1',
				server: 'terminay_chat',
				name: 'read_terminal',
				state: 'completed',
			},
		],
	);
	const [start, first] = await log();
	const { mcpServer } = fixtureChatSessionRequest;
	assert.deepEqual(start.argv, [
		'-p',
		'--input-format',
		'stream-json',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-partial-messages',
		'--tools',
		'',
		'--setting-sources',
		'',
		'--strict-mcp-config',
		'--mcp-config',
		JSON.stringify({
			mcpServers: {
				terminay_chat: {
					command: mcpServer.command,
					args: mcpServer.args,
					env: mcpServer.env,
				},
			},
		}),
		'--allowedTools',
		'mcp__terminay_chat',
		'--permission-prompts',
		'none',
		'--no-session-persistence',
		'--append-system-prompt',
		fixtureChatSessionRequest.instruction,
	]);
	assert.match(start.cwd, /builtin-agents-chat-/);
	assert.deepEqual(first.stdin, {
		type: 'user',
		message: { role: 'user', content: 'hello' },
	});
	await chat.session.close();
	assert.equal(chat.events().at(-1).type, 'exit');
});

test('a Claude Code chat without MCP reach loads no MCP server and allows no tool', async (t) => {
	const { harness, root, log } = await setup(t);
	const chat = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
		mcpServer: null,
		instruction: undefined,
	});
	await chat.prompt('hi');
	const [{ argv }] = await log();
	assert.equal(argv[argv.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
	assert.equal(argv.includes('--allowedTools'), false);
	assert.equal(argv.includes('--append-system-prompt'), false);
});

test('Claude Code sign-in errors are not_signed_in and name claude', async (t) => {
	const { harness, root } = await setup(t);
	const chat = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
	});
	await assert.rejects(chat.prompt('auth'), /claude/);
	const failure = chat
		.events()
		.find((event) => event.type === 'failure').failure;
	assert.equal(failure.reason, 'not_signed_in');
	assert.match(failure.detail, /`claude`/);
});

test('cancel interrupts a Claude Code turn and the session keeps working', async (t) => {
	const { harness, root, log } = await setup(t);
	const chat = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
	});
	const turn = chat.prompt('slow');
	await waitFor(() => chat.text().length > 0);
	await chat.session.cancel();
	await turn;
	const interrupt = (await log()).find(
		(entry) => entry.stdin?.type === 'control_request',
	).stdin;
	assert.deepEqual(interrupt.request, { subtype: 'interrupt' });
	await chat.prompt('again');
	assert.match(chat.text(), /you said again$/);
});

test('a Claude Code process that dies mid-turn reports a crash and an exit', async (t) => {
	const { harness, root } = await setup(t);
	const chat = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
	});
	await assert.rejects(chat.prompt('die'));
	await waitFor(() => chat.events().some((event) => event.type === 'exit'));
	assert.equal(
		chat.events().find((event) => event.type === 'failure').failure.reason,
		'crashed',
	);
	assert.equal(chat.events().at(-1).exit.code, 3);
});

test('Codex starts an ephemeral read-only thread with only the host MCP server', async (t) => {
	const { harness, root, log } = await setup(t);
	const chat = await harness.openChatSession(CODEX, { workingDirectory: root });
	await chat.prompt('hello');
	assert.equal(chat.text(), 'On it.\n\nyou said hello');
	assert.deepEqual(chat.violations(), []);
	// The fake asks its three questions and ends the turn in one write, so the
	// turn can end before the answers have reached it. Wait for them.
	const answered = (entries) =>
		entries.filter(
			(entry) => entry.stdin?.method === undefined && entry.stdin?.id >= 900,
		).length;
	const deadline = Date.now() + 10_000;
	let entries = await log();
	while (answered(entries) < 3 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		entries = await log();
	}
	assert.deepEqual(entries[0].argv, [...CODEX_ARGUMENTS]);
	const sent = entries
		.filter((entry) => entry.stdin)
		.map((entry) => entry.stdin);
	assert.deepEqual(sent.map((message) => message.method).slice(0, 4), [
		'initialize',
		'initialized',
		'config/read',
		'thread/start',
	]);
	const { mcpServer } = fixtureChatSessionRequest;
	assert.deepEqual(sent[3].params, {
		cwd: root,
		sandbox: 'read-only',
		approvalPolicy: 'untrusted',
		ephemeral: true,
		developerInstructions: fixtureChatSessionRequest.instruction,
		config: {
			'mcp_servers.terminay.enabled': false,
			'mcp_servers.chrome-devtools.enabled': false,
			'mcp_servers.terminay_chat.command': mcpServer.command,
			'mcp_servers.terminay_chat.args': mcpServer.args,
			'mcp_servers.terminay_chat.env': mcpServer.env,
			'mcp_servers.terminay_chat.enabled': true,
			'mcp_servers.terminay_chat.default_tools_approval_mode': 'approve',
		},
	});
	const answers = new Map(
		sent
			.filter((message) => message.method === undefined && message.id >= 900)
			.map((message) => [message.id, message.result]),
	);
	assert.deepEqual(answers.get(901), { decision: 'decline' });
	assert.deepEqual(answers.get(951), { permissions: {}, scope: 'turn' });
	assert.deepEqual(answers.get(991), {
		action: 'cancel',
		content: null,
		_meta: null,
	});
	assert.deepEqual(
		chat
			.events()
			.filter((event) => event.type === 'tool')
			.map((event) => event.tool),
		[
			{
				callId: 'call-1',
				server: 'terminay_chat',
				name: 'list_terminals',
				state: 'running',
			},
			{
				callId: 'call-1',
				server: 'terminay_chat',
				name: 'list_terminals',
				state: 'completed',
			},
			{ callId: 'cmd-1', name: 'command', state: 'running' },
			{ callId: 'cmd-1', name: 'command', state: 'failed' },
		],
	);
});

test('Codex sign-in errors are not_signed_in and name codex login', async (t) => {
	const { harness, root } = await setup(t);
	const chat = await harness.openChatSession(CODEX, { workingDirectory: root });
	await assert.rejects(chat.prompt('auth'), /codex login/);
	assert.equal(
		chat.events().find((event) => event.type === 'failure').failure.reason,
		'not_signed_in',
	);
});

test('cancel interrupts a Codex turn', async (t) => {
	const { harness, root, log } = await setup(t);
	const chat = await harness.openChatSession(CODEX, { workingDirectory: root });
	const turn = chat.prompt('slow');
	await waitFor(() => chat.text().length > 0);
	await chat.session.cancel();
	await turn;
	const interrupt = (await log()).find(
		(entry) => entry.stdin?.method === 'turn/interrupt',
	).stdin;
	assert.deepEqual(interrupt.params, {
		threadId: 'thread-1',
		turnId: 'turn-1',
	});
	await chat.prompt('again');
	assert.match(chat.text(), /you said again$/);
});

test('releasing the extension ends every agent process', async (t) => {
	const { harness, root } = await setup(t);
	const claude = await harness.openChatSession(CLAUDE, {
		workingDirectory: root,
		sessionId: 'a',
	});
	const codex = await harness.openChatSession(CODEX, {
		workingDirectory: root,
		sessionId: 'b',
	});
	await harness.release('disable');
	assert.equal(claude.events().at(-1).type, 'exit');
	assert.equal(codex.events().at(-1).type, 'exit');
});

async function waitFor(check, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('condition never held');
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
