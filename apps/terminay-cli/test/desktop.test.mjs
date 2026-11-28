import assert from 'node:assert/strict';
import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import {
	link,
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_INSTALL_EXIT,
	DESKTOP_PACKAGES,
	DESKTOP_SETUP_HELPER_ENVIRONMENT,
	HELPER_MINIMUM_RUN_MS,
	missingDesktopBrowsers,
	missingDesktopPrograms,
	packageManagerEnvironment,
	parseAptStatusLine,
	readDesktopSetupStatus,
	runDesktopCommand,
	runDesktopInstall,
} from '../dist/desktop.js';
import {
	desktopSetupHelperInstalled,
	installDesktopSetupHelper,
	installDesktopSetupHelperFromRecord,
	removeDesktopSetupHelper,
} from '../dist/desktopHelper.js';
import { installUpgradeHelper } from '../dist/helper.js';
import { installLayout, writeInstallRecord } from '../dist/layout.js';
import { createSystemd } from '../dist/systemd.js';
import {
	renderDesktopSetupPathUnit,
	renderDesktopSetupServiceUnit,
} from '../dist/unit.js';
import { createFakeBin } from './fake-bin.mjs';

/**
 * A Debian host with a stubbed package manager. `apt-get install` "installs"
 * by creating a marker the fake `executable` reads.
 */
async function machine(t, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-desktop-'));
	const fake = await createFakeBin();
	const marker = join(root, 'installed');
	const snapshots = join(root, 'snapshots');
	await mkdir(snapshots);
	const statusDirectory = join(root, 'run');
	if (options.installed) writeFileSync(marker, '');
	const dpkg = fake.install('dpkg', options.dpkg ?? '');
	const aptGet = fake.install(
		'apt-get',
		options.aptGet ??
			`env > ${JSON.stringify(join(root, 'env'))}
if [ "$1" = update ]; then exit 0; fi
snap() { sleep 0.15; cp ${JSON.stringify(join(statusDirectory, 'status.json'))} ${JSON.stringify(snapshots)}/$1 2>/dev/null; }
printf 'dlstatus:1:50.0:Retrieving\\n' >&3; snap 1
printf 'dlstatus:2:100.0:Retrieving\\n' >&3; snap 2
printf 'pmstatus:xfwm4:40.0:Installing\\n' >&3; snap 3
printf 'pmstatus:xfwm4:20.0:Out of order\\n' >&3; snap 4
printf 'pmstatus:dpkg-exec:100.0:Running dpkg\\n' >&3; snap 5
: > ${JSON.stringify(marker)}
exit 0`,
	);
	t.after(async () => {
		await fake.close();
		await rm(root, { recursive: true, force: true });
	});
	let clock = 1_000_000;
	const sleeps = [];
	const lines = [];
	const host = {
		uid: 0,
		env: {},
		platform: 'linux',
		osRelease: async () => 'ID=debian\nVERSION_ID="13"\n',
		executable: async () => existsSync(marker),
		list: async () =>
			existsSync(marker) ? ['seccomp.cpython-313-x86_64-linux-gnu.so'] : [],
		statusDirectory,
		aptGet,
		dpkg,
		now: () => clock,
		sleep: async (ms) => {
			sleeps.push(ms);
			clock += ms;
		},
		pid: process.pid,
		...options.host,
	};
	return {
		root,
		fake,
		host,
		lines,
		sleeps,
		statusDirectory,
		snapshots,
		marker,
		write: (line) => lines.push(line),
	};
}

test('anything after `install` is refused, and nothing runs', async (t) => {
	const m = await machine(t);
	for (const args of [
		['--package', 'evil'],
		['evil'],
		['--no-install-recommends'],
		['--', 'x'],
	]) {
		assert.equal(
			await runDesktopInstall(args, m.write, m.host),
			DESKTOP_INSTALL_EXIT.usage,
		);
		assert.equal(
			await runDesktopCommand(['install', ...args], m.write, m.host),
			DESKTOP_INSTALL_EXIT.usage,
		);
	}
	assert.equal(
		await runDesktopCommand([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.usage,
	);
	assert.equal(
		await runDesktopCommand(['remove'], m.write, m.host),
		DESKTOP_INSTALL_EXIT.usage,
	);
	assert.deepEqual(m.fake.invocations(), []);
	assert.equal(existsSync(m.statusDirectory), false);
});

test('a host that is not Debian is refused before anything is touched', async (t) => {
	for (const host of [
		{ osRelease: async () => 'ID=ubuntu\nID_LIKE=debian\n' },
		{ osRelease: async () => 'ID=fedora\n' },
		{ osRelease: async () => undefined },
		{ platform: 'darwin' },
	]) {
		const m = await machine(t, { host });
		assert.equal(
			await runDesktopInstall([], m.write, m.host),
			DESKTOP_INSTALL_EXIT.unsupported,
		);
		assert.match(m.lines.join('\n'), /Debian Linux only/);
		assert.deepEqual(m.fake.invocations(), []);
		assert.equal(existsSync(m.statusDirectory), false);
	}
});

test('it must run as root', async (t) => {
	const m = await machine(t, { host: { uid: 1000 } });
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	assert.match(m.lines.join('\n'), /must run as root/);
	assert.deepEqual(m.fake.invocations(), []);
});

test('with the programs already there it exits early: no package manager, no network', async (t) => {
	const m = await machine(t, { installed: true });
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	assert.deepEqual(m.fake.invocations(), []);
	const status = await readDesktopSetupStatus(m.statusDirectory);
	assert.deepEqual(status.outcome, { ok: true });
	assert.equal(status.fraction, 1);
});

test('it finishes interrupted configuration, then installs the fixed list with no recommends, in an environment of its own', async (t) => {
	const m = await machine(t);
	process.env.TERMINAY_TEST_LEAK = 'leak';
	process.env.LD_PRELOAD_TEST_LEAK = 'leak';
	t.after(() => {
		delete process.env.TERMINAY_TEST_LEAK;
		delete process.env.LD_PRELOAD_TEST_LEAK;
	});
	m.host.env = {
		PATH: '/evil',
		APT_CONFIG: '/evil/apt.conf',
		TERMINAY_TEST_LEAK: 'leak',
	};
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	const calls = m.fake.invocations();
	assert.equal(calls.length, 3);
	assert.equal(calls[0], 'dpkg --configure -a');
	assert.match(calls[1], /^apt-get update -o DPkg::Lock::Timeout=120 /);
	assert.equal(
		calls[2],
		`apt-get install --yes --no-install-recommends -o DPkg::Lock::Timeout=120 -o APT::Status-Fd=3 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -- ${DESKTOP_PACKAGES.join(' ')}`,
	);
	const env = readFileSync(join(m.root, 'env'), 'utf8');
	assert.match(env, /^DEBIAN_FRONTEND=noninteractive$/m);
	assert.match(
		env,
		/^PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m,
	);
	assert.doesNotMatch(env, /LEAK|APT_CONFIG|evil/);
	assert.deepEqual(Object.keys(packageManagerEnvironment()).sort(), [
		'APT_LISTCHANGES_FRONTEND',
		'DEBIAN_FRONTEND',
		'HOME',
		'LANG',
		'LC_ALL',
		'NEEDRESTART_MODE',
		'NEEDRESTART_SUSPEND',
		'PATH',
	]);
});

test('progress follows apt, names its step, never runs backwards, and ends with the outcome', async (t) => {
	const m = await machine(t);
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	const seen = readdirSync(m.snapshots)
		.sort()
		.map((name) => JSON.parse(readFileSync(join(m.snapshots, name), 'utf8')));
	assert.ok(seen.length >= 4);
	const identity = seen[0].run;
	for (let i = 0; i < seen.length; i++) {
		assert.equal(seen[i].run, identity);
		assert.equal(seen[i].outcome, undefined);
		assert.equal(seen[i].pid, process.pid);
		if (i > 0)
			assert.ok(
				seen[i].fraction >= seen[i - 1].fraction,
				'progress went backwards',
			);
	}
	assert.equal(seen[0].step, 'downloading');
	assert.ok(seen[0].fraction > 0.1 && seen[0].fraction < 0.5);
	assert.equal(seen.at(-1).step, 'installing');
	assert.equal(seen.at(-1).fraction, 1);
	const final = await readDesktopSetupStatus(m.statusDirectory);
	assert.deepEqual(final.outcome, { ok: true });
	assert.equal(final.run, identity);
	// The terminal is told each step and how far the whole has got.
	const said = m.lines.join('\n');
	assert.match(said, /^Waiting for the package manager \(0%\)$/m);
	assert.match(said, /^Reading the package lists \(0%\)$/m);
	assert.match(said, /^Downloading packages \(\d0%\)$/m);
	assert.match(said, /^Installing packages \(\d0%\)$/m);
	assert.equal(m.lines.at(-1), 'The server desktop is set up.');
	assert.equal(new Set(m.lines).size, m.lines.length);
	// Root-owned and readable by the run-as account, writable by root alone.
	assert.equal(statSync(m.statusDirectory).mode & 0o777, 0o755);
	assert.equal(
		statSync(join(m.statusDirectory, 'status.json')).mode & 0o777,
		0o644,
	);
	assert.deepEqual(
		readdirSync(m.statusDirectory).filter((name) => name.endsWith('.tmp')),
		[],
	);
});

test('the package lock is waited for a bounded time', async (t) => {
	const counter = join(tmpdir(), `terminay-dpkg-count-${process.pid}`);
	t.after(() => rm(counter, { force: true }));
	const locked = `n=$(cat ${JSON.stringify(counter)} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${JSON.stringify(counter)}
if [ "$n" -le 3 ]; then echo "dpkg: error: dpkg frontend lock was locked by another process with pid 42" >&2; exit 2; fi`;
	const eventually = await machine(t, { dpkg: locked });
	assert.equal(
		await runDesktopInstall([], eventually.write, eventually.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	assert.deepEqual(eventually.sleeps, [2000, 2000, 2000]);

	const never = await machine(t, {
		dpkg: 'echo "dpkg: error: dpkg frontend lock was locked by another process with pid 42" >&2; exit 2',
	});
	assert.equal(
		await runDesktopInstall([], never.write, never.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	// Two-second waits, bounded by the 120 seconds allowed.
	assert.equal(never.sleeps.length, 60);
	const status = await readDesktopSetupStatus(never.statusDirectory);
	assert.equal(status.outcome.ok, false);
	assert.equal(status.outcome.step, 'preparing');
	assert.match(status.outcome.reason, /frontend lock/);
	assert.equal(
		never.fake.invocations().some((line) => line.startsWith('apt-get')),
		false,
	);
});

test("a failure names its step and gives the package manager's reason", async (t) => {
	const download = await machine(t, {
		aptGet: `if [ "$1" = update ]; then exit 0; fi
printf 'dlstatus:1:10.0:Retrieving\\n' >&3
echo "E: Failed to fetch http://deb.debian.org/x  Temporary failure resolving 'deb.debian.org'" >&2
exit 100`,
	});
	assert.equal(
		await runDesktopInstall([], download.write, download.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	let status = await readDesktopSetupStatus(download.statusDirectory);
	assert.equal(status.outcome.step, 'downloading');
	assert.match(status.outcome.reason, /^E: Failed to fetch/);

	const lists = await machine(t, {
		aptGet:
			'echo "E: Could not get lock /var/lib/apt/lists/lock" >&2; exit 100',
	});
	assert.equal(
		await runDesktopInstall([], lists.write, lists.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	status = await readDesktopSetupStatus(lists.statusDirectory);
	assert.equal(status.outcome.step, 'preparing');

	const unpack = await machine(t, {
		aptGet: `if [ "$1" = update ]; then exit 0; fi
printf 'pmstatus:xfwm4:30.0:Unpacking\\n' >&3
sleep 0.2
echo "dpkg: error processing archive xfwm4.deb (--unpack): no space left on device" >&2
exit 100`,
	});
	assert.equal(
		await runDesktopInstall([], unpack.write, unpack.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	status = await readDesktopSetupStatus(unpack.statusDirectory);
	assert.equal(status.outcome.step, 'installing');
	assert.match(status.outcome.reason, /no space left/);

	// apt says it worked, yet the programs are not there.
	const hollow = await machine(t, { aptGet: 'exit 0' });
	assert.equal(
		await runDesktopInstall([], hollow.write, hollow.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	status = await readDesktopSetupStatus(hollow.statusDirectory);
	assert.match(status.outcome.reason, /still missing: Xtigervnc/);
});

test('one run at a time: a second is told the first is running and changes nothing', async (t) => {
	const m = await machine(t, {
		aptGet: `if [ "$1" = update ]; then exit 0; fi
sleep 1
: > "$MARKER_UNUSED" 2>/dev/null
exit 100`,
	});
	const first = runDesktopInstall([], m.write, m.host);
	// Wait until the first holds the lock and has recorded itself.
	for (
		let i = 0;
		i < 100 && (await readDesktopSetupStatus(m.statusDirectory)) === undefined;
		i++
	)
		await new Promise((resolve) => setTimeout(resolve, 20));
	const running = await readDesktopSetupStatus(m.statusDirectory);
	const lines = [];
	assert.equal(
		await runDesktopInstall([], (line) => lines.push(line), m.host),
		DESKTOP_INSTALL_EXIT.busy,
	);
	assert.match(lines.join('\n'), /already running/);
	assert.equal(
		(await readDesktopSetupStatus(m.statusDirectory)).run,
		running.run,
	);
	await first;
});

test('a run after a killed one takes the stale lock and records its own identity', async (t) => {
	const m = await machine(t, { installed: true });
	await mkdir(m.statusDirectory, { recursive: true });
	// What a killed run leaves: a lock path nobody listens on, and a status
	// with no outcome.
	writeFileSync(join(m.statusDirectory, 'lock'), '');
	writeFileSync(
		join(m.statusDirectory, 'status.json'),
		JSON.stringify({
			version: 1,
			run: 'killed-run',
			pid: 2_000_000_000,
			startedAt: 1,
			step: 'installing',
			fraction: 0.7,
		}),
	);
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	const status = await readDesktopSetupStatus(m.statusDirectory);
	assert.notEqual(status.run, 'killed-run');
	assert.deepEqual(status.outcome, { ok: true });
	assert.equal(status.pid, process.pid);
});

test('as the root helper, a run lasts a minimum time after recording its outcome', async (t) => {
	const m = await machine(t, {
		installed: true,
		host: { env: { [DESKTOP_SETUP_HELPER_ENVIRONMENT]: '1' } },
	});
	let outcomeBeforeSleep;
	const sleep = m.host.sleep;
	m.host.sleep = async (ms) => {
		outcomeBeforeSleep = (await readDesktopSetupStatus(m.statusDirectory))
			?.outcome;
		await sleep(ms);
	};
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	assert.deepEqual(m.sleeps, [HELPER_MINIMUM_RUN_MS]);
	assert.deepEqual(outcomeBeforeSleep, { ok: true });
	// Run by hand, it does not linger.
	const byHand = await machine(t, { installed: true });
	await runDesktopInstall([], byHand.write, byHand.host);
	assert.deepEqual(byHand.sleeps, []);
});

test('apt status lines and the program check', async () => {
	assert.deepEqual(
		parseAptStatusLine('dlstatus:3:42.5:Retrieving file 3 of 9'),
		{ phase: 'download', percent: 42.5 },
	);
	assert.deepEqual(parseAptStatusLine('pmstatus:xfwm4:150:x'), {
		phase: 'install',
		percent: 100,
	});
	assert.equal(parseAptStatusLine('pmerror:xfwm4:10:broke'), undefined);
	assert.equal(parseAptStatusLine('nonsense'), undefined);
	assert.deepEqual(
		await missingDesktopPrograms({
			executable: async (path) =>
				path !== '/usr/bin/Xtigervnc' && path.startsWith('/usr/bin/'),
			list: async () => [],
		}),
		['Xtigervnc', 'python3-seccomp'],
	);
	// Either name of the password tool will do.
	assert.deepEqual(
		await missingDesktopPrograms({
			executable: async (path) =>
				path.startsWith('/usr/bin/') && !path.endsWith('/tigervncpasswd'),
			list: async () => ['seccomp.so'],
		}),
		[],
	);
});

test('setup installs the browsers, and a desktop set up without them gets them from a second run', async (t) => {
	assert.ok(DESKTOP_PACKAGES.includes('chromium'));
	assert.ok(DESKTOP_PACKAGES.includes('firefox-esr'));

	// Either name Debian gives Firefox will do; Chromium has one.
	assert.deepEqual(
		await missingDesktopBrowsers({
			executable: async (path) => path === '/usr/bin/firefox',
		}),
		['chromium'],
	);
	assert.deepEqual(
		await missingDesktopBrowsers({ executable: async () => true }),
		[],
	);
	// A browser is not one of the desktop's own programs.
	assert.deepEqual(
		await missingDesktopPrograms({
			executable: async (path) => !/chromium|firefox/u.test(path),
			list: async () => ['seccomp.so'],
		}),
		[],
	);

	// The desktop's programs are there and the browsers are not: the run does
	// not exit early.
	const m = await machine(t);
	const marker = join(m.root, 'installed');
	m.host.executable = async (path) =>
		existsSync(marker) || !/chromium|firefox/u.test(path);
	m.host.list = async () => ['seccomp.so'];
	assert.equal(
		await runDesktopInstall([], m.write, m.host),
		DESKTOP_INSTALL_EXIT.ok,
	);
	assert.match(m.fake.invocations().at(-1), /^apt-get install .* chromium firefox-esr$/u);

	// apt says it worked, yet a browser is not there.
	const hollow = await machine(t, { aptGet: 'exit 0' });
	hollow.host.executable = async (path) => !/chromium/u.test(path);
	hollow.host.list = async () => ['seccomp.so'];
	assert.equal(
		await runDesktopInstall([], hollow.write, hollow.host),
		DESKTOP_INSTALL_EXIT.failed,
	);
	const status = await readDesktopSetupStatus(hollow.statusDirectory);
	assert.match(status.outcome.reason, /still missing: chromium\./u);
});

test('the server names the same packages setup installs', async () => {
	const source = await readFile(
		new URL(
			'../../../packages/server-core/src/serverDesktop/support.ts',
			import.meta.url,
		),
		'utf8',
	);
	const list = /SERVER_DESKTOP_PACKAGES[^=]*= Object\.freeze\(\[([^\]]*)\]\)/u.exec(
		source,
	);
	assert.ok(list, 'the server package list was not found');
	assert.deepEqual(
		[...list[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]),
		[...DESKTOP_PACKAGES],
	);
});

test('`desktop check` says this CLI can install, and takes nothing', async () => {
	const lines = [];
	assert.equal(
		await runDesktopCommand(['check'], (line) => lines.push(line)),
		0,
	);
	assert.deepEqual(JSON.parse(lines[0]), {
		install: 1,
		statusFile: '/run/terminay-desktop-setup/status.json',
	});
	assert.equal(
		await runDesktopCommand(['check', 'x'], () => {}),
		DESKTOP_INSTALL_EXIT.usage,
	);
});

test('the helper units: a fixed command as root, a deadline, a start limit, and a watch on the trigger only', () => {
	const layout = installLayout('system', '/home/ada', '/');
	const service = renderDesktopSetupServiceUnit(layout);
	assert.match(
		service,
		/^ExecStart=\/opt\/terminay\/current\/bin\/terminay daemon desktop install$/m,
	);
	assert.match(service, /^User=root$/m);
	assert.match(service, /^Type=oneshot$/m);
	assert.match(service, /^TimeoutStartSec=20min$/m);
	assert.match(service, /^StartLimitIntervalSec=10min$/m);
	assert.match(service, /^StartLimitBurst=60$/m);
	assert.match(service, /^Environment=TERMINAY_DESKTOP_SETUP_HELPER=1$/m);
	assert.match(service, /^RuntimeDirectory=terminay-desktop-setup$/m);
	assert.match(service, /^RuntimeDirectoryMode=0755$/m);
	assert.match(service, /^RuntimeDirectoryPreserve=yes$/m);
	// Nothing of the trigger file, and no specifier systemd would expand.
	assert.doesNotMatch(service, /desktop-setup\b(?!\n)|%[a-zA-Z]/);
	assert.doesNotMatch(service, /terminay-upgrade/);
	const path = renderDesktopSetupPathUnit(layout);
	assert.match(
		path,
		/^PathChanged=\/var\/lib\/terminay-desktop-setup\/desktop-setup$/m,
	);
	assert.match(path, /^Unit=terminay-desktop-setup\.service$/m);
	assert.match(path, /^WantedBy=multi-user\.target$/m);
	// A user-scope install has no helper to render.
	assert.throws(
		() => renderDesktopSetupServiceUnit(installLayout('user', '/home/ada')),
		/system-scope/,
	);
});

test('retrying watch activation repairs a disabled or inactive path without touching the trigger', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-desktop-activation-'));
	const fake = await createFakeBin();
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	t.after(async () => {
		process.env.PATH = originalPath;
		await fake.close();
		await rm(root, { recursive: true, force: true });
	});
	fake.install('id', `echo ${process.getuid()}`);
	fake.install('systemctl', '[ "$1" != enable ]');
	const layout = installLayout('system', root, root);
	const helper = layout.upgradeHelper;
	const systemd = createSystemd({ scope: 'system', env: fake.env() });
	const install = () => installDesktopSetupHelper({ layout, runAs: 'ada', systemd });
	await assert.rejects(install, /enable --now terminay-desktop-setup\.path failed/);
	assert.equal(existsSync(helper.desktopPathUnitPath), true);
	assert.equal(existsSync(helper.desktopServiceUnitPath), true);
	const stamp = () => {
		const info = statSync(helper.desktopRequestFile);
		return [info.ino, info.mtimeMs, info.ctimeMs];
	};
	const before = stamp();
	for (const [unhealthyState, checks] of [
		['is-enabled', ['is-enabled']],
		['is-active', ['is-enabled', 'is-active']],
	]) {
		fake.install('systemctl', `[ "$1" != ${unhealthyState} ]`);
		const offset = fake.invocations().length;
		assert.equal(await install(), true);
		assert.deepEqual(stamp(), before);
		assert.deepEqual(
			fake.invocations().slice(offset).filter((call) => call.startsWith('systemctl ')),
			[
				...checks.map((check) => `systemctl ${check} terminay-desktop-setup.path`),
				'systemctl enable --now terminay-desktop-setup.path',
			],
		);
	}
});

test('installing the helper arms the watch once; reinstalling leaves the trigger untouched; removing leaves nothing', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-desktop-helper-'));
	const fake = await createFakeBin();
	fake.install('systemctl', '');
	fake.install('id', `echo ${process.getuid()}`);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	t.after(async () => {
		process.env.PATH = originalPath;
		await fake.close();
		await rm(root, { recursive: true, force: true });
	});
	const layout = installLayout('system', root, root);
	const helper = layout.upgradeHelper;
	const systemd = createSystemd({ scope: 'system', env: fake.env() });
	assert.equal(await desktopSetupHelperInstalled(layout), false);
	assert.equal(
		await installDesktopSetupHelper({ layout, runAs: 'ada', systemd }),
		true,
	);
	assert.equal(await desktopSetupHelperInstalled(layout), true);
	assert.equal(statSync(helper.desktopRequestDirectory).mode & 0o777, 0o755);
	assert.equal(statSync(helper.desktopRequestFile).mode & 0o777, 0o600);
	assert.equal(statSync(helper.desktopServiceUnitPath).mode & 0o777, 0o644);
	assert.equal(readFileSync(helper.desktopRequestFile, 'utf8'), '');
	assert.deepEqual(fake.invocations().filter((call) => call.startsWith('systemctl')), [
		'systemctl daemon-reload',
		'systemctl enable --now terminay-desktop-setup.path',
	]);
	// Again: nothing rewritten, the watch not stopped, the trigger not touched.
	const before = statSync(helper.desktopRequestFile).mtimeMs;
	assert.equal(
		await installDesktopSetupHelper({ layout, runAs: 'ada', systemd }),
		false,
	);
	assert.equal(statSync(helper.desktopRequestFile).mtimeMs, before);
	assert.deepEqual(fake.invocations().filter((call) => call.startsWith('systemctl')).slice(2), [
		'systemctl is-enabled terminay-desktop-setup.path',
		'systemctl is-active terminay-desktop-setup.path',
	]);
	// A user-scope install gets none.
	assert.equal(
		await installDesktopSetupHelper({
			layout: installLayout('user', root),
			runAs: 'ada',
			systemd,
		}),
		false,
	);

	await removeDesktopSetupHelper({ layout, systemd });
	assert.equal(existsSync(helper.desktopPathUnitPath), false);
	assert.equal(existsSync(helper.desktopServiceUnitPath), false);
	assert.equal(existsSync(helper.desktopRequestFile), false);
	assert.deepEqual(fake.invocations().filter((call) => call.startsWith('systemctl')).slice(4), [
		'systemctl disable --now terminay-desktop-setup.path',
		'systemctl stop terminay-desktop-setup.service',
		'systemctl reset-failed terminay-desktop-setup.path',
		'systemctl reset-failed terminay-desktop-setup.service',
	]);
});

test('desktop trigger migration and repair leave targets of account-selected links untouched', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-desktop-migration-'));
	const fake = await createFakeBin();
	fake.install('systemctl', '');
	fake.install('chown', '');
	fake.install('id', `echo ${process.getuid()}`);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	t.after(async () => {
		process.env.PATH = originalPath;
		await fake.close();
		await rm(root, { recursive: true, force: true });
	});
	const layout = installLayout('system', root, root);
	const helper = layout.upgradeHelper;
	const systemd = createSystemd({ scope: 'system', env: fake.env() });
	const options = { layout, runAs: 'ada', systemd };
	const target = join(root, 'keep');
	await writeFile(target, 'keep', { mode: 0o644 });
	await mkdir(helper.requestDirectory, { recursive: true });
	const legacy = join(helper.requestDirectory, 'desktop-setup');
	await link(target, legacy);
	await symlink(target, helper.requestFile);
	await mkdir(join(root, 'etc/systemd/system'), { recursive: true });
	await writeFile(
		helper.desktopPathUnitPath,
		renderDesktopSetupPathUnit(layout).replace(helper.desktopRequestFile, legacy),
	);
	const original = await lstat(target);

	// Legacy upgrade helper repair must leave the old desktop entry alone.
	await installUpgradeHelper(options);
	await mkdir(layout.prefix, { recursive: true });
	await symlink(target, layout.recordPath);
	await assert.rejects(
		installDesktopSetupHelperFromRecord(layout, systemd),
		/Unsafe system install record/u,
	);
	assert.equal(existsSync(helper.desktopRequestFile), false);
	await rm(layout.recordPath);
	await writeInstallRecord(layout, {
		schemaVersion: 1,
		scope: 'system',
		channel: 'tag',
		version: '1.0.0',
		revision: 'test',
		runAs: 'ada',
		dataRoot: layout.defaultDataRoot,
		projectRoot: root,
		port: 8080,
		healthPort: 8081,
		expose: 'hosted',
		installedAt: '2026-01-01T00:00:00Z',
	});
	assert.equal(await installDesktopSetupHelperFromRecord(layout, systemd), true);
	assert.equal(await installDesktopSetupHelperFromRecord(layout, systemd), false);
	assert.equal((await lstat(legacy)).ino, original.ino);
	assert.equal((await lstat(target)).ctimeMs, original.ctimeMs);
	assert.match(
		readFileSync(helper.desktopPathUnitPath, 'utf8'),
		/terminay-desktop-setup\/desktop-setup$/m,
	);
	const calls = fake.invocations();
	const stop = calls.indexOf('systemctl stop terminay-desktop-setup.path');
	assert.ok(stop >= 0);
	assert.deepEqual(calls.slice(stop, stop + 3), [
		'systemctl stop terminay-desktop-setup.path',
		'systemctl daemon-reload',
		'systemctl enable --now terminay-desktop-setup.path',
	]);

	await rm(helper.desktopRequestFile);
	await symlink(target, helper.desktopRequestFile);
	await installDesktopSetupHelper(options);
	const repaired = await lstat(helper.desktopRequestFile);
	assert.ok(repaired.isFile());
	assert.equal(repaired.mode & 0o7777, 0o600);
	assert.notEqual(repaired.ino, original.ino);
	assert.equal((await lstat(target)).ctimeMs, original.ctimeMs);
	assert.equal(readFileSync(target, 'utf8'), 'keep');
});
