import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	agentDriverRegistry,
	CLAUDE_CODE_MANAGED_EVENTS,
	claudeCodeDriver,
	CODEX_MANAGED_EVENTS,
	codexDriver,
	isTerminayManagedCommand,
} = await importDrivers();

const context = {
	activationTerminalSessionId: 'terminal-123',
	providerSessionId: 'provider-session',
	sequence: 7,
	occurredAt: 1_725_000_000_000,
};

test('Codex normalizes root session, prompt, tool, wait, and completion events', () => {
	assert.deepEqual(
		codexDriver.normalize(
			{ hook_event_name: 'SessionStart', session_id: 'codex-session' },
			context,
		),
		{
			provider: 'codex',
			sessionId: 'codex-session',
			activationTerminalSessionId: 'terminal-123',
			sequence: 7,
			occurredAt: context.occurredAt,
			kind: 'session.started',
			displayName: undefined,
		},
	);

	const prompt = codexDriver.normalize(
		{
			hook_event_name: 'UserPromptSubmit',
			session_id: 'codex-session',
			prompt: 'Implement the sidebar',
			model: {
				id: 'gpt-5.3-codex',
				reasoning_effort: 'high',
				context_window_tokens: 200_000,
			},
		},
		context,
	);
	assert.equal(prompt.kind, 'turn.started');
	assert.equal(prompt.promptText, 'Implement the sidebar');
	assert.deepEqual(prompt.model, {
		id: 'gpt-5.3-codex',
		displayName: undefined,
		reasoningEffort: 'high',
		contextWindowTokens: 200_000,
	});

	assert.deepEqual(
		codexDriver.normalize(
			{
				hook_event_name: 'PreToolUse',
				session_id: 'codex-session',
				tool_name: 'exec_command',
				tool_use_id: 'tool-1',
				tool_input: { cmd: 'npm test' },
			},
			context,
		),
		{
			provider: 'codex',
			sessionId: 'codex-session',
			activationTerminalSessionId: 'terminal-123',
			sequence: 7,
			occurredAt: context.occurredAt,
			kind: 'tool.started',
			tool: {
				id: 'tool-1',
				name: 'exec_command',
				description: 'npm test',
			},
		},
	);

	const waiting = codexDriver.normalize(
		{
			hook_event_name: 'PermissionRequest',
			session_id: 'codex-session',
			tool_name: 'exec_command',
			message: 'Approval required',
		},
		context,
	);
	assert.equal(waiting.kind, 'wait.started');
	assert.equal(waiting.state, 'waiting');
	assert.equal(waiting.reason, 'Approval required');

	const done = codexDriver.normalize(
		{
			hook_event_name: 'Stop',
			session_id: 'codex-session',
		},
		context,
	);
	assert.equal(done.kind, 'agent.done');
	assert.equal(done.outcome, 'success');
	assert.equal(
		codexDriver.normalize(
			{
				hook_event_name: 'StopFailure',
				session_id: 'codex-session',
				error: 'unsupported Codex event',
			},
			context,
		),
		null,
	);
});

test('Claude Code maps request_user_input and AskUserQuestion to waiting', () => {
	for (const toolName of ['request_user_input', 'AskUserQuestion']) {
		const event = claudeCodeDriver.normalize(
			{
				hook_event_name: 'PreToolUse',
				session_id: 'claude-session',
				tool_name: toolName,
			},
			context,
		);
		assert.equal(event.kind, 'wait.started');
		assert.equal(event.state, 'waiting');
		assert.equal(event.reason, toolName);
	}
	const failed = claudeCodeDriver.normalize(
		{
			hook_event_name: 'StopFailure',
			session_id: 'claude-session',
			error: 'model failed',
		},
		context,
	);
	assert.equal(failed.kind, 'agent.done');
	assert.equal(failed.outcome, 'error');
});

test('subagent lifecycle and child agent_id target children without replacing the lead', () => {
	const started = codexDriver.normalize(
		{
			hook_event_name: 'SubagentStart',
			session_id: 'root-session',
			agent_id: 'child-a',
			agent_type: 'reviewer',
		},
		context,
	);
	assert.deepEqual(
		{
			kind: started.kind,
			subagentId: started.subagentId,
			displayName: started.displayName,
		},
		{
			kind: 'subagent.started',
			subagentId: 'child-a',
			displayName: 'reviewer',
		},
	);

	const childWait = codexDriver.normalize(
		{
			hook_event_name: 'PermissionRequest',
			session_id: 'root-session',
			agent_id: 'child-a',
			tool_name: 'exec_command',
		},
		context,
	);
	assert.equal(childWait.kind, 'wait.started');
	assert.equal(childWait.agentId, 'child-a');

	const childDone = codexDriver.normalize(
		{
			hook_event_name: 'Stop',
			session_id: 'root-session',
			agent_id: 'child-a',
		},
		context,
	);
	assert.equal(childDone.kind, 'agent.done');
	assert.equal(childDone.agentId, 'child-a');

	const stopped = codexDriver.normalize(
		{
			hook_event_name: 'SubagentStop',
			session_id: 'root-session',
			agent_id: 'child-a',
		},
		context,
	);
	assert.equal(stopped.kind, 'subagent.stopped');
	assert.equal(stopped.subagentId, 'child-a');
});

test('provider identifiers and renderer-facing text are bounded at normalization', () => {
	const normalized = codexDriver.normalize(
		{
			hook_event_name: 'UserPromptSubmit',
			session_id: 's'.repeat(2_000),
			prompt: 'p'.repeat(20_000),
		},
		context,
	);
	assert.equal(normalized.sessionId.length, 512);
	assert.equal(normalized.promptText.length, 4_000);
});

test('registry rejects unknown providers and exposes both built-in drivers', async () => {
	assert.deepEqual(
		agentDriverRegistry.drivers.map(({ provider }) => provider),
		['codex', 'claude-code'],
	);
	assert.equal(agentDriverRegistry.normalize('unknown', {}, context), null);
	await assert.rejects(
		agentDriverRegistry.hookStatus('unknown'),
		/Unknown agent provider/,
	);
});

test('Codex install is idempotent, preserves user hook indexes, and writes trusted hashes', async () => {
	const homeDir = await makeHome('codex');
	const configPath = join(homeDir, '.codex', 'hooks.json');
	await mkdir(join(homeDir, '.codex'), { recursive: true });
	const userDefinition = {
		matcher: 'shell',
		hooks: [
			{ type: 'command', command: '/usr/local/bin/my user hook', timeout: 90 },
		],
	};
	const unrelatedDefinition = {
		hooks: [{ type: 'command', command: 'echo unrelated' }],
	};
	const original = {
		version: 1,
		customSetting: { preserve: true },
		hooks: {
			UserPromptSubmit: [userDefinition],
			Notification: [unrelatedDefinition],
		},
	};
	await writeFile(configPath, `${JSON.stringify(original, null, 2)}\n`);
	const existingTrust = [
		'# Preserve this user-owned trust state byte-for-byte.',
		'[hooks.state."/tmp/user/hooks.json:stop:0:0"]',
		'enabled = false',
		'trusted_hash = "sha256:user-owned"',
		'',
	].join('\n');
	await writeFile(join(homeDir, '.codex', 'config.toml'), existingTrust);

	const first = await codexDriver.hooks.install({ homeDir });
	assert.equal(first.state, 'installed');
	assert.deepEqual(first.missingEvents, []);

	const installed = JSON.parse(await readFile(configPath, 'utf8'));
	assert.deepEqual(installed.customSetting, original.customSetting);
	assert.deepEqual(installed.hooks.Notification, [unrelatedDefinition]);
	assert.deepEqual(installed.hooks.UserPromptSubmit.slice(0, 1), [userDefinition]);
	assert.equal(
		isTerminayManagedCommand(
			installed.hooks.UserPromptSubmit[1].hooks[0].command,
		),
		true,
	);
	assert.equal(installed.hooks.UserPromptSubmit[1].hooks[0].timeout, 2);
	assert.equal(
		installed.hooks.UserPromptSubmit.filter((definition) =>
			definition.hooks?.some((hook) => isTerminayManagedCommand(hook.command)),
		).length,
		1,
	);
	assert.equal(first.installedEvents.length, CODEX_MANAGED_EVENTS.length);
	const trustToml = await readFile(
		join(homeDir, '.codex', 'config.toml'),
		'utf8',
	);
	assert.match(trustToml, /# Preserve this user-owned trust state byte-for-byte/);
	assert.match(trustToml, /trusted_hash = "sha256:user-owned"/);
	assert.match(
		trustToml,
		/hooks\.json:user_prompt_submit:1:0/,
	);
	assert.match(trustToml, /trusted_hash = "sha256:[a-f0-9]{64}"/);
	assert.equal((await stat(configPath)).mode & 0o777, 0o600);
	assert.equal(
		(await stat(join(homeDir, '.codex', 'config.toml'))).mode & 0o777,
		0o600,
	);

	const afterFirst = await readFile(configPath, 'utf8');
	const trustAfterFirst = await readFile(
		join(homeDir, '.codex', 'config.toml'),
		'utf8',
	);
	const second = await codexDriver.hooks.install({ homeDir });
	assert.equal(second.state, 'installed');
	assert.equal(await readFile(configPath, 'utf8'), afterFirst);
	assert.equal(
		await readFile(join(homeDir, '.codex', 'config.toml'), 'utf8'),
		trustAfterFirst,
	);

	await writeFile(join(homeDir, '.codex', 'config.toml'), '');
	const untrusted = await codexDriver.hooks.status({ homeDir });
	assert.equal(untrusted.state, 'partial');
	assert.match(untrusted.error, /trust is missing/);
	const repaired = await codexDriver.hooks.install({ homeDir });
	assert.equal(repaired.state, 'installed');
});

test('uninstall removes only Terminay-owned entries and keeps mixed user hook groups', async () => {
	const homeDir = await makeHome('uninstall');
	const paths = codexDriver.hooks.paths({ homeDir });
	await codexDriver.hooks.install({ homeDir });
	const config = JSON.parse(await readFile(paths.configPath, 'utf8'));
	config.unrelated = 'keep';
	config.hooks.UserPromptSubmit[0].hooks.push({
		type: 'command',
		command: 'echo user-in-managed-group',
	});
	config.hooks.Notification = [
		{ hooks: [{ type: 'command', command: 'echo notification' }] },
	];
	await writeFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);

	const removed = await codexDriver.hooks.uninstall({ homeDir });
	assert.equal(removed.state, 'not-installed');
	const next = JSON.parse(await readFile(paths.configPath, 'utf8'));
	assert.equal(next.unrelated, 'keep');
	assert.deepEqual(next.hooks.UserPromptSubmit, [
		{
			hooks: [{ type: 'command', command: 'echo user-in-managed-group' }],
		},
	]);
	assert.deepEqual(next.hooks.Notification, config.hooks.Notification);
	const trustToml = await readFile(
		join(homeDir, '.codex', 'config.toml'),
		'utf8',
	);
	assert.doesNotMatch(trustToml, /TERMINAY|hooks\.json:/);
	await assert.rejects(stat(paths.scriptPath), { code: 'ENOENT' });
});

test('Claude install preserves settings and uses a safe command for paths with spaces and quotes', async () => {
	const homeDir = await makeHome('claude');
	const scriptDir = join(homeDir, 'Application Support', "Mark's Terminay");
	const configPath = join(homeDir, '.claude', 'settings.json');
	await mkdir(join(homeDir, '.claude'), { recursive: true });
	await writeFile(
		configPath,
		`${JSON.stringify({
			permissions: { allow: ['Read(*)'] },
			hooks: {
				Stop: [
					{
						hooks: [{ type: 'command', command: 'echo user stop hook' }],
					},
				],
			},
		})}\n`,
	);

	const status = await claudeCodeDriver.hooks.install({
		homeDir,
		scriptDir,
	});
	assert.equal(status.state, 'installed');
	assert.equal(
		status.installedEvents.length,
		CLAUDE_CODE_MANAGED_EVENTS.length,
	);
	const config = JSON.parse(await readFile(configPath, 'utf8'));
	assert.deepEqual(config.permissions, { allow: ['Read(*)'] });
	const command = config.hooks.Stop[0].hooks[0].command;
	assert.match(command, /^TERMINAY_MANAGED_AGENT_HOOK=1 /);
	assert.match(command, /Mark'\\''s Terminay/);
	assert.equal(config.hooks.Stop[1].hooks[0].command, 'echo user stop hook');

	const script = await readFile(status.scriptPath, 'utf8');
	assert.match(script, /TERMINAY_SESSION_ID/);
	assert.match(script, /TERMINAY_AGENT_HOOK_ENDPOINT/);
	assert.match(script, /TERMINAY_AGENT_HOOK_TOKEN/);
	assert.match(script, /--connect-timeout 0\.5 --max-time 1\.5/);
	assert.match(script, /http:\/\/127\.0\.0\.1/);
});

test('managed hook command posts raw payload and inherited identity with bounded curl timeouts', async () => {
	const homeDir = await makeHome('command');
	const scriptDir = join(homeDir, 'path with spaces', "O'Connor");
	const status = await claudeCodeDriver.hooks.install({
		homeDir,
		scriptDir,
	});
	const config = JSON.parse(await readFile(status.configPath, 'utf8'));
	const command = config.hooks.Stop[0].hooks[0].command;

	const binDir = join(homeDir, 'bin');
	const argsPath = join(homeDir, 'curl-args');
	const bodyPath = join(homeDir, 'curl-body');
	await mkdir(binDir, { recursive: true });
	const fakeCurl = join(binDir, 'curl');
	await writeFile(
		fakeCurl,
		[
			'#!/bin/sh',
			'cat >"$CAPTURE_BODY"',
			'printf \'%s\\n\' "$@" >"$CAPTURE_ARGS"',
			'',
		].join('\n'),
	);
	await chmod(fakeCurl, 0o700);

	const payload = JSON.stringify({
		hook_event_name: 'Stop',
		message: 'path "quotes" stay JSON',
	});
	const result = await runShell(command, payload, {
		...process.env,
		PATH: `${binDir}:${process.env.PATH}`,
		CAPTURE_ARGS: argsPath,
		CAPTURE_BODY: bodyPath,
		TERMINAY_SESSION_ID: 'pty-session-id',
		TERMINAY_AGENT_HOOK_ENDPOINT: 'http://127.0.0.1:45678/agent-hook',
		TERMINAY_AGENT_HOOK_TOKEN: 'secret-token',
	});
	assert.equal(result.code, 0);
	assert.equal(await readFile(bodyPath, 'utf8'), payload);
	const args = await readFile(argsPath, 'utf8');
	assert.match(args, /--connect-timeout\n0\.5/);
	assert.match(args, /--max-time\n1\.5/);
	assert.match(args, /X-Terminay-Session-Id: pty-session-id/);
	assert.match(args, /X-Terminay-Agent-Provider: claude-code/);
	assert.match(args, /X-Terminay-Agent-Hook-Token: secret-token/);
});

test('malformed or shape-invalid config is never overwritten', async () => {
	for (const [name, raw] of [
		['json', '{ definitely-not-json'],
		['shape', JSON.stringify({ hooks: { Stop: { command: 'user hook' } } })],
	]) {
		const homeDir = await makeHome(`invalid-${name}`);
		const configPath = join(homeDir, '.claude', 'settings.json');
		await mkdir(join(homeDir, '.claude'), { recursive: true });
		await writeFile(configPath, raw);

		const status = await claudeCodeDriver.hooks.install({ homeDir });
		assert.equal(status.state, 'error');
		assert.equal(await readFile(configPath, 'utf8'), raw);
	}
});

test('registry reconciliation installs and reports both providers', async () => {
	const homeDir = await makeHome('registry');
	const installed = await agentDriverRegistry.reconcileHooks({
		action: 'install',
		options: { homeDir },
	});
	assert.equal(installed.ok, true);
	assert.deepEqual(
		installed.statuses.map(({ provider, state }) => [provider, state]),
		[
			['codex', 'installed'],
			['claude-code', 'installed'],
		],
	);

	const status = await agentDriverRegistry.reconcileHooks({
		action: 'status',
		options: { homeDir },
	});
	assert.equal(status.ok, true);
	assert.equal(
		status.statuses.every((entry) => entry.state === 'installed'),
		true,
	);
});

async function makeHome(label) {
	return mkdtemp(join(tmpdir(), `terminay-agent-driver-${label}-`));
}

function runShell(command, input, env) {
	return new Promise((resolve, reject) => {
		const child = spawn('/bin/sh', ['-c', command], { env });
		let stderr = '';
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, stderr }));
		child.stdin.end(input);
	});
}

async function importDrivers() {
	const tempDir = await mkdtemp(join(tmpdir(), 'terminay-agent-drivers-test-'));
	const outputPath = join(tempDir, 'drivers.mjs');
	await build({
		bundle: true,
		entryPoints: [
			new URL('../electron/agentDrivers/index.ts', import.meta.url).pathname,
		],
		format: 'esm',
		outfile: outputPath,
		platform: 'node',
		target: 'es2022',
	});
	return import(outputPath);
}
