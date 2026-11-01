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
	await readFile('src/workspace/bots/botPanels.css', 'utf8'),
].join('\n');
const browser = await chromium.launch({ headless: true });

test.after(async () => {
	await browser.close();
	await rm(directory, { recursive: true, force: true });
});

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

test('Chat streams messages, tool entries and the plan, and offers Stop', async () => {
	const page = await open(TAB());
	try {
		await page.locator('[data-terminay-bot-tool="t1"]').waitFor();
		assert.equal(
			await page
				.locator('[data-terminay-bot-tool="t1"]')
				.getAttribute('data-terminay-bot-tool-status'),
			'completed',
		);
		assert.match(await page.locator('.bots-tx').innerText(), /Looking now\./);
		await page.locator('[data-terminay-bot-tool="t1"] button').click();
		assert.match(
			await page.locator('[data-terminay-bot-tool="t1"]').innerText(),
			/12 passing/,
		);
		assert.equal(
			await page
				.locator('.bots-tx [data-terminay-bot-plan]')
				.getAttribute('data-terminay-bot-plan'),
			'1',
		);
		await page.locator('[data-terminay-bot-stop]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'control'),
		);
		const [stop] = await calls(page, 'control');
		assert.deepEqual(stop.args.slice(0, 3), [BIRD, 's1', 'stop']);
		await shot(page, 'chat');
	} finally {
		await page.close();
	}
});

test('Ask me prompts show the agent’s options; queued messages can be cancelled', async () => {
	const page = await open(
		TAB({
			sessions: {
				[BIRD]: [
					session('s1', BIRD, {
						state: 'needs-you',
						permission: {
							id: 'p1',
							options: [
								{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
								{ optionId: 'reject', name: 'Reject', kind: 'reject_once' },
							],
							toolCall: { title: 'Edit deploy.sh' },
						},
						queuedMessage: {
							id: 'q9',
							text: 'and then deploy',
							status: 'queued',
						},
					}),
				],
			},
		}),
	);
	try {
		await page.locator('[data-terminay-bot-permission-option="allow"]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'decide'),
		);
		const [decide] = await calls(page, 'decide');
		assert.deepEqual(decide.args.slice(0, 4), [BIRD, 's1', 'p1', 'allow']);
		await page.locator('[data-terminay-bot-queued] .bots-link').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'cancelQueued'),
		);
		const [cancel] = await calls(page, 'cancelQueued');
		assert.deepEqual(cancel.args.slice(0, 2), [BIRD, 'q9']);
	} finally {
		await page.close();
	}
});

test('a suspended chat says the next message resumes it, and New chat starts fresh', async () => {
	const page = await open(
		TAB({
			sessions: { [BIRD]: [session('s1', BIRD, { state: 'suspended' })] },
		}),
	);
	try {
		await page.locator('[data-terminay-bot-notice="suspended"]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-notice="suspended"]').innerText(),
			/next message resumes it/,
		);
		await page.locator('[data-terminay-bot-new-chat]').click();
		await page.locator('[data-terminay-bot-chat="empty"]').waitFor();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'newChat'),
		);
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
			await page.locator('[data-terminay-bot-profile="model"]').inputValue(),
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
		const note = page.locator('[data-terminay-bot-chat-error]');
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
			await page.locator('[data-terminay-bot-signin-option="device"]').isDisabled(),
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
			.locator('[data-terminay-bot-device-terminal] button', { hasText: 'Close' })
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
			await page.locator('[data-terminay-bot-signin-option="device"]').isChecked(),
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

test('Environment › Overview settings: the socket asks first, limits and idle stop save, pending changes offer Recreate', async () => {
	const page = await environment('overview', { limitsChangePending: true });
	try {
		const settings = page.locator('[data-terminay-bot-env-settings]');
		await settings.waitFor();
		await page.locator('[data-terminay-bot-env-pending]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-env-pending]').innerText(),
			/new limits apply when the container is recreated/,
		);

		// The socket asks, in the server's words for this engine.
		await settings.getByRole('switch', { name: 'Share engine socket' }).click();
		const warning = page.locator('[data-terminay-bot-socket-warning]');
		await warning.waitFor();
		assert.match(await warning.innerText(), /same as root/);
		assert.equal((await calls(page, 'setSettings')).length, 0);
		await page.locator('[data-terminay-bot-socket-confirm]').click();
		await page.waitForFunction(() =>
			window.__calls.some((c) => c.op === 'setSettings'),
		);
		const [socket] = await calls(page, 'setSettings');
		assert.equal(socket.args[0].shareEngineSocket, true);
		assert.equal(socket.args[0].confirmed, true);
		assert.equal(socket.args[0].expectedRevision, 1);

		// Limits: invalid input is explained, valid input saves.
		const cpus = settings.locator('[data-terminay-bot-env-limit="cpus"]');
		await cpus.fill('0');
		assert.match(await settings.innerText(), /CPUs must be more than 0/);
		await cpus.fill('4');
		await settings.locator('[data-terminay-bot-env-limits-save]').click();
		await page.waitForFunction(
			() => window.__calls.filter((c) => c.op === 'setSettings').length === 2,
		);
		const limits = (await calls(page, 'setSettings'))[1].args[0];
		assert.deepEqual(limits.limits, {
			cpus: 4,
			memoryBytes: 4 * 1024 ** 3,
			pids: 512,
		});

		await settings
			.locator('[data-terminay-bot-env-idle]')
			.selectOption({ label: 'Never' });
		await page.waitForFunction(
			() => window.__calls.filter((c) => c.op === 'setSettings').length === 3,
		);
		assert.equal((await calls(page, 'setSettings'))[2].args[0].idleStopMs, null);
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

test('Environment › Containers explains Share engine socket when it is off', async () => {
	const page = await environment('containers');
	try {
		await page.locator('[data-terminay-bot-socket-off]').waitFor();
		assert.match(
			await page.locator('[data-terminay-bot-socket-off]').innerText(),
			/Share engine socket is off/,
		);
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
		await page.locator('[data-terminay-bot-trigger-new]').click();
		await page.locator('[data-terminay-bot-trigger-kind="every"]').click();
		await page.locator('[data-terminay-bot-trigger-field="every"]').fill('2');
		await page
			.locator('select')
			.filter({ hasText: 'minutes' })
			.selectOption('minutes');
		assert.match(
			await page.locator('[data-terminay-bot-trigger-preview]').innerText(),
			/at least 5 minutes/,
		);
		await shot(page, 'triggers');
	} finally {
		await page.close();
	}
});

test('Sessions filters, reads a transcript, and offers Continue only when it can', async () => {
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
		assert.equal(
			await page.locator('[data-terminay-bot-session-continue]').isDisabled(),
			true,
		);
		assert.match(
			await page.locator('[data-terminay-bot-continue-blocked]').innerText(),
			/cannot resume/,
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
