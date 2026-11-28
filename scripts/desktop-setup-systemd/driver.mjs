// Runs as root inside the systemd container. See ../desktop-setup-systemd.mjs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const { installLayout, writeInstallRecord } = await import('/cli/dist/layout.js');
const { installDesktopSetupHelper, removeDesktopSetupHelper, desktopSetupHelperInstalled } = await import(
	'/cli/dist/desktopHelper.js'
);
const { createSystemd } = await import('/cli/dist/systemd.js');
const { missingDesktopInstall, defaultDesktopInstallHost } = await import('/cli/dist/desktop.js');
const { renderDesktopSetupPathUnit, renderDesktopSetupServiceUnit } = await import('/cli/dist/unit.js');

const RUN_AS = 'terminay';
const SERVICE = 'terminay-desktop-setup.service';
const PATH_UNIT = 'terminay-desktop-setup.path';
const STATUS = '/run/terminay-desktop-setup/status.json';
const write = (line) => process.stdout.write(`${line}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sh(command, args, { allowFailure = false } = {}) {
	try {
		return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (error) {
		if (allowFailure) return `${error.stdout ?? ''}`.trim();
		throw new Error(`${command} ${args.join(' ')} failed: ${error.stderr ?? error.message}`);
	}
}
const systemctl = (...args) => sh('systemctl', args, { allowFailure: true });
/** As the run-as account. Returns whether it succeeded. */
function asAccount(script) {
	try {
		execFileSync('su', ['-s', '/bin/sh', RUN_AS, '-c', script], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}
const status = () => {
	try {
		return JSON.parse(readFileSync(STATUS, 'utf8'));
	} catch {
		return undefined;
	}
};
async function until(what, check, timeoutMs = 60_000, intervalMs = 250) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() > deadline) {
			write(sh('journalctl', ['-u', SERVICE, '--no-pager', '-o', 'cat', '-n', '60'], { allowFailure: true }));
			throw new Error(`timed out waiting for ${what}`);
		}
		await sleep(intervalMs);
	}
}
const idle = () =>
	until('the helper to be idle', () => !/^activ/u.test(systemctl('is-active', SERVICE)), 120_000);
const starts = () =>
	sh('journalctl', ['-u', SERVICE, '--no-pager', '-o', 'cat'], { allowFailure: true })
		.split('\n')
		.filter((line) => /^Starting .*desktop setup/iu.test(line)).length;
const enabledUnits = () =>
	sh('systemctl', ['list-unit-files', '--state=enabled', '--no-legend', '--no-pager'])
		.split('\n')
		.map((line) => line.split(/\s+/u)[0])
		.filter(Boolean)
		.sort();
const runningUnits = () =>
	sh('systemctl', ['list-units', '--state=running', '--type=service,socket', '--no-legend', '--no-pager', '--plain'])
		.split('\n')
		.map((line) => line.trim().split(/\s+/u)[0])
		.filter(Boolean)
		.sort();

// An install's shape: the account, and `current/bin/terminay` as the CLI.
sh('useradd', ['--system', '--create-home', '--shell', '/bin/bash', RUN_AS]);
mkdirSync('/opt/terminay/current/bin', { recursive: true });
writeFileSync('/opt/terminay/current/bin/terminay', '#!/bin/sh\nexec /usr/bin/node /cli/dist/cli.js "$@"\n');
chmodSync('/opt/terminay/current/bin/terminay', 0o755);
const layout = installLayout('system', '/root', '/');
const systemd = createSystemd({ scope: 'system', env: process.env });
const trigger = layout.upgradeHelper.desktopRequestFile;

write('--- the command refuses anything after `install`, and anyone but root');
for (const args of [['--package', 'cowsay'], ['cowsay']]) {
	let code = 0;
	try {
		execFileSync('/opt/terminay/current/bin/terminay', ['daemon', 'desktop', 'install', ...args], {
			stdio: 'ignore',
		});
	} catch (error) {
		code = error.status;
	}
	assert.equal(code, 2);
}
assert.equal(asAccount('/opt/terminay/current/bin/terminay daemon desktop install'), false);
assert.equal(existsSync(STATUS), false);

write('--- the new release reconciles the legacy helper on upgrade and starts nothing');
const helper = layout.upgradeHelper;
const legacyTrigger = `${helper.requestDirectory}/desktop-setup`;
mkdirSync(helper.requestDirectory, { recursive: true, mode: 0o700 });
writeFileSync(legacyTrigger, '', { mode: 0o600 });
sh('chown', [`${RUN_AS}:${RUN_AS}`, helper.requestDirectory, legacyTrigger]);
writeFileSync(
	helper.desktopPathUnitPath,
	renderDesktopSetupPathUnit(layout).replace(trigger, legacyTrigger),
);
writeFileSync(helper.desktopServiceUnitPath, renderDesktopSetupServiceUnit(layout));
sh('systemctl', ['enable', '--now', PATH_UNIT]);
await writeInstallRecord(layout, {
	schemaVersion: 1,
	scope: 'system',
	channel: 'tag',
	version: '1.0.0',
	revision: 'test',
	runAs: RUN_AS,
	dataRoot: layout.defaultDataRoot,
	projectRoot: '/home/terminay',
	port: 8080,
	healthPort: 8081,
	expose: 'hosted',
	installedAt: '2026-01-01T00:00:00Z',
});
sh('/opt/terminay/current/bin/terminay', ['daemon', 'host-setup']);
assert.equal(await desktopSetupHelperInstalled(layout), true);
assert.equal(systemctl('is-enabled', PATH_UNIT), 'enabled');
assert.equal(systemctl('is-active', PATH_UNIT), 'active');
await sleep(2000);
assert.equal(starts(), 0);
assert.equal(existsSync(STATUS), false);
assert.equal(asAccount(`echo legacy > ${legacyTrigger}`), true);
await sleep(1000);
assert.equal(starts(), 0);

write('--- reinstalling the helper repairs a disabled or stopped watch without starting setup');
const triggerStamp = () => {
	const info = lstatSync(trigger);
	assert.equal(info.isFile(), true);
	return [info.ino, info.mtimeMs, info.ctimeMs];
};
const installedTrigger = triggerStamp();
sh('systemctl', ['disable', PATH_UNIT]);
assert.equal(systemctl('is-enabled', PATH_UNIT), 'disabled');
assert.equal(systemctl('is-active', PATH_UNIT), 'active');
assert.equal(await installDesktopSetupHelper({ layout, runAs: RUN_AS, systemd }), true);
assert.equal(systemctl('is-enabled', PATH_UNIT), 'enabled');
assert.equal(systemctl('is-active', PATH_UNIT), 'active');
sh('systemctl', ['stop', PATH_UNIT]);
assert.equal(systemctl('is-enabled', PATH_UNIT), 'enabled');
assert.equal(systemctl('is-active', PATH_UNIT), 'inactive');
assert.equal(await installDesktopSetupHelper({ layout, runAs: RUN_AS, systemd }), true);
assert.equal(systemctl('is-enabled', PATH_UNIT), 'enabled');
assert.equal(systemctl('is-active', PATH_UNIT), 'active');
assert.deepEqual(triggerStamp(), installedTrigger);

write('--- the account cannot unlink or rename the trigger');
assert.equal(asAccount(`rm ${trigger}`), false);
assert.equal(asAccount(`mv ${trigger} ${trigger}.renamed`), false);
assert.deepEqual(triggerStamp(), installedTrigger);
await sleep(2000);
assert.equal(starts(), 0);
assert.equal(existsSync(STATUS), false);

const enabledBefore = enabledUnits();
const runningBefore = runningUnits();
// What systemd will run, without the times and pid of its last run.
const commandLine = () => /argv\[\]=(.*?) ;/u.exec(systemctl('show', SERVICE, '-p', 'ExecStart', '--value'))?.[1];
const execStart = commandLine();
assert.equal(execStart, '/opt/terminay/current/bin/terminay daemon desktop install');

write('--- content written to the trigger starts the fixed command and changes nothing');
assert.equal(asAccount(`printf '%s' '--package cowsay; touch /root/owned' > ${trigger}`), true);
const first = await until('a run to record itself', () => status());
assert.equal(commandLine(), execStart);
const cmdline = readFileSync(`/proc/${first.pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
assert.deepEqual(cmdline.slice(-3), ['daemon', 'desktop', 'install']);
assert.equal(
	cmdline.some((part) => /cowsay|owned/u.test(part)),
	false,
);

write('--- the account reads progress and cannot write it');
assert.equal(asAccount(`cat ${STATUS} > /dev/null`), true);
assert.equal(asAccount(`echo x > ${STATUS}`), false);
assert.equal(asAccount('touch /run/terminay-desktop-setup/mine'), false);
assert.equal(asAccount(`rm ${STATUS}`), false);

write('--- a run killed mid-install leaves no outcome');
await until('the install to be under way', () => ['downloading', 'installing'].includes(status()?.step), 600_000);
// Well into it, so packages are half-unpacked when it dies.
await until(
	'packages to be unpacking',
	() => status()?.step === 'installing' && status().fraction > 0.6,
	900_000,
);
const killed = status();
assert.equal(killed.outcome, undefined);
write(`    killing at ${killed.step} ${killed.fraction}`);
systemctl('kill', '--signal=KILL', SERVICE);
await idle();
assert.equal(status().run, killed.run);
assert.equal(status().outcome, undefined);
assert.equal(existsSync(`/proc/${killed.pid}`), false);
systemctl('reset-failed', SERVICE);

write('--- the next run has its own identity, finishes the interrupted install, and succeeds');
assert.equal(asAccount(`: > ${trigger}`), true);
const second = await until('a new run', () => (status()?.run !== killed.run ? status() : undefined));
assert.notEqual(second.run, killed.run);
const done = await until('the install to finish', () => (status()?.outcome ? status() : undefined), 1_200_000, 1000);
assert.deepEqual(done.outcome, { ok: true }, JSON.stringify(done));
assert.equal(done.fraction, 1);
assert.deepEqual(await missingDesktopInstall(defaultDesktopInstallHost()), []);
assert.equal(existsSync('/usr/games/cowsay') || existsSync('/root/owned'), false);
await idle();

write('--- the packages enabled and started no unit');
assert.deepEqual(enabledUnits(), enabledBefore);
assert.deepEqual(
	runningUnits().filter((unit) => !runningBefore.includes(unit)),
	[],
);
assert.equal(sh('pgrep', ['-c', 'Xtigervnc'], { allowFailure: true }), '0');

write('--- with everything installed a run exits early, and a burst of triggers is rate-limited');
const before = starts();
const burstStarted = Date.now();
for (let i = 0; i < 40; i++) {
	asAccount(`: > ${trigger}`);
	await sleep(300);
}
const seconds = (Date.now() - burstStarted) / 1000;
await idle();
const burst = starts() - before;
write(`    40 triggers in ${seconds.toFixed(0)}s started the helper ${burst} time(s)`);
assert.ok(burst >= 1, 'the burst started nothing');
// Each run lasts at least ten seconds and a running oneshot is not started again.
assert.ok(burst <= Math.ceil(seconds / 10) + 1, `started ${burst} times in ${seconds}s`);
assert.deepEqual(status().outcome, { ok: true });
assert.notEqual(systemctl('is-failed', SERVICE), 'failed');

write('--- removing the helper leaves no unit, no trigger, and nothing to start');
await removeDesktopSetupHelper({ layout, systemd });
assert.equal(existsSync(layout.upgradeHelper.desktopPathUnitPath), false);
assert.equal(existsSync(layout.upgradeHelper.desktopServiceUnitPath), false);
assert.equal(existsSync(trigger), false);
assert.notEqual(systemctl('is-active', PATH_UNIT), 'active');
assert.notEqual(systemctl('is-enabled', PATH_UNIT), 'enabled');
write('desktop setup under systemd: all checks passed');
