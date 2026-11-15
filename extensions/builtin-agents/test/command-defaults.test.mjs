import assert from 'node:assert/strict';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	utimes,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateExtensionManifest } from '@terminay/extension-api';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import {
	CLAUDE_COMMAND_DEFAULT_ID,
	CODEX_COMMAND_DEFAULT_ID,
	createBuiltInAgentsExtension,
	readAgentViewRefusal,
	readHelp,
} from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;

const SUPPORTED_HELP = `Codex CLI

Usage: codex [OPTIONS] [PROMPT]

Options:
  -m, --model <MODEL>
      --no-daemon
          Run the session in this process instead of the shared app server
  -h, --help
`;

async function root(t) {
	const directory = await mkdtemp(join(tmpdir(), 'builtin-agents-defaults-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

/** A fake codex whose --help prints `help` and exits with `code`. */
async function codex(home, body) {
	const path = join(home, '.local', 'bin', 'codex');
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}

function printing(help, code = 0) {
	return `cat <<'HELP'\n${help}HELP\nexit ${code}`;
}

async function harnessWith(t, home, codexCommandDefault) {
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension({
			locator: {
				env: { PATH: '/nonexistent' },
				homeDirectory: home,
				loginShellPath: async () => undefined,
			},
			...(codexCommandDefault === undefined ? {} : { codexCommandDefault }),
		}),
		{ manifest },
	);
	t.after(() => harness.dispose());
	return harness;
}

test('the manifest declares the claude and codex command defaults under their harnesses', () => {
	assert.equal(validateExtensionManifest(manifest).ok, true);
	assert.ok(manifest.permissions.includes('terminal-command-defaults'));
	assert.deepEqual(manifest.contributes.terminalCommandDefaults, [
		{
			id: CLAUDE_COMMAND_DEFAULT_ID,
			command: 'claude',
			harness: {
				source: 'com.terminay.builtin-agents/agents',
				harness: 'claude-code',
			},
		},
		{
			id: CODEX_COMMAND_DEFAULT_ID,
			command: 'codex',
			harness: {
				source: 'com.terminay.builtin-agents/agents',
				harness: 'codex',
			},
		},
	]);
});

test('a Codex whose help lists --no-daemon gets --no-daemon', async (t) => {
	const home = await root(t);
	await codex(home, printing(SUPPORTED_HELP));
	const harness = await harnessWith(t, home);
	assert.deepEqual(harness.registeredCommandDefaultIds(), [
		CODEX_COMMAND_DEFAULT_ID,
		CLAUDE_COMMAND_DEFAULT_ID,
	]);
	assert.deepEqual(
		await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID),
		{
			applies: true,
			args: ['--no-daemon'],
		},
	);
});

test('a Codex without the option is left unchanged', async (t) => {
	const home = await root(t);
	await codex(
		home,
		printing(
			'Usage: codex [OPTIONS]\n  --daemon-ish\n  # --no-daemon is not an option here\n',
		),
	);
	const harness = await harnessWith(t, home);
	const result = await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID);
	assert.equal(result.applies, false);
	assert.equal(result.reason, 'unsupported');
});

test('no Codex installed means the default does not apply', async (t) => {
	const home = await root(t);
	const harness = await harnessWith(t, home);
	const result = await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID);
	assert.equal(result.applies, false);
	assert.equal(result.reason, 'not_installed');
});

test('a failing help does not apply and is asked again next time', async (t) => {
	const home = await root(t);
	await codex(home, printing(SUPPORTED_HELP, 2));
	let probes = 0;
	const harness = await harnessWith(t, home, {
		probe: async (executable, signal) => {
			probes += 1;
			return readHelp(executable, signal);
		},
	});
	assert.equal(
		(await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID)).reason,
		'unavailable',
	);
	assert.equal(
		(await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID)).reason,
		'unavailable',
	);
	assert.equal(probes, 2);
});

test('help is read once per build and again when Codex is replaced', async (t) => {
	const home = await root(t);
	const path = await codex(home, printing('Usage: codex\n'));
	let probes = 0;
	const harness = await harnessWith(t, home, {
		probe: async (executable, signal) => {
			probes += 1;
			return readHelp(executable, signal);
		},
	});
	assert.equal(
		(await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID)).applies,
		false,
	);
	assert.equal(
		(await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID)).applies,
		false,
	);
	assert.equal(probes, 1);
	await codex(home, printing(SUPPORTED_HELP));
	await utimes(path, new Date(), new Date(Date.now() + 5_000));
	assert.deepEqual(
		await harness.resolveCommandDefault(CODEX_COMMAND_DEFAULT_ID),
		{
			applies: true,
			args: ['--no-daemon'],
		},
	);
	assert.equal(probes, 2);
});

test('help that runs too long or prints too much does not count', async (t) => {
	const home = await root(t);
	const slow = await codex(home, 'sleep 30');
	const started = Date.now();
	assert.equal(await readHelp(slow, new AbortController().signal), undefined);
	assert.ok(Date.now() - started < 10_000);
	const noisy = await codex(home, 'yes --no-daemon');
	assert.equal(await readHelp(noisy, new AbortController().signal), undefined);
	const aborted = new AbortController();
	const pending = readHelp(slow, aborted.signal);
	aborted.abort();
	assert.equal(await pending, undefined);
});

test('the probe passes only --help', async (t) => {
	const home = await root(t);
	const path = await codex(home, 'printf "%s\\n" "$#" "$@"');
	assert.equal(
		await readHelp(path, new AbortController().signal),
		'1\n--help\n',
	);
});

/** A fake claude at the locator's home path. */
async function claude(home, body) {
	const path = join(home, '.local', 'bin', 'claude');
	await mkdir(join(path, '..'), { recursive: true });
	await writeFile(path, `#!/bin/sh\n${body}\n`);
	await chmod(path, 0o755);
	return path;
}

const REFUSES_AGENT_VIEW = `if [ "$CLAUDE_CODE_DISABLE_AGENT_VIEW" = 1 ]; then echo "'claude $*' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW." >&2; exit 1; fi; echo '[]'`;

test('a Claude Code that refuses agent view under the variable gets the variable (ADR-0124)', async (t) => {
	const home = await root(t);
	await claude(home, REFUSES_AGENT_VIEW);
	const harness = await harnessWith(t, home);
	assert.ok(
		harness.registeredCommandDefaultIds().includes(CLAUDE_COMMAND_DEFAULT_ID),
	);
	assert.deepEqual(
		await harness.resolveCommandDefault(CLAUDE_COMMAND_DEFAULT_ID),
		{
			applies: true,
			environment: { CLAUDE_CODE_DISABLE_AGENT_VIEW: '1' },
		},
	);
});

test('a Claude Code that ignores the variable is left unchanged', async (t) => {
	const home = await root(t);
	await claude(home, `echo '[]'`);
	const harness = await harnessWith(t, home);
	const result = await harness.resolveCommandDefault(CLAUDE_COMMAND_DEFAULT_ID);
	assert.equal(result.applies, false);
	assert.equal(result.reason, 'unsupported');
});

test('no Claude Code installed means the claude default does not apply', async (t) => {
	const home = await root(t);
	const harness = await harnessWith(t, home);
	const result = await harness.resolveCommandDefault(CLAUDE_COMMAND_DEFAULT_ID);
	assert.equal(result.applies, false);
	assert.equal(result.reason, 'not_installed');
});

test('the agent-view probe passes only agents --json, with the variable set', async (t) => {
	const home = await root(t);
	const path = await claude(
		home,
		'printf "%s\\n" "$#" "$@" "$CLAUDE_CODE_DISABLE_AGENT_VIEW" >&2; exit 3',
	);
	assert.equal(
		await readAgentViewRefusal(path, new AbortController().signal),
		'2\nagents\n--json\n1\n',
	);
});
