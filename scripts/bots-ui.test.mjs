/**
 * Home › Bots components in Chromium, against a fake server projection
 * (scripts/bots-ui-harness.tsx). Set BOTS_UI_SCREENSHOTS=<dir> to also save
 * screenshots for review against the design demo.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const SHOTS = process.env.BOTS_UI_SCREENSHOTS;
const directory = await mkdtemp(join(tmpdir(), 'terminay-bots-ui-'));
const bundle = join(directory, 'bots-ui-harness.js');
await build({
	entryPoints: ['scripts/bots-ui-harness.tsx'],
	bundle: true,
	format: 'esm',
	jsx: 'automatic',
	loader: { '.css': 'text' },
	outfile: bundle,
	define: { 'process.env.NODE_ENV': '"development"' },
	logLevel: 'silent',
});
const css = [
	await readFile('src/workspace/bots/bots.css', 'utf8'),
	(await readFile('src/App.css', 'utf8')).slice(
		(await readFile('src/App.css', 'utf8')).indexOf('.context-menu {'),
	),
	await readFile('src/workspace/bots/botPanels.css', 'utf8'),
].join('\n');
const browser = await chromium.launch({ headless: true });

test.after(async () => {
	await browser.close();
	await rm(directory, { recursive: true, force: true });
});

/** Chooses an option in one of the Bots grouped dropdowns. */
async function pick(scope, label, value) {
	await scope.getByRole('combobox', { name: label, exact: true }).click();
	await scope
		.getByRole('listbox', { name: label, exact: true })
		.locator(`[data-grouped-select-value="${value}"]`)
		.click();
}

/** The value a grouped dropdown currently holds. */
function picked(scope, label) {
	return scope
		.getByRole('combobox', { name: label, exact: true })
		.getAttribute('data-grouped-select-value');
}

const NOW = Date.now();
const BIRD = 'birdbot00001';
const OWL = 'owlbot000002';
const FINCH = 'finchbot0003';

function bot(id, name, patch = {}) {
	return {
		id,
		name,
		avatar: '',
		colour: '#7cc4f5',
		description: `${name} keeps things tidy.`,
		instructions: '',
		agentId: 'codex',
		modelId: null,
		signIn: { kind: 'none' },
		approvalMode: 'autonomous',
		maxTurnMs: 30 * 60_000,
		pinnedMemories: [],
		createdAt: NOW - 86_400_000,
		updatedAt: NOW - 86_400_000,
		...patch,
	};
}

function session(id, botId, patch = {}) {
	return {
		id,
		botId,
		origin: { kind: 'chat' },
		snapshot: {
			agentId: 'codex',
			modelId: null,
			signIn: { kind: 'none' },
			approvalMode: 'autonomous',
			instructions: '',
			context: '',
			maxTurnMs: 1_800_000,
		},
		state: 'completed',
		startedAt: NOW - 600_000,
		endedAt: null,
		durationMs: 0,
		open: true,
		acpSessionId: 'acp',
		canLoad: true,
		segments: 1,
		transcriptBytes: 10,
		truncated: false,
		runnerOutput: '',
		permission: null,
		permissions: [],
		queuedMessage: null,
		firing: null,
		reason: null,
		recoveryMayHaveLostUpdates: false,
		...patch,
	};
}

const AGENTS = [
	{
		extensionId: 'terminay.builtin-agents',
		extensionName: 'Built-in agents',
		id: 'codex',
		displayName: 'Codex',
		autonomousOnly: true,
		canLoad: true,
		signInMethods: ['device', 'token'],
		models: [{ id: 'gpt-luna', displayName: 'GPT Luna' }],
		modelsAvailable: true,
		status: { state: 'ready' },
	},
	{
		extensionId: 'terminay.builtin-agents',
		extensionName: 'Built-in agents',
		id: 'claude-code',
		displayName: 'Claude Code',
		autonomousOnly: false,
		canLoad: true,
		signInMethods: ['token'],
		models: [{ id: 'haiku', displayName: 'Claude Haiku' }],
		modelsAvailable: true,
		status: {
			state: 'not-signed-in',
			action: { label: 'Add a sign-in token', kind: 'sign-in' },
		},
	},
	{
		extensionId: 'acme.agents',
		extensionName: 'Acme agents',
		id: 'acme',
		displayName: 'Acme',
		autonomousOnly: false,
		canLoad: false,
		signInMethods: [],
		models: [],
		modelsAvailable: false,
		status: { state: 'not-installed' },
	},
];

async function open(scenario, viewport = { width: 1280, height: 820 }) {
	const page = await browser.newPage({ viewport });
	page.setDefaultTimeout(10_000);
	await page.setContent(`
		<style>html, body, #root { width: 100%; height: 100%; margin: 0; background: #1a1c20; font-family: sans-serif; }${css}</style>
		<div id="root"></div>
	`);
	await page.evaluate((s) => {
		window.__scenario = s;
	}, scenario);
	await page.addScriptTag({ path: bundle, type: 'module' });
	return page;
}

async function shot(page, name) {
	if (!SHOTS) return;
	await mkdir(SHOTS, { recursive: true });
	await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

const calls = (page, op) =>
	page.evaluate((name) => window.__calls.filter((c) => c.op === name), op);

const FLEET = {
	view: 'dashboard',
	bots: [
		bot(BIRD, 'Bird'),
		bot(OWL, 'Owl', { agentId: 'claude-code', approvalMode: 'ask' }),
		bot(FINCH, 'Finch'),
	],
	sessions: {
		[BIRD]: [session('s-bird', BIRD, { state: 'running' })],
		[OWL]: [
			session('s-owl', OWL, {
				state: 'needs-you',
				permission: {
					id: 'p1',
					options: [
						{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
					],
					toolCall: { title: 'Edit deploy.sh' },
				},
			}),
		],
		[FINCH]: [],
	},
	environments: { [BIRD]: 'running', [OWL]: 'running', [FINCH]: 'stopped' },
	agents: AGENTS,
};

test('the dashboard shows each bot as a card, and filters them', async () => {
	const page = await open(FLEET);
	try {
		await page.locator('[data-terminay-bot-card]').first().waitFor();
		assert.equal(await page.locator('[data-terminay-bot-card]').count(), 3);
		assert.equal(
			await page
				.locator(`[data-terminay-bot-card="${OWL}"]`)
				.getAttribute('data-terminay-bot-activity'),
			'needs-you',
		);
		assert.match(
			await page.locator('[data-terminay-bots-filter="working"]').innerText(),
			/1/,
		);
		await shot(page, 'dashboard');
		await page.locator('[data-terminay-bots-filter="needs-you"]').click();
		assert.deepEqual(
			await page
				.locator('[data-terminay-bot-card]')
				.evaluateAll((cards) => cards.map((c) => c.dataset.terminayBotCard)),
			[OWL],
		);
		await page.locator('[data-terminay-bots-filter="all"]').click();
		await page.locator('[data-terminay-bots-search]').fill('finch');
		assert.equal(await page.locator('[data-terminay-bot-card]').count(), 1);
	} finally {
		await page.close();
	}
});

test('cards update live, and Needs you opens the session in its bot tab', async () => {
	const page = await open(FLEET);
	try {
		const finch = page.locator(`[data-terminay-bot-card="${FINCH}"]`);
		await finch.waitFor();
		assert.equal(
			await finch.getAttribute('data-terminay-bot-activity'),
			'stopped',
		);
		await page.evaluate(
			([id, s]) => window.__harness.setSessions(id, [s]),
			[FINCH, session('s-finch', FINCH, { state: 'running' })],
		);
		await page.waitForFunction(
			(id) =>
				document.querySelector(`[data-terminay-bot-card="${id}"]`)?.dataset
					.terminayBotActivity === 'working',
			FINCH,
		);
		await page.locator('[data-terminay-bots-needs-session="s-owl"]').click();
		const opened = await page.evaluate(() => window.__opened);
		assert.deepEqual(opened.at(-1), {
			serverId: 'local',
			botId: OWL,
			mode: 'chat',
			sessionId: 's-owl',
		});
	} finally {
		await page.close();
	}
});

for (const [reason, text] of [
	['not-installed', /Install Docker or Podman/],
	['not-running', /not running/],
	['permission-denied', /not allowed to use/],
	['remote-engine', /another machine/],
	['unsupported-engine-mode', /Rootless Docker is not supported/],
	['unsupported-platform', /not supported on this platform/],
	['engine-changed', /connection changed/],
]) {
	test(`the engine summary explains ${reason}`, async () => {
		const page = await open({
			...FLEET,
			engine: {
				engine: reason === 'unsupported-engine-mode' ? 'docker' : null,
				available: false,
				reason,
				detail: '',
				pinned: null,
				candidates:
					reason === 'unsupported-engine-mode'
						? [
								{
									kind: 'podman',
									address: 'unix:///p.sock',
									available: true,
									reason: null,
								},
							]
						: [],
				runningContainers: 0,
				botContainers: 0,
				image: {
					state: 'missing',
					fingerprint: null,
					builtAt: null,
					error: null,
				},
			},
		});
		try {
			const note = page.locator(
				`[data-terminay-bots-engine-reason="${reason}"]`,
			);
			await note.waitFor();
			assert.match(await note.innerText(), text);
			if (reason === 'unsupported-engine-mode') {
				await page.getByRole('button', { name: 'Use this engine' }).click();
				await page.waitForFunction(() =>
					window.__calls.some(
						(c) =>
							c.op === 'transport.command' && c.args[0] === 'bots.engine.use',
					),
				);
			}
		} finally {
			await page.close();
		}
	});
}

test('New bot creates a bot with a name and an agent, then opens Configure', async () => {
	const page = await open(FLEET);
	try {
		await page.locator('[data-terminay-bots-new]').click();
		await page.locator('[data-terminay-bots-new-name]').fill('Wren');
		await page.locator('[data-terminay-bots-new-create]').click();
		await page.waitForFunction(() => window.__opened.length > 0);
		const [save] = await calls(page, 'save');
		assert.equal(save.args[0].name, 'Wren');
		assert.equal(save.args[0].agentId, 'codex');
		assert.equal(save.args[0].approvalMode, 'autonomous');
		const opened = await page.evaluate(() => window.__opened.at(-1));
		assert.equal(opened.mode, 'configure');
	} finally {
		await page.close();
	}
});

const TAB = (patch = {}) => ({
	view: 'tab',
	bots: [bot(BIRD, 'Bird', { agentId: 'claude-code', approvalMode: 'ask' })],
	sessions: {
		[BIRD]: [
			session('s1', BIRD, {
				state: 'running',
				snapshot: { ...session('x', BIRD).snapshot, agentId: 'claude-code' },
			}),
		],
	},
	transcripts: {
		s1: [
			{ kind: 'user', text: 'Check the build' },
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'Looking ' },
			},
			{
				sessionUpdate: 'agent_message_chunk',
				content: { type: 'text', text: 'now.' },
			},
			{
				sessionUpdate: 'tool_call',
				toolCallId: 't1',
				title: 'npm test',
				kind: 'execute',
				status: 'in_progress',
				rawInput: { command: 'npm test' },
			},
			{
				sessionUpdate: 'tool_call_update',
				toolCallId: 't1',
				status: 'completed',
				content: [
					{ type: 'content', content: { type: 'text', text: '12 passing' } },
				],
			},
			{
				sessionUpdate: 'plan',
				entries: [
					{ content: 'Run tests', status: 'completed' },
					{ content: 'Summarise', status: 'in_progress' },
				],
			},
		],
	},
	environments: { [BIRD]: 'running' },
	agents: AGENTS,
	...patch,
});

test('shared chat shows communication without provider traces; sessions open separate diagnostics', async () => {
	const page = await open(TAB());
	try {
		await page.getByText('Looking now.', { exact: true }).waitFor();
		assert.equal(await page.locator('[data-terminay-bot-tool]').count(), 0);
		assert.equal(await page.locator('[data-terminay-bot-new-chat]').count(), 0);
		await page.locator('.bots-sess').first().click();
		await page.locator('[data-terminay-bot-session]').waitFor();
		await page.locator('[data-terminay-bot-tool="t1"]').waitFor();
	} finally {
		await page.close();
	}
});
test('sending remains available while another execution is running', async () => {
	const page = await open(
		TAB({ sessions: { [BIRD]: [session('s1', BIRD, { state: 'running' })] } }),
	);
	try {
		await page.locator('[data-terminay-bot-composer]').fill('New correction');
		await page.locator('[data-terminay-bot-send]').click();
		await page.getByText('New correction', { exact: true }).waitFor();
		const posted = (await calls(page, 'transport.command')).filter(
			(c) => c.args[0] === 'bots.messages.post',
		);
		assert.equal(posted.length, 1);
		assert.equal(posted[0].args[1].text, 'New correction');
	} finally {
		await page.close();
	}
});

test('the tab keeps its mode, configure tab, and unsent text', async () => {
	const page = await open(TAB());
	try {
		await page.locator('[data-terminay-bot-composer]').fill('half a thought');
		await page.locator('[data-terminay-bot-mode-button="configure"]').click();
		assert.equal(
			await page
				.locator('[data-terminay-bot-config-tab="profile"]')
				.getAttribute('aria-selected'),
			'true',
		);
		assert.equal(await page.locator('.bots-rail').count(), 0);
		await page.locator('[data-terminay-bot-config-tab="memories"]').click();
		await page.locator('[data-terminay-bot-mode-button="chat"]').click();
		assert.equal(
			await page.locator('[data-terminay-bot-composer]').inputValue(),
			'half a thought',
		);
		await page.locator('[data-terminay-bot-mode-button="configure"]').click();
		assert.equal(
			await page
				.locator('[data-terminay-bot-config-tab="memories"]')
				.getAttribute('aria-selected'),
			'true',
		);
	} finally {
		await page.close();
	}
});

async function profile(patch) {
	const page = await open(TAB(patch));
	await page.locator('[data-terminay-bot-mode-button="configure"]').click();
	await page.locator('[data-terminay-bot-panel="profile"]').waitFor();
	return page;
}

test('an Autonomous-only agent shows the approval mode fixed, with the reason', async () => {
	const page = await profile({ bots: [bot(BIRD, 'Bird')] });
	try {
		assert.equal(
			await page.locator('[data-terminay-bot-approval="ask"]').isDisabled(),
			true,
		);
		assert.match(
			await page.locator('[data-terminay-bot-approval-note]').innerText(),
			/cannot ask permission inside a container/,
		);
		await shot(page, 'profile');
	} finally {
		await page.close();
	}
});

test('the agent picker groups agents by extension with their status and action', async () => {
	const page = await profile({});
	try {
		await page.locator('[data-terminay-bot-profile="agent"]').click();
		const groups = await page
			.locator('.bots-dd__panel fieldset')
			.evaluateAll((g) => g.map((x) => x.getAttribute('aria-label')));
		assert.deepEqual(groups, ['Built-in agents', 'Acme agents']);
		assert.match(
			await page
				.locator('[data-terminay-bot-agent-option="claude-code"]')
				.innerText(),
			/Not signed in · Add a sign-in token/,
		);
		await page.locator('[data-terminay-bot-agent-option="codex"]').click();
		assert.equal(
			await page
				.locator('[data-terminay-bot-profile="model"]')
				.getAttribute('data-grouped-select-value'),
			'',
		);
	} finally {
		await page.close();
	}
});

test('Claude Code offers only tokens, and a saved secret is never shown', async () => {
	const page = await profile({
		signIn: {
			device: null,
			tokens: [
				{
					variable: 'CLAUDE_CODE_OAUTH_TOKEN',
					kind: 'sign-in-token',
					label: 'Sign-in token',
					help: '',
					configured: false,
				},
				{
					variable: 'ANTHROPIC_API_KEY',
					kind: 'api-key',
					label: 'API key',
					help: '',
					configured: false,
				},
			],
		},
	});
	try {
		await page
			.locator('[data-terminay-bot-token="ANTHROPIC_API_KEY"]')
			.waitFor();
		assert.equal(
			await page
				.locator('[data-terminay-bot-signin-option="host-login"]')
				.count(),
			0,
		);
		assert.equal(await page.locator('[data-terminay-bot-token]').count(), 2);
		const secret = 'sk-ant-secret-value-123';
		await page
			.locator('[data-terminay-bot-token-input="ANTHROPIC_API_KEY"]')
			.fill(secret);
		await page
			.locator(
				'[data-terminay-bot-token="ANTHROPIC_API_KEY"] button[type="submit"]',
			)
			.click();
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) =>
					c.op === 'transport.commandWithBody' &&
					c.args[0] === 'bots.credentials.save',
			),
		);
		assert.equal(
			await page
				.locator('[data-terminay-bot-token-input="ANTHROPIC_API_KEY"]')
				.inputValue(),
			'',
		);
		const html = await page.content();
		assert.equal(html.includes(secret), false);
		assert.match(
			await page
				.locator('[data-terminay-bot-token="ANTHROPIC_API_KEY"]')
				.innerText(),
			/agent and the tools it runs can read this token/,
		);
	} finally {
		await page.close();
	}
});

test('Chat shows the not-signed-in refusal with a link to Sign-in', async () => {
	const page = await open(
		TAB({
			bots: [{ ...bot(BIRD, 'Bird'), signIn: { kind: 'none' } }],
			sessions: {},
			sendRefusal:
				'This bot is not signed in. Choose how it signs in under Configure › Profile › Sign-in.',
		}),
	);
	try {
		await page.locator('[data-terminay-bot-composer]').fill('hello');
		await page.locator('[data-terminay-bot-send]').click();
		const note = page.getByRole('alert');
		await note.waitFor();
		assert.match(await note.innerText(), /not signed in/);
		await page
			.locator('[data-terminay-bot-open-signin]')
			.evaluate((el) => el.click());
		await page.locator('[data-terminay-bot-panel="profile"]').waitFor();
	} finally {
		await page.close();
	}
});

const START_FAILED =
	'The execution could not start. Check sign-in and the container engine, then retry.';
const failedChat = (starts) =>
	TAB({ bots: [bot(BIRD, 'Bird')], sessions: {}, starts });
async function sendChat(page, text) {
	await page.locator('[data-terminay-bot-composer]').fill(text);
	await page.locator('[data-terminay-bot-send]').click();
	await page.getByText(text, { exact: true }).waitFor();
}
const startFailures = (page) =>
	page.locator('[data-terminay-bot-start-failure]');

test('a start failure warning hides once a later message starts', async () => {
	const page = await open(failedChat([START_FAILED, null]));
	try {
		await sendChat(page, 'first try');
		await startFailures(page).first().waitFor();
		assert.match(await startFailures(page).innerText(), /then retry\./);
		await shot(page, 'start-failure-warning');
		await sendChat(page, 'second try');
		await startFailures(page).first().waitFor({ state: 'detached' });
	} finally {
		await page.close();
	}
});

test('each unresolved start failure shows its own warning until deleted', async () => {
	const page = await open(failedChat([START_FAILED, START_FAILED]));
	try {
		await sendChat(page, 'first try');
		await sendChat(page, 'second try');
		await page.waitForFunction(
			() =>
				document.querySelectorAll('[data-terminay-bot-start-failure]')
					.length === 2,
		);
		await page
			.getByText('first try', { exact: true })
			.click({ button: 'right' });
		await page.getByText('Delete message').click();
		await page.waitForFunction(
			() =>
				document.querySelectorAll('[data-terminay-bot-start-failure]')
					.length === 1,
		);
	} finally {
		await page.close();
	}
});

test('Dismiss hides a start failure through the server', async () => {
	const page = await open(failedChat([START_FAILED]));
	try {
		await sendChat(page, 'first try');
		await page.locator('[data-terminay-bot-start-failure-dismiss]').click();
		await startFailures(page).first().waitFor({ state: 'detached' });
		await shot(page, 'start-failure-dismissed');
		const sent = (await calls(page, 'transport.command')).filter(
			(c) => c.args[0] === 'bots.messages.dismiss',
		);
		assert.equal(sent.length, 1);
		assert.equal(sent[0].args[1].revision, 1);
		assert.equal(sent[0].args[1].attempt, 1);
	} finally {
		await page.close();
	}
});

test('Retry hides the warning when the execution starts', async () => {
	const page = await open(failedChat([START_FAILED, null]));
	try {
		await sendChat(page, 'first try');
		await page.locator('[data-terminay-bot-start-failure-retry]').click();
		await startFailures(page).first().waitFor({ state: 'detached' });
		await shot(page, 'start-failure-retried');
		const commands = (await calls(page, 'transport.command')).map(
			(c) => c.args[0],
		);
		assert.equal(
			commands.filter((op) => op === 'bots.messages.retry').length,
			1,
		);
		assert.equal(
			commands.filter((op) => op === 'bots.messages.post').length,
			1,
		);
	} finally {
		await page.close();
	}
});

test('Retry keeps the warning with the new reason when it fails again', async () => {
	const page = await open(
		failedChat([START_FAILED, 'This bot is not signed in.']),
	);
	try {
		await sendChat(page, 'first try');
		await page.locator('[data-terminay-bot-start-failure-retry]').click();
		await page
			.locator('[data-terminay-bot-start-failure]', {
				hasText: 'This bot is not signed in.',
			})
			.waitFor();
		assert.equal(await startFailures(page).count(), 1);
		await shot(page, 'start-failure-retry-failed-again');
		await page.locator('[data-terminay-bot-start-failure-retry]').click();
		const retries = (await calls(page, 'transport.command')).filter(
			(c) => c.args[0] === 'bots.messages.retry',
		);
		assert.deepEqual(
			retries.map((c) => c.args[1].attempt),
			[1, 2],
		);
	} finally {
		await page.close();
	}
});

test('a dismissal from another client hides the warning', async () => {
	const page = await open(failedChat([START_FAILED]));
	try {
		await sendChat(page, 'first try');
		const id = await startFailures(page)
			.first()
			.getAttribute('data-terminay-bot-start-failure');
		await page.evaluate(
			([botId, messageId]) => window.__dismissElsewhere(botId, messageId),
			[BIRD, id],
		);
		await startFailures(page).first().waitFor({ state: 'detached' });
	} finally {
		await page.close();
	}
});

const CODEX_SIGN_IN = (signedIn) => ({
	device: {
		label: 'Sign in with ChatGPT',
		help: 'Opens a code to enter on chatgpt.com.',
		signedIn,
	},
	tokens: [
		{
			variable: 'OPENAI_API_KEY',
			kind: 'api-key',
			label: 'API key',
			help: '',
			configured: false,
		},
	],
});

test('a new bot shows Not signed in, and has no shared-login option', async () => {
	const page = await profile({
		bots: [{ ...bot(BIRD, 'Bird'), signIn: { kind: 'none' } }],
		signIn: CODEX_SIGN_IN(false),
	});
	try {
		const section = page.locator('[data-terminay-bot-signin="none"]');
		await section.waitFor();
		assert.match(await section.innerText(), /not signed in/i);
		assert.equal(
			await page
				.locator('[data-terminay-bot-signin-option="host-login"]')
				.count(),
			0,
		);
		assert.equal(
			await page
				.locator('[data-terminay-bot-signin-option="device"]')
				.isDisabled(),
			true,
		);
	} finally {
		await page.close();
	}
});

test('device sign-in opens an inline terminal for the sign-in command, and Close abandons it', async () => {
	const page = await profile({
		bots: [{ ...bot(BIRD, 'Bird'), signIn: { kind: 'none' } }],
		signIn: CODEX_SIGN_IN(false),
	});
	try {
		await page.locator('[data-terminay-bot-device="signed-out"]').waitFor();
		await page.locator('[data-terminay-bot-device-start]').click();
		await page.locator('[data-terminay-bot-device-terminal]').waitFor();
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) => c.op === 'transport.command' && c.args[0] === 'bots.shell.open',
			),
		);
		const open = (await calls(page, 'transport.command')).find(
			(c) => c.args[0] === 'bots.shell.open',
		);
		assert.equal(open.args[1].purpose, 'sign-in');
		await page
			.locator('[data-terminay-bot-device-terminal] button', {
				hasText: 'Close',
			})
			.click();
		assert.equal(
			await page.locator('[data-terminay-bot-device-terminal]').count(),
			0,
		);
		// Abandoning changes nothing: the bot is still not signed in.
		assert.equal(
			(await calls(page, 'save')).some((c) => c.args[0]?.signIn !== undefined),
			false,
		);
	} finally {
		await page.close();
	}
});

test('a device-signed-in bot can choose it and sign out', async () => {
	const page = await profile({
		bots: [{ ...bot(BIRD, 'Bird'), signIn: { kind: 'device' } }],
		signIn: CODEX_SIGN_IN(true),
	});
	try {
		await page.locator('[data-terminay-bot-device="signed-in"]').waitFor();
		assert.equal(
			await page
				.locator('[data-terminay-bot-signin-option="device"]')
				.isChecked(),
			true,
		);
		await page.locator('[data-terminay-bot-device-signout]').click();
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) =>
					c.op === 'transport.command' &&
					c.args[0] === 'bots.credentials.device-sign-out',
			),
		);
	} finally {
		await page.close();
	}
});

async function environment(sub, patch = {}) {
	const page = await open(TAB(patch));
	await page.locator('[data-terminay-bot-mode-button="configure"]').click();
	await page.locator('[data-terminay-bot-config-tab="environment"]').click();
	await page.locator(`[data-terminay-bot-env-tab="${sub}"]`).click();
	// Machine details and settings sit behind the Overview's footer toggle.
	if (sub === 'overview')
		await page.locator('[data-terminay-bot-env-details]').click();
	return page;
}

test('Environment › Overview shows state, image, limits and usage, with Recreate to update', async () => {
	const page = await environment('overview');
	try {
		await page.locator('[data-terminay-bot-env-state="running"]').waitFor();
		const text = await page
			.locator('[data-terminay-bot-env-state]')
			.innerText();
		assert.match(text, /terminay-bot-birdbot00001-home/);
		assert.match(text, /2 CPU/);
		assert.match(text, /12\.5%/);
		await page.locator('[data-terminay-bot-env-outdated]').waitFor();
		const before = (await calls(page, 'overview')).length;
		await page.locator('[data-terminay-bot-env-refresh]').click();
		await page.waitForFunction(
			(n) => window.__calls.filter((c) => c.op === 'overview').length > n,
			before,
		);
		await shot(page, 'environment-overview');
	} finally {
		await page.close();
	}
});

test('Environment › Overview settings: default proxy, limits and idle stop save, pending changes offer Recreate', async () => {
	const page = await environment('overview', { limitsChangePending: true });
	try {
		const settings = page.locator('[data-terminay-bot-env-settings]');
		await settings.waitFor();
		await page.locator('[data-terminay-bot-env-pending]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-env-pending]').innerText(),
			/new limits apply when the container is recreated/,
		);

		await settings
			.locator('[data-terminay-bot-engine-access="proxy"]')
			.waitFor();
		assert.equal(
			await settings
				.getByRole('switch', { name: 'Share engine socket' })
				.count(),
			0,
		);
		assert.equal((await calls(page, 'setSettings')).length, 0);

		// Limits: invalid input is explained, valid input saves.
		const cpus = settings.locator('[data-terminay-bot-env-limit="cpus"]');
		await cpus.fill('0');
		assert.match(await settings.innerText(), /CPUs must be more than 0/);
		await cpus.fill('4');
		await settings.locator('[data-terminay-bot-env-limits-save]').click();
		await page.waitForFunction(
			() => window.__calls.filter((c) => c.op === 'setSettings').length === 1,
		);
		const limits = (await calls(page, 'setSettings'))[0].args[0];
		assert.deepEqual(limits.limits, {
			cpus: 4,
			memoryBytes: 4 * 1024 ** 3,
			pids: 512,
		});

		await settings
			.locator('[data-terminay-bot-env-idle]')
			.selectOption({ label: 'Never' });
		await page.waitForFunction(
			() => window.__calls.filter((c) => c.op === 'setSettings').length === 2,
		);
		assert.equal(
			(await calls(page, 'setSettings'))[1].args[0].idleStopMs,
			null,
		);
		await shot(page, 'environment-settings');
	} finally {
		await page.close();
	}
});

test('Environment › Overview: a stale save is read again, not overwritten', async () => {
	const page = await environment('overview', { settingsRefusal: 'conflict' });
	try {
		const settings = page.locator('[data-terminay-bot-env-settings]');
		await settings.waitFor();
		const before = (await calls(page, 'settings')).length;
		await settings
			.locator('[data-terminay-bot-env-idle]')
			.selectOption({ label: '1 hour' });
		await page.waitForFunction(
			(n) => window.__calls.filter((c) => c.op === 'settings').length > n,
			before,
		);
		await settings.getByText(/changed elsewhere/).waitFor();
	} finally {
		await page.close();
	}
});

test('Environment › Files lists the home and shows credential links as locked', async () => {
	const page = await environment('files', {
		files: [
			{ name: '.codex', kind: 'dir', size: 0, mtime: NOW },
			{ name: 'auth.json', kind: 'credential-link', size: 0, mtime: NOW },
			{ name: 'notes.md', kind: 'file', size: 120, mtime: NOW },
		],
	});
	try {
		await page.locator('[data-terminay-bot-file="notes.md"]').waitFor();
		const locked = page.locator('[data-terminay-bot-file="auth.json"]');
		assert.equal(await locked.locator('button.bots-rowbtn').isDisabled(), true);
		assert.match(await locked.innerText(), /Locked/);
	} finally {
		await page.close();
	}
});

test('Environment › Shell opens a shell stream sized to the terminal', async () => {
	const page = await environment('shell');
	try {
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) => c.op === 'transport.command' && c.args[0] === 'bots.shell.open',
			),
		);
		const open = (await calls(page, 'transport.command')).find(
			(c) => c.args[0] === 'bots.shell.open',
		);
		assert.equal(open.args[1].botId, BIRD);
		assert.ok(open.args[1].cols > 0 && open.args[1].rows > 0);
		await page.locator('[data-terminay-bot-shell="ended"]').waitFor();
	} finally {
		await page.close();
	}
});

test('Environment › Desktop opens view-only, and Control opens a new stream', async () => {
	const page = await environment('desktop');
	try {
		const opens = () =>
			page.evaluate(() =>
				window.__calls
					.filter(
						(c) =>
							c.op === 'transport.command' && c.args[0] === 'bots.desktop.open',
					)
					.map((c) => c.args[1]),
			);
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.args[0] === 'bots.desktop.open'),
		);
		assert.equal((await opens()).at(-1).mode, 'view-only');
		await page
			.locator('[data-terminay-bot-desktop-mode-button="control"]')
			.click();
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) =>
					c.args[0] === 'bots.desktop.open' && c.args[1].mode === 'control',
			),
		);
		const all = await opens();
		assert.notEqual(all.at(-1).generation, all[0].generation);
	} finally {
		await page.close();
	}
});

test('Environment › Containers explains proxy attribution without an opt-in setting', async () => {
	const page = await environment('containers');
	try {
		const panel = page.locator('[data-terminay-bot-env-containers]');
		assert.match(
			await panel.innerText(),
			/created through this bot’s engine proxy/,
		);
		assert.match(await panel.innerText(), /control other containers/);
		assert.equal(
			await page.locator('[data-terminay-bot-socket-off]').count(),
			0,
		);
	} finally {
		await page.close();
	}
});

const WORKLOAD = {
	id: 'a'.repeat(64),
	name: 'hello-world-bb73c3b01ad6-hello-world-1',
	image: 'docker.io/library/python:3.13-alpine',
	state: 'running',
	ports: JSON.stringify({
		'8080/tcp': [
			{ HostIp: '0.0.0.0', HostPort: '8080' },
			{ HostIp: '::', HostPort: '8080' },
		],
	}),
	createdAt: new Date(NOW - 120_000).toISOString(),
};

test('Containers presents readable workloads without overflow or stacked actions at wide and narrow sizes', async () => {
	const page = await environment('containers', {
		containers: [
			WORKLOAD,
			{
				...WORKLOAD,
				id: 'b'.repeat(64),
				name: 'database',
				state: 'exited',
				ports: '{}',
				createdAt: '',
			},
			{
				...WORKLOAD,
				id: 'c'.repeat(64),
				name: 'dns',
				ports: JSON.stringify({
					'53/udp': [{ HostIp: '127.0.0.1', HostPort: '5353' }],
					'9000/tcp': null,
				}),
			},
		],
	});
	try {
		const row = page.locator(`[data-terminay-bot-sibling="${WORKLOAD.id}"]`);
		await row.waitFor();
		assert.equal(await row.locator('.bots-container__port').count(), 1);
		assert.equal(
			await row.locator('.bots-container__port').innerText(),
			'8080 → 8080',
		);
		assert.match(await row.locator('time').innerText(), /2m ago/);
		assert.ok(await row.locator('time').getAttribute('title'));
		assert.match(
			await page
				.locator(`[data-terminay-bot-sibling="${'b'.repeat(64)}"]`)
				.innerText(),
			/None published/,
		);
		assert.match(
			await page
				.locator(`[data-terminay-bot-sibling="${'b'.repeat(64)}"] time`)
				.innerText(),
			/Unknown/,
		);
		const dns = page.locator(`[data-terminay-bot-sibling="${'c'.repeat(64)}"]`);
		assert.match(await dns.innerText(), /127.0.0.1:5353 → 53\/udp/);
		assert.match(await dns.innerText(), /9000\/tcp \(internal\)/);
		for (const width of [1920, 1000, 760, 480]) {
			await page.setViewportSize({ width, height: 900 });
			const layout = await row.evaluate((node) => {
				const bounds = node.getBoundingClientRect();
				const actions = [
					...node.querySelectorAll('.bots-container__actions button'),
				].map((button) => button.getBoundingClientRect());
				return {
					overflow: node.scrollWidth > node.clientWidth,
					actions: actions.map((a) => ({ top: a.top, right: a.right })),
					right: bounds.right,
				};
			});
			assert.equal(layout.overflow, false, `row overflow at ${width}`);
			assert.ok(
				layout.actions.every(
					(a) => Math.abs(a.top - layout.actions[0].top) < 1,
				),
				`stacked actions at ${width}`,
			);
			assert.ok(
				layout.actions.every((a) => a.right <= layout.right),
				`clipped actions at ${width}`,
			);
			assert.equal(
				await row
					.locator('.bots-container__identity strong')
					.getAttribute('title'),
				WORKLOAD.name,
			);
			await shot(page, `containers-${width}`);
		}
	} finally {
		await page.close();
	}
});

test('Containers keeps actions scoped and removal uses a cancelable native confirmation', async () => {
	const page = await environment('containers', { containers: [WORKLOAD] });
	try {
		const row = page.locator(`[data-terminay-bot-sibling="${WORKLOAD.id}"]`);
		await row.getByRole('button', { name: 'Stop', exact: true }).click();
		await row
			.getByRole('button', { name: `Restart ${WORKLOAD.name}`, exact: true })
			.click();
		await row
			.getByRole('button', { name: `Logs for ${WORKLOAD.name}`, exact: true })
			.click();
		await row
			.getByRole('button', { name: `Remove ${WORKLOAD.name}`, exact: true })
			.click();
		const dialog = page.getByRole('alertdialog');
		await dialog.waitFor();
		assert.equal(await dialog.evaluate((node) => node.matches(':modal')), true);
		assert.equal(
			await dialog
				.getByRole('button', { name: 'Cancel', exact: true })
				.evaluate((node) => node === document.activeElement),
			true,
		);
		await shot(page, 'containers-remove-dialog');
		assert.deepEqual(
			(await calls(page, 'containerAction')).map((c) => c.args.slice(1, 3)),
			[
				[WORKLOAD.id, 'stop'],
				[WORKLOAD.id, 'restart'],
				[WORKLOAD.id, 'logs'],
			],
		);
		await page.keyboard.press('Escape');
		await dialog.waitFor({ state: 'detached' });
		await row
			.getByRole('button', { name: `Remove ${WORKLOAD.name}`, exact: true })
			.click();
		await dialog
			.getByRole('button', { name: 'Remove container', exact: true })
			.click();
		assert.deepEqual((await calls(page, 'containerAction')).at(-1).args, [
			BIRD,
			WORKLOAD.id,
			'remove',
			true,
		]);
	} finally {
		await page.close();
	}
});

async function configure(tab, patch = {}) {
	const page = await open(TAB(patch));
	await page.locator('[data-terminay-bot-mode-button="configure"]').click();
	await page.locator(`[data-terminay-bot-config-tab="${tab}"]`).click();
	return page;
}

test('Memories lists, pins and edits memories', async () => {
	const page = await configure('memories');
	try {
		await page.locator('[data-terminay-bot-memory="deploy-notes.md"]').click();
		await page.locator('[data-terminay-bot-memory-text]').waitFor();
		await page
			.locator('[data-terminay-bot-memory-text]')
			.fill('# Deploy notes\n\nUse canaries.');
		await page.locator('[data-terminay-bot-memory-save]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'writeMemory'),
		);
		await page.locator('[data-terminay-bot-memory-pin="on"]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'pinMemory'),
		);
		const [pin] = await calls(page, 'pinMemory');
		assert.deepEqual(pin.args.slice(0, 3), [BIRD, 'deploy-notes.md', false]);
	} finally {
		await page.close();
	}
});

test('Triggers shows plain words, missed firings, upcoming, and Run now on a disabled trigger', async () => {
	const page = await configure('triggers');
	try {
		const row = page.locator('[data-terminay-bot-trigger="tr1"]');
		await row.waitFor();
		for (const width of [1920, 760]) {
			await page.setViewportSize({ width, height: 900 });
			const layout = await page
				.locator('[data-terminay-bot-panel="triggers"]')
				.evaluate((panel) => {
					const style = getComputedStyle(panel);
					const content = panel
						.querySelector('.bots-trigpage')
						.getBoundingClientRect();
					const button = panel
						.querySelector('[data-terminay-bot-trigger-new]')
						.getBoundingClientRect();
					const bounds = panel.getBoundingClientRect();
					return {
						available:
							panel.clientWidth -
							parseFloat(style.paddingLeft) -
							parseFloat(style.paddingRight),
						content: content.width,
						buttonRight: button.right,
						right:
							bounds.left + panel.clientWidth - parseFloat(style.paddingRight),
						overflow: panel.scrollWidth > panel.clientWidth,
					};
				});
			assert.ok(
				Math.abs(layout.content - layout.available) < 1,
				`Triggers fills a ${width}px panel`,
			);
			assert.ok(
				Math.abs(layout.buttonRight - layout.right) < 1,
				'New trigger aligns with the panel right padding',
			);
			assert.equal(layout.overflow, false);
		}
		await page.setViewportSize({ width: 1280, height: 820 });
		assert.match(await row.innerText(), /weekday/i);
		await page.locator('[data-terminay-bot-trigger-missed="1"]').waitFor();
		await page.locator('[data-terminay-bot-trigger-run="tr1"]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'runTrigger'),
		);
		assert.equal((await calls(page, 'enableTrigger')).length, 0);
		assert.match(
			await page.locator('[data-terminay-bot-upcoming-strip]').innerText(),
			/Nightly build/,
		);
		await shot(page, 'triggers-table');
		await page.locator('[data-terminay-bot-trigger-new]').click();
		const editor = page.locator('[data-terminay-bot-trigger-editor]');
		await pick(editor, 'Source', 'every');
		await page.locator('[data-terminay-bot-trigger-field="every"]').fill('0.5');
		await pick(editor, 'Unit', 'minutes');
		assert.match(
			await page.locator('[data-terminay-bot-trigger-preview]').innerText(),
			/at least 1 minute/,
		);
		await shot(page, 'triggers');
	} finally {
		await page.close();
	}
});

test('Sessions filters and reads diagnostics without conversation continuation', async () => {
	const page = await configure('sessions', {
		sessions: {
			[BIRD]: [
				session('s2', BIRD, {
					state: 'failed',
					open: false,
					canLoad: false,
					reason: 'agent crashed',
					runnerOutput: 'boom',
				}),
				session('s1', BIRD, { state: 'running', startedAt: NOW - 900_000 }),
			],
		},
		transcripts: { s2: [{ kind: 'user', text: 'Run it' }] },
	});
	try {
		await page.locator('[data-terminay-bot-session="s2"]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-session-lifetime]').innerText(),
			/Desktop apps stay open/,
		);
		assert.match(
			await page.locator('[data-terminay-bot-session-lifetime]').innerText(),
			/Stopping the bot container ends desktop apps/,
		);
		assert.equal(
			await page.locator('[data-terminay-bot-session-continue]').count(),
			0,
		);
		await page.locator('[data-terminay-bot-runner] summary').click();
		assert.match(
			await page.locator('[data-terminay-bot-runner]').innerText(),
			/boom/,
		);
		await page
			.locator('[data-terminay-bot-sessions-outcome]')
			.selectOption('failed');
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) => c.op === 'sessions' && c.args[1]?.state === 'failed',
			),
		);
		await page.locator('[data-terminay-bot-session-row="s1"]').click();
		await page.locator('[data-terminay-bot-session-stop]').waitFor();
		await shot(page, 'sessions');
	} finally {
		await page.close();
	}
});

test('Use this engine asks before replacing a pinned engine', async () => {
	const page = await open({
		...FLEET,
		engine: {
			engine: 'docker',
			available: true,
			reason: null,
			detail: '',
			pinned: { kind: 'docker', address: 'unix:///var/run/docker.sock' },
			candidates: [
				{
					kind: 'docker',
					address: 'unix:///var/run/docker.sock',
					available: true,
					reason: null,
				},
				{
					kind: 'podman',
					address: 'unix:///p.sock',
					available: true,
					reason: null,
				},
			],
			runningContainers: 0,
			botContainers: 0,
			image: { state: 'current', fingerprint: 'abc', builtAt: 1, error: null },
		},
	});
	try {
		const uses = () =>
			page.evaluate(() =>
				window.__calls
					.filter(
						(c) =>
							c.op === 'transport.command' && c.args[0] === 'bots.engine.use',
					)
					.map((c) => c.args[1]),
			);
		await page.locator('[data-terminay-bots-engine-use="podman"]').click();
		await page
			.getByRole('alertdialog', { name: 'Switch to Podman?' })
			.waitFor();
		assert.deepEqual(await uses(), []);
		await page.locator('[data-terminay-bots-engine-confirm]').click();
		await page.waitForFunction(() =>
			window.__calls.some(
				(c) => c.op === 'transport.command' && c.args[0] === 'bots.engine.use',
			),
		);
		assert.deepEqual(await uses(), [
			{ kind: 'podman', address: 'unix:///p.sock', confirmed: true },
		]);
	} finally {
		await page.close();
	}
});

test('changed engine at the same long socket address keeps its recovery action visible inside the rail', async () => {
	const address = `unix:///private/var/folders/${'long-machine-socket-path-'.repeat(8)}/podman-machine-default-api.sock`;
	const page = await open({
		...FLEET,
		engine: {
			engine: 'podman',
			available: false,
			reason: 'engine-changed',
			detail: 'Select the engine again',
			pinned: { kind: 'podman', address },
			candidates: [{ kind: 'podman', address, available: true, reason: null }],
			runningContainers: 0,
			botContainers: 0,
			image: {
				state: 'missing',
				fingerprint: null,
				builtAt: null,
				error: null,
			},
		},
	});
	try {
		const use = page.getByRole('button', { name: 'Use this engine' });
		await use.waitFor({ state: 'visible' });
		const box = await use.boundingBox(),
			rail = await page.locator('.bots-rail').boundingBox();
		assert.ok(box && rail);
		assert.ok(
			box.x >= rail.x && box.x + box.width <= rail.x + rail.width,
			'button stays inside rail',
		);
		const overflow = await page
			.locator('.bots-rail')
			.evaluate((el) => el.scrollWidth > el.clientWidth);
		assert.equal(
			overflow,
			false,
			'socket path cannot force horizontal scrolling',
		);
		await use.click();
		await page
			.getByRole('alertdialog', { name: 'Switch to Podman?' })
			.waitFor();
		await shot(page, 'engine-pin-recovery-long-socket');
	} finally {
		await page.close();
	}
});

test('right-click edits user messages, deletes assistant messages, and clear chat confirms or cancels', async () => {
	const page = await open(
		TAB({
			sessions: { [BIRD]: [session('s1', BIRD, { state: 'completed' })] },
		}),
	);
	try {
		// Match Dockview's offset, transformed pane, which creates a fixed-position containing block.
		await page.locator('.bots-tab').evaluate((el) => {
			el.style.transform = 'translate(70px, 35px)';
			el.style.width = 'calc(100% - 140px)';
			el.style.height = 'calc(100% - 70px)';
		});
		const target = await page
			.locator('[data-terminay-message-key="user:0"]')
			.boundingBox();
		const pointer = { x: target.x + 35, y: target.y + 20 };
		await page.mouse.click(pointer.x, pointer.y, { button: 'right' });
		const menuBox = await page.locator('.context-menu').boundingBox();
		assert.ok(
			Math.abs(menuBox.x - pointer.x) < 2 &&
				Math.abs(menuBox.y - pointer.y) < 2,
			'menu opens at the pointer even inside an offset transformed pane',
		);
		await page.getByRole('button', { name: 'Edit message' }).click();
		const editor = page.getByRole('dialog', { name: 'Edit message' });
		await editor
			.getByRole('textbox', { name: 'Message text' })
			.fill('Updated request');
		await editor.getByRole('button', { name: 'Save message' }).click();
		await page.getByText('Updated request', { exact: true }).waitFor();
		assert.equal(
			(await calls(page, 'transport.command')).find(
				(c) => c.args[0] === 'bots.messages.edit',
			).args[1].text,
			'Updated request',
		);
		await page
			.locator('[data-terminay-message-key="agent:1"]')
			.click({ button: 'right' });
		await page.getByRole('button', { name: 'Delete message' }).click();
		await page.waitForFunction(
			() => !document.querySelector('[data-terminay-message-key="agent:1"]'),
		);
		assert.equal(
			(await calls(page, 'transport.command')).filter(
				(c) => c.args[0] === 'bots.messages.remove',
			).length,
			1,
		);
		await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
		const dialogBox = await page.getByRole('alertdialog').boundingBox();
		const viewport = page.viewportSize();
		assert.ok(
			Math.abs(dialogBox.x + dialogBox.width / 2 - viewport.width / 2) < 2,
			'dialog centers in the viewport',
		);
		assert.equal(
			await page
				.getByRole('alertdialog')
				.evaluate((el) => getComputedStyle(el).gap),
			'14px',
		);
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Cancel' })
			.click();
		assert.equal(
			(await calls(page, 'transport.command')).filter(
				(c) => c.args[0] === 'bots.messages.clear',
			).length,
			0,
		);
		await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'Clear chat', exact: true })
			.click();
		await page.locator('[data-terminay-bot-chat="empty"]').waitFor();
		assert.equal(
			(await calls(page, 'transport.command')).filter(
				(c) => c.args[0] === 'bots.messages.clear',
			).length,
			1,
		);
	} finally {
		await page.close();
	}
});

test('completed turns keep unreported tool outcomes neutral instead of spinning or claiming success', async () => {
	for (const state of ['running', 'completed', 'stopped', 'failed']) {
		const page = await open(
			TAB({
				sessions: { [BIRD]: [session('s1', BIRD, { state })] },
				transcripts: {
					s1: [
						{ kind: 'user', text: 'Open browser' },
						{
							sessionUpdate: 'tool_call',
							toolCallId: 'browser',
							title: 'chromium',
							status: 'in_progress',
						},
					],
				},
			}),
		);
		try {
			await page.locator('.bots-sess').first().click();
			const tool = page.locator('[data-terminay-bot-tool="browser"]');
			await tool.waitFor();
			assert.equal(
				await tool.locator('.bots-spin').count(),
				state === 'running' ? 1 : 0,
			);
			if (state !== 'running')
				await tool
					.getByText('chromium · No final status reported', { exact: true })
					.waitFor();
		} finally {
			await page.close();
		}
	}
});

test('chat renders container screenshots inline and blocks remote images and host paths', async () => {
	const page = await open(
		TAB({
			sessions: { [BIRD]: [session('s1', BIRD, { state: 'completed' })] },
			transcripts: {
				s1: [
					{ kind: 'user', text: 'Show screenshot' },
					{
						sessionUpdate: 'agent_message_chunk',
						content: {
							type: 'text',
							text: '![BBC screenshot](/tmp/desktop-after.png)\n![Missing](/tmp/missing.png)\n![Remote](https://example.com/track.png)\n![Host](/etc/secret.png)',
						},
					},
				],
			},
		}),
	);
	try {
		const image = page.getByRole('img', {
			name: 'BBC screenshot',
			exact: true,
		});
		await image.waitFor();
		await page.waitForFunction(
			() => document.querySelector('.bots-inline-image')?.naturalWidth === 1,
		);
		assert.ok((await image.getAttribute('src')).startsWith('blob:'));
		await page
			.getByText('Image unavailable: Missing', { exact: true })
			.waitFor();
		assert.equal(await page.locator('img[src^="https://"]').count(), 0);
		const requests = (await calls(page, 'transport.queryWithBody')).filter(
			(c) => c.args[0] === 'bots.image.read',
		);
		assert.deepEqual(requests.map((c) => c.args[1].path).sort(), [
			'/tmp/desktop-after.png',
			'/tmp/missing.png',
		]);
	} finally {
		await page.close();
	}
});
test('shared history loads older messages on demand without rendering provider traces', async () => {
	const entries = Array.from({ length: 60 }, (_, i) => ({
		kind: 'user',
		text: `Historical message ${i}`,
	}));
	const page = await open(TAB({ transcripts: { s1: entries } }));
	try {
		await page.getByText('Historical message 59', { exact: true }).waitFor();
		assert.equal(await page.locator('[data-terminay-message-key]').count(), 25);
		assert.equal(
			await page.getByText('Historical message 0', { exact: true }).count(),
			0,
		);
		await page.getByRole('button', { name: 'Load older messages' }).click();
		await page.getByText('Historical message 10', { exact: true }).waitFor();
		assert.equal(await page.locator('[data-terminay-message-key]').count(), 50);
		await page.evaluate(() =>
			window.__harness.setTranscript('s1', [
				{
					sessionUpdate: 'agent_message_chunk',
					content: { type: 'text', text: 'Private live output' },
				},
			]),
		);
		assert.equal(
			await page.getByText('Private live output', { exact: true }).count(),
			0,
		);
	} finally {
		await page.close();
	}
});
test('a pending post preserves text typed for the next message', async () => {
	const page = await open(TAB({ postDelayMs: 400 }));
	try {
		const composer = page.locator('[data-terminay-bot-composer]');
		await composer.fill('First message');
		await page.locator('[data-terminay-bot-send]').click();
		await composer.fill('Second message still being written');
		await page.getByRole('button', { name: 'Send', exact: true }).waitFor();
		assert.equal(
			await composer.inputValue(),
			'Second message still being written',
		);
		await page.getByText('First message', { exact: true }).waitFor();
	} finally {
		await page.close();
	}
});

const imageHistory = () => [
	...Array.from({ length: 20 }, (_, i) => ({
		kind: 'user',
		text: `Earlier request ${i}`,
	})),
	{
		sessionUpdate: 'agent_message_chunk',
		content: { type: 'text', text: '![Delayed screenshot](/tmp/late.png)' },
	},
];
const atChatBottom = (page) =>
	page.waitForFunction(() => {
		const el = document.querySelector('.bots-msgs');
		const image = el?.querySelector('img');
		return (
			image?.naturalHeight === 1200 &&
			el.scrollHeight - el.clientHeight - el.scrollTop <= 1
		);
	});
test('Chat opens at the bottom without animation and follows delayed image layout on re-entry', async () => {
	const page = await open(
		TAB({
			imageDelayMs: 350,
			imageSize: { width: 800, height: 1200 },
			transcripts: { s1: imageHistory() },
		}),
	);
	try {
		await atChatBottom(page);
		assert.equal(
			await page
				.locator('.bots-msgs')
				.evaluate((el) => getComputedStyle(el).scrollBehavior),
			'auto',
		);
		await page.locator('.bots-msgs').evaluate((el) => (el.scrollTop = 0));
		await page.locator('[data-terminay-bot-mode-button="configure"]').click();
		await page.locator('[data-terminay-bot-mode-button="chat"]').click();
		await atChatBottom(page);
		// Returning from a hidden Home tab also starts at the latest message.
		await page.locator('.bots-msgs').evaluate((el) => (el.scrollTop = 0));
		await page.evaluate(() => window.__harness.setVisible(false));
		await page.evaluate(() => window.__harness.setVisible(true));
		await atChatBottom(page);
	} finally {
		await page.close();
	}
});
test('a delayed image does not pull readers away from older messages', async () => {
	const page = await open(
		TAB({
			imageDelayMs: 700,
			imageSize: { width: 800, height: 1200 },
			transcripts: { s1: imageHistory() },
		}),
	);
	try {
		await page.getByText('Earlier request 19', { exact: true }).waitFor();
		await page.locator('.bots-msgs').hover();
		await page.mouse.wheel(0, -10000);
		await page.waitForFunction(
			() => document.querySelector('.bots-msgs').scrollTop === 0,
		);
		await page.waitForFunction(
			() =>
				document.querySelector('.bots-inline-image')?.naturalHeight === 1200,
		);
		await page.waitForFunction(
			() => document.querySelector('.bots-msgs').scrollTop === 0,
		);
		assert.equal(
			await page.locator('.bots-msgs').evaluate((el) => el.scrollTop),
			0,
		);
	} finally {
		await page.close();
	}
});

test('layout scroll events before a delayed screenshot do not disable bottom following', async () => {
	const page = await open(
		TAB({
			imageDelayMs: 700,
			imageSize: { width: 1440, height: 900 },
			transcripts: { s1: imageHistory() },
		}),
	);
	try {
		await page.getByText('Earlier request 19', { exact: true }).waitFor();
		await page.locator('.bots-msgs').evaluate((el) => {
			el.scrollTop = 0;
			el.dispatchEvent(new Event('scroll'));
		});
		await page.waitForFunction(() => {
			const el = document.querySelector('.bots-msgs');
			return (
				el.querySelector('img')?.naturalWidth === 1440 &&
				el.scrollHeight - el.clientHeight - el.scrollTop <= 1
			);
		});
		await page
			.getByRole('heading', { name: 'Recent sessions', exact: true })
			.waitFor();
	} finally {
		await page.close();
	}
});

for (const reason of ['not-running', 'engine-changed'])
	test(`individual bot shows actionable ${reason} recovery across Chat and Configure`, async () => {
		const engine = {
			engine: 'podman',
			available: false,
			reason,
			detail: '',
			pinned: { kind: 'podman', address: 'unix:///tmp/podman.sock' },
			candidates: [
				{
					kind: 'podman',
					address: 'unix:///tmp/podman.sock',
					available: reason === 'engine-changed',
					reason: null,
				},
			],
			runningContainers: 0,
			botContainers: 0,
			image: {
				state: 'missing',
				fingerprint: null,
				builtAt: null,
				error: null,
			},
		};
		const page = await open(TAB({ engine }));
		try {
			const recovery = page.locator('[data-terminay-bot-recovery]');
			await recovery
				.locator(`[data-terminay-bots-engine-reason="${reason}"]`)
				.waitFor();
			assert.match(
				await recovery.innerText(),
				reason === 'not-running' ? /Start it/ : /Use this engine/,
			);
			await recovery.getByRole('button', { name: 'Check again' }).click();
			await page
				.getByRole('button', { name: 'Configure', exact: true })
				.click();
			for (const tab of ['environment', 'sessions']) {
				await page.locator(`[data-terminay-bot-config-tab="${tab}"]`).click();
				assert.equal(await recovery.isVisible(), true);
			}
			if (reason === 'engine-changed') {
				await recovery.getByRole('button', { name: 'Use this engine' }).click();
				assert.equal(
					(await calls(page, 'transport.command')).filter(
						(c) => c.args[0] === 'bots.engine.use',
					).length,
					0,
				);
				await recovery.locator('[data-terminay-bots-engine-confirm]').click();
				assert.equal(
					(await calls(page, 'transport.command')).filter(
						(c) => c.args[0] === 'bots.engine.use',
					).length,
					1,
				);
			}
		} finally {
			await page.close();
		}
	});

test('bot summary refresh source uses the cheap state API and no overview measurements', async () => {
	const source = await readFile('src/workspace/bots/useServerBots.ts', 'utf8');
	assert.ok(source.includes('environment.state(botId)'));
	assert.ok(!source.includes('environment.overview('));
});

test('generic source editor groups fields, preserves a narrow draft, and tests without starting AI', async () => {
 const page=await configure('triggers');
 try {
  await page.setViewportSize({width:760,height:900});
  await page.locator('[data-terminay-bot-trigger-new]').click();
  const editor=page.locator('[data-terminay-bot-trigger-editor]');
  await editor.getByLabel('Name',{exact:true}).fill('Incoming items');
  await pick(editor,'Source','command');
  await editor.getByLabel('Command / shell script').fill('list --json');
  await editor.getByLabel('Check every',{exact:true}).fill('1');await pick(editor,'Unit','minutes');
  await pick(editor,'Fire when','items');
  await editor.getByLabel('Prompt',{exact:true}).fill('Inspect risks in this item.');
  assert.equal(await picked(editor,'If Terminay Server was offline'),'once');
  assert.equal(await picked(editor,'First successful check'),'process');
  await editor.getByRole('button',{name:'Close editor'}).click();
  await page.locator('[data-terminay-bot-trigger-new]').click();
  assert.equal(await editor.getByLabel('Command / shell script').inputValue(),'list --json');
  await editor.getByRole('button',{name:'Test source',exact:true}).click();
  await page.getByText('1 event would fire',{exact:true}).waitFor();
  assert.equal((await calls(page,'send')).length,0);
  await shot(page,'command-source');
  await editor.locator('[data-terminay-bot-trigger-save]').click();
  const created=(await calls(page,'createTrigger'))[0].args[1];
  assert.equal(created.condition.kind,'command');assert.equal(created.condition.intervalMs,60000);assert.equal(created.condition.match.identity,'/id');assert.equal(created.recovery,'once');
 } finally {await page.close();}
});

const blockerFor = (id) => ({
	id: id.padEnd(24, '0'),
	reason: 'The support portal refused the login.',
	action: 'Add the support portal password to the bot’s secrets',
	sessionId: 's'.repeat(24),
	at: NOW - 600_000,
	notice: 'posted',
});
const waitingTrigger = (id, patch = {}) => ({
	id,
	botId: BIRD,
	name: id === 'tr2' ? 'Support tickets' : 'Weekly report',
	enabled: true,
	prompt: 'Check new tickets',
	condition: { kind: 'every', intervalMs: 3_600_000, anchor: 0 },
	evaluatedThrough: 0,
	missedCount: 0,
	missedLatest: null,
	blocker: blockerFor(id),
	...patch,
});

test('a trigger waiting for the user shows Needs you with the action and Resume, also when disabled', async () => {
	const page = await configure('triggers', {
		extraTriggers: [waitingTrigger('tr2'), waitingTrigger('tr3', { enabled: false })],
	});
	try {
		const row = page.locator('[data-terminay-bot-trigger="tr2"]');
		await row.waitFor();
		assert.equal(
			await row.locator('[data-terminay-bot-trigger-status]').innerText(),
			'Needs you',
		);
		assert.equal(
			await row.locator('[data-terminay-bot-trigger-status]').getAttribute('data-terminay-bot-trigger-status'),
			'need',
		);
		assert.match(await row.innerText(), /Add the support portal password/);
		assert.match(await row.innerText(), /refused the login/);
		// Disabled takes precedence in the status; Resume is still offered.
		const off = page.locator('[data-terminay-bot-trigger="tr3"]');
		assert.equal(await off.locator('[data-terminay-bot-trigger-status]').innerText(), 'Disabled');
		await off.locator('[data-terminay-bot-trigger-resume="tr3"]').waitFor();
		await shot(page, 'triggers-needs-you');
		await row.locator('[data-terminay-bot-trigger-resume="tr2"]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'resumeTrigger' && c.args[1] === 'tr2'),
		);
		// The editor sheet shows the same, with Resume.
		await row.locator('.bots-trigrow__name').click();
		const sheet = page.locator('[data-terminay-bot-trigger-needs-you="tr2"]').first();
		await page.locator('[data-terminay-bot-trigger-editor] [data-terminay-bot-trigger-needs-you="tr2"]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-trigger-editor] [data-terminay-bot-trigger-needs-you="tr2"]').innerText(),
			/paused until you choose Resume/,
		);
		assert.ok(await sheet.count());
		await shot(page, 'trigger-editor-needs-you');
	} finally {
		await page.close();
	}
});

test('the trigger editor offers Startup retries and When the bot needs you, with defaults', async () => {
	const page = await configure('triggers');
	try {
		await page.locator('[data-terminay-bot-trigger-new]').click();
		const editor = page.locator('[data-terminay-bot-trigger-editor]');
		assert.equal(await picked(editor, 'Startup retries'), '3');
		assert.equal(await picked(editor, 'When the bot needs you'), 'pause');
		await editor.locator('[data-terminay-bot-trigger-field="name"]').fill('Tickets');
		await editor.locator('[data-terminay-bot-trigger-field="prompt"]').fill('Check tickets');
		await pick(editor, 'Source', 'every');
		await editor.locator('[data-terminay-bot-trigger-field="every"]').fill('5');
		await pick(editor, 'Startup retries', '1');
		await pick(editor, 'When the bot needs you', 'keep-running');
		await editor.locator('section[aria-label="If something goes wrong"]').scrollIntoViewIfNeeded();
		await shot(page, 'trigger-editor-failure-settings');
		await editor.locator('[data-terminay-bot-trigger-save]').click();
		await page.waitForFunction(() => window.__calls.some((c) => c.op === 'createTrigger'));
		const [created] = await calls(page, 'createTrigger');
		const draft = created.args.find((a) => a && typeof a === 'object' && 'condition' in a);
		assert.equal(draft.startupRetries, 1);
		assert.equal(draft.onNeedsHuman, 'keep-running');
	} finally {
		await page.close();
	}
});

test('Sessions shows startup attempts and the outcome the bot reported', async () => {
	const attempt = (i) => ({
		stage: 'adapter-check',
		temporary: true,
		code: 'adapter-timeout',
		at: NOW - 300_000 + i * 30_000,
		cause: 'The terminay_bot adapter check timed out. The host may be overloaded.',
	});
	const page = await configure('sessions', {
		sessions: {
			[BIRD]: [
				session('s2', BIRD, {
					state: 'failed',
					open: false,
					canLoad: false,
					reason: 'The terminay_bot adapter check timed out. The host may be overloaded.',
					dispatchedAt: null,
					retryLimit: 3,
					attempts: [0, 1, 2, 3].map(attempt),
					startupFailure: { stage: 'adapter-check', temporary: true, code: 'adapter-timeout' },
				}),
				session('s1', BIRD, {
					state: 'completed',
					open: false,
					dispatchedAt: NOW - 200_000,
					retryLimit: 3,
					attempts: [attempt(0)],
					outcome: {
						disposition: 'needs-human',
						reason: 'The support portal refused the login.',
						action: 'Add the support portal password to the bot’s secrets',
						triggerId: null,
						at: NOW - 100_000,
					},
				}),
			],
		},
	});
	try {
		await page.locator('[data-terminay-bot-session="s2"]').waitFor();
		const attempts = page.locator('[data-terminay-bot-session-attempts]');
		assert.match(await attempts.innerText(), /Failed after 4 attempts\./);
		assert.equal(await attempts.locator('li').count(), 4);
		await shot(page, 'session-retry-attempts');
		await page.locator('[data-terminay-bot-session-row="s1"]').click();
		await page.locator('[data-terminay-bot-session-outcome="needs-human"]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-session-attempts]').innerText(),
			/Started on attempt 2 of 4\./,
		);
		assert.match(
			await page.locator('[data-terminay-bot-session-outcome]').innerText(),
			/Needs you.*refused the login[\s\S]*What to do: Add the support portal password/,
		);
		await shot(page, 'session-outcome');
	} finally {
		await page.close();
	}
});
