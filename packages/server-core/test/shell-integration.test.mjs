import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ShellIntegration, shellIntegrationPlan } from '../dist/index.js';

const run = promisify(execFile);
const HOSTILE = '--x=$(touch PWNED) `touch PWNED` \'q\' "d";z & | > <';
const DEFAULTS = [{ command: 'codex', args: ['--no-daemon', HOSTILE] }];

function which(name) {
	for (const dir of [
		'/bin',
		'/usr/bin',
		'/usr/local/bin',
		'/opt/homebrew/bin',
	]) {
		const path = join(dir, name);
		if (existsSync(path)) return path;
	}
	return undefined;
}

async function sandbox(t) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-shell-integration-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const home = join(root, 'home');
	const bin = join(root, 'bin');
	await mkdir(home, { recursive: true });
	await mkdir(bin, { recursive: true });
	await writeFile(
		join(bin, 'codex'),
		'#!/bin/sh\nprintf "ARGS:"; for a in "$@"; do printf "[%s]" "$a"; done; echo\n',
	);
	await chmod(join(bin, 'codex'), 0o755);
	return {
		root,
		home,
		bin,
		directory: join(root, 'data', 'shell-integration'),
	};
}

function integration(directory, defaults = DEFAULTS, enabled = true) {
	return new ShellIntegration({
		directory,
		enabled: () => enabled,
		commandDefaults: () => defaults,
		platform: 'linux',
	});
}

/** Run a shell as Terminay would, with integration's arguments and environment, and a command. */
async function shell(box, shellPath, args, commandArgs, extraEnv = {}) {
	const injected = await integration(box.directory).inject({
		shellPath,
		args,
		env: extraEnv,
	});
	assert.ok(injected, `${shellPath} is integrated`);
	const env = {
		HOME: box.home,
		PATH: `${box.bin}:/usr/bin:/bin`,
		...extraEnv,
		...injected.env,
	};
	const { stdout } = await run(shellPath, [...injected.args, ...commandArgs], {
		env,
		cwd: box.root,
		timeout: 20_000,
	});
	assert.equal(
		existsSync(join(box.root, 'PWNED')),
		false,
		'nothing in a default is evaluated',
	);
	return stdout;
}

const EXPECTED = `ARGS:[--no-daemon][${HOSTILE}][resume][--last]`;

test('only supported shells with recognised arguments are integrated', () => {
	const cases = [
		['/bin/zsh', [], { shell: 'zsh', login: false }],
		['/bin/zsh', ['-l'], { shell: 'zsh', login: true }],
		['/bin/zsh', ['-il'], { shell: 'zsh', login: true }],
		['/bin/bash', ['--login'], { shell: 'bash', login: true }],
		['/bin/bash', ['-i'], { shell: 'bash', login: false }],
		['/usr/bin/fish', ['-l', '-i'], { shell: 'fish', login: true }],
		['/usr/bin/pwsh', ['-NoLogo'], { shell: 'powershell', login: false }],
		[
			'/usr/bin/pwsh',
			['-Login', '-NoLogo'],
			{ shell: 'powershell', login: true },
		],
		[
			'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
			[],
			{ shell: 'powershell', login: false },
			'win32',
		],
		['/bin/dash', [], undefined],
		['/usr/bin/nu', [], undefined],
		['/bin/tcsh', [], undefined],
		['/bin/bash', ['--norc'], undefined],
		['/bin/zsh', ['-f'], undefined],
		['/bin/bash', ['-l', '-c', 'x'], undefined],
		['/usr/bin/pwsh', ['-NoProfile'], undefined],
		['C:\\Program Files\\Git\\bin\\bash.exe', [], undefined, 'win32'],
	];
	for (const [path, args, expected, platform] of cases) {
		const plan = shellIntegrationPlan(path, args, platform ?? 'linux');
		assert.deepEqual(
			plan === undefined ? undefined : { shell: plan.shell, login: plan.login },
			expected,
			`${path} ${args.join(' ')}`,
		);
	}
});

test('arguments and environment per shell', async (t) => {
	const box = await sandbox(t);
	const value = integration(box.directory);
	const zsh = await value.inject({
		shellPath: '/bin/zsh',
		args: ['-l'],
		env: { ZDOTDIR: '/u/zsh' },
	});
	assert.deepEqual(zsh.args, ['-l']);
	assert.equal(zsh.env.ZDOTDIR, join(box.directory, 'zsh'));
	assert.equal(zsh.env.TERMINAY_USER_ZDOTDIR, '/u/zsh');
	assert.equal(zsh.env.TERMINAY_SHELL_INTEGRATION, '1');
	assert.equal(
		zsh.env.TERMINAY_COMMAND_DEFAULTS,
		`codex\u001f--no-daemon\u001f${HOSTILE}`,
	);
	const bash = await value.inject({
		shellPath: '/bin/bash',
		args: ['-l'],
		env: {},
	});
	assert.deepEqual(bash.args, [
		'--init-file',
		join(box.directory, 'terminay.bash'),
	]);
	assert.equal(bash.env.TERMINAY_SHELL_LOGIN, '1');
	const fish = await value.inject({
		shellPath: '/usr/bin/fish',
		args: [],
		env: {},
	});
	assert.deepEqual(fish.args, [
		'--init-command',
		`source '${join(box.directory, 'terminay.fish')}'`,
	]);
	const pwsh = await value.inject({
		shellPath: '/usr/bin/pwsh',
		args: ['-Login', '-NoLogo'],
		env: {},
	});
	assert.deepEqual(pwsh.args, [
		'-Login',
		'-NoLogo',
		'-NoExit',
		'-Command',
		`try { . '${join(box.directory, 'terminay.ps1')}' } catch {}`,
	]);
	const none = await integration(box.directory, []).inject({
		shellPath: '/bin/bash',
		args: [],
		env: {},
	});
	assert.equal('TERMINAY_COMMAND_DEFAULTS' in none.env, false);
	assert.equal(
		await integration(box.directory, DEFAULTS, false).inject({
			shellPath: '/bin/bash',
			args: [],
			env: {},
		}),
		undefined,
	);
	assert.equal(
		await value.inject({ shellPath: '/bin/dash', args: [], env: {} }),
		undefined,
	);
});

test('runtime files are private to the server account, and a loosened directory is not used', async (t) => {
	const box = await sandbox(t);
	const value = integration(box.directory);
	assert.ok(await value.inject({ shellPath: '/bin/bash', args: [], env: {} }));
	for (const path of [box.directory, join(box.directory, 'zsh')])
		assert.equal((await lstat(path)).mode & 0o777, 0o700, path);
	for (const name of [
		'terminay.bash',
		'terminay.fish',
		'terminay.ps1',
		'zsh/.zshrc',
		'zsh/.zshenv',
	])
		assert.equal(
			(await stat(join(box.directory, name))).mode & 0o777,
			0o600,
			name,
		);
	await chmod(box.directory, 0o777);
	assert.equal(
		await value.inject({ shellPath: '/bin/bash', args: [], env: {} }),
		undefined,
	);
	assert.equal(
		await integration(box.directory).inject({
			shellPath: '/bin/bash',
			args: [],
			env: {},
		}),
		undefined,
	);
	await chmod(box.directory, 0o700);
	await chmod(join(box.directory, 'zsh'), 0o757);
	assert.equal(
		await integration(box.directory).inject({
			shellPath: '/bin/zsh',
			args: [],
			env: {},
		}),
		undefined,
	);
});

test('a relative or control-character directory is never used', async () => {
	for (const directory of ['relative/dir', '/tmp/a\nb'])
		assert.equal(
			await integration(directory).inject({
				shellPath: '/bin/bash',
				args: [],
				env: {},
			}),
			undefined,
		);
});

const zsh = which('zsh');
test('zsh: user files run first, in order, ZDOTDIR is handed back, and codex gets its default', {
	skip: zsh === undefined,
}, async (t) => {
	const box = await sandbox(t);
	for (const name of ['.zshenv', '.zprofile', '.zshrc', '.zlogin'])
		await writeFile(join(box.home, name), `echo ${name} >> "$HOME/order"\n`);
	// A system profile may reset PATH in a login shell; the user's puts it back.
	await writeFile(
		join(box.home, '.zprofile'),
		`echo .zprofile >> "$HOME/order"\nexport PATH="${box.bin}:$PATH"\n`,
	);
	await writeFile(
		join(box.home, '.zshrc'),
		'echo .zshrc >> "$HOME/order"\ntypeset -A user_map; user_map[a]=kept\n',
	);
	const out = await shell(
		box,
		zsh,
		['-l'],
		[
			'-i',
			'-c',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: zsh parameter expansion
			'codex resume --last; print -r -- "Z=${ZDOTDIR-unset} M=$user_map[a] T=${(k)parameters[(I)TERMINAY_*]}"',
		],
	);
	assert.match(
		out,
		new RegExp(EXPECTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
	);
	assert.match(out, /Z=unset M=kept T=$/m);
	assert.equal(
		await readFile(join(box.home, 'order'), 'utf8'),
		'.zshenv\n.zprofile\n.zshrc\n.zlogin\n',
	);
});

test("zsh: a user's ZDOTDIR is honoured and returned, and the user's own codex wins", {
	skip: zsh === undefined,
}, async (t) => {
	const box = await sandbox(t);
	const user = join(box.home, '.config', 'zsh');
	await mkdir(user, { recursive: true });
	await writeFile(join(user, '.zshrc'), 'alias codex="echo user-alias"\n');
	const out = await shell(
		box,
		zsh,
		[],
		[
			'-i',
			'-c',
			'codex; print -r -- "Z=$ZDOTDIR"; zsh -i -c "whence -w codex"',
		],
		{ ZDOTDIR: user },
	);
	assert.match(out, /^user-alias$/m);
	assert.match(
		out,
		new RegExp(`^Z=${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
	);
	assert.match(out, /^codex: alias$/m);
});

const bash = which('bash');
test('bash: login start imitated, the default applies, a nested shell is plain', {
	skip: bash === undefined,
}, async (t) => {
	const box = await sandbox(t);
	await writeFile(
		join(box.home, '.bash_profile'),
		`echo profile >> "$HOME/order"\nexport PATH="${box.bin}:$PATH"\n`,
	);
	await writeFile(join(box.home, '.bashrc'), 'echo rc >> "$HOME/order"\n');
	const out = await shell(
		box,
		bash,
		['-l'],
		[
			'-i',
			'-c',
			'codex resume --last; env | grep -c "^TERMINAY_" ; bash -i -c "type -t codex"',
		],
	);
	assert.ok(out.includes(EXPECTED), out);
	assert.match(out, /^0$/m);
	assert.match(out, /^file$/m);
	assert.equal(
		await readFile(join(box.home, 'order'), 'utf8'),
		'profile\nrc\n',
	);
});

test("bash: the user's own function wins", {
	skip: bash === undefined,
}, async (t) => {
	const box = await sandbox(t);
	await writeFile(
		join(box.home, '.bashrc'),
		'codex() { echo user-function; }\n',
	);
	const out = await shell(box, bash, [], ['-i', '-c', 'codex']);
	assert.match(out, /^user-function$/m);
});

const fish = which('fish');
test("fish: the default applies after the user's config", {
	skip: fish === undefined,
}, async (t) => {
	const box = await sandbox(t);
	const out = await shell(
		box,
		fish,
		[],
		[
			'-c',
			'codex resume --last; set -q TERMINAY_COMMAND_DEFAULTS; or echo cleared',
		],
	);
	assert.ok(out.includes(EXPECTED), out);
	assert.match(out, /^cleared$/m);
});

const pwsh = which('pwsh');
test("PowerShell: the default applies after the user's profile", {
	skip: pwsh === undefined,
}, async (t) => {
	const box = await sandbox(t);
	const injected = await integration(box.directory).inject({
		shellPath: pwsh,
		args: ['-NoLogo'],
		env: {},
	});
	const args = injected.args.map((arg) =>
		arg === '-NoExit' ? '-NonInteractive' : arg,
	);
	args[args.length - 1] += '; codex resume --last';
	const { stdout } = await run(pwsh, args, {
		env: { HOME: box.home, PATH: `${box.bin}:/usr/bin:/bin`, ...injected.env },
		timeout: 30_000,
	});
	assert.ok(stdout.includes(EXPECTED), stdout);
	assert.equal(existsSync(join(box.root, 'PWNED')), false);
});
