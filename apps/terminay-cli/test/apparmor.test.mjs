import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BOT_APPARMOR_PROFILE,
	installBotAppArmorProfile,
	removeBotAppArmorProfile,
	runHostSetup,
} from '../dist/apparmor.js';
import { fakeAppArmorHost, loads } from './apparmor-fixture.mjs';

const PATH = '/etc/apparmor.d/terminay-bot';
const LOAD = `/usr/sbin/apparmor_parser -r -W ${PATH}`;

/**
 * Moby v28.0.0 `profiles/apparmor/template.go`, rendered with Name
 * `terminay-bot` and DaemonProfile `unconfined`, comments and blank lines
 * dropped. The profile must be exactly these rules plus `userns,`.
 */
const MOBY_V28_RULES = [
	'#include <tunables/global>',
	'profile terminay-bot flags=(attach_disconnected,mediate_deleted) {',
	'#include <abstractions/base>',
	'network,',
	'capability,',
	'file,',
	'umount,',
	'signal (receive) peer=unconfined,',
	'signal (receive) peer=runc,',
	'signal (receive) peer=crun,',
	'signal (receive) peer=unconfined,',
	'signal (send,receive) peer=terminay-bot,',
	'deny @{PROC}/* w,',
	'deny @{PROC}/{[^1-9],[^1-9][^0-9],[^1-9s][^0-9y][^0-9s],[^1-9][^0-9][^0-9][^0-9/]*}/** w,',
	'deny @{PROC}/sys/[^k]** w,',
	'deny @{PROC}/sys/kernel/{?,??,[^s][^h][^m]**} w,',
	'deny @{PROC}/sysrq-trigger rwklx,',
	'deny @{PROC}/kcore rwklx,',
	'deny mount,',
	'deny /sys/[^f]*/** wklx,',
	'deny /sys/f[^s]*/** wklx,',
	'deny /sys/fs/[^c]*/** wklx,',
	'deny /sys/fs/c[^g]*/** wklx,',
	'deny /sys/fs/cg[^r]*/** wklx,',
	'deny /sys/firmware/** rwklx,',
	'deny /sys/devices/virtual/powercap/** rwklx,',
	'deny /sys/kernel/security/** rwklx,',
	'ptrace (trace,read,tracedby,readby) peer=terminay-bot,',
	'}',
];

function rules(profile) {
	return profile
		.split('\n')
		.map((line) =>
			line.startsWith('#include') || line.trim().startsWith('#include')
				? line.trim()
				: line.replace(/#.*$/u, '').trim(),
		)
		.filter((line) => line !== '');
}

test('the profile is Moby v28 docker-default plus userns, and nothing else', () => {
	const actual = rules(BOT_APPARMOR_PROFILE);
	const withoutUserns = actual.filter((line) => line !== 'userns,');
	assert.deepEqual(withoutUserns, MOBY_V28_RULES);
	assert.equal(
		actual.filter((line) => line === 'userns,').length,
		1,
		'exactly one added rule',
	);
	assert.equal(actual.indexOf('userns,'), actual.indexOf('umount,') + 1);
});

test('install writes root-owned 0644 atomically, then loads once', async () => {
	const host = fakeAppArmorHost();
	const result = await installBotAppArmorProfile(host);
	assert.deepEqual(result, { status: 'loaded', wrote: true });
	const file = host.files.get(PATH);
	assert.equal(file.contents, BOT_APPARMOR_PROFILE);
	assert.deepEqual([file.uid, file.gid, file.mode], [0, 0, 0o644]);
	const temporary = host.calls
		.find((line) => line.startsWith('write '))
		.slice('write '.length);
	assert.notEqual(temporary, PATH, 'written beside the profile, then renamed');
	assert.deepEqual(host.calls.slice(1), [
		`write ${temporary}`,
		`chown 0:0 ${temporary}`,
		`chmod 644 ${temporary}`,
		`rename ${temporary} ${PATH}`,
		LOAD,
	]);
});

test('an unchanged root-owned profile is reloaded without rewriting', async () => {
	const host = fakeAppArmorHost({
		files: {
			[PATH]: { contents: BOT_APPARMOR_PROFILE, uid: 0, gid: 0, mode: 0o644 },
		},
	});
	assert.deepEqual(await installBotAppArmorProfile(host), {
		status: 'loaded',
		wrote: false,
	});
	assert.deepEqual(host.calls, [LOAD]);
});

test('right contents with the wrong owner or mode are rewritten', async () => {
	for (const wrong of [
		{ uid: 1000, gid: 0, mode: 0o644 },
		{ uid: 0, gid: 0, mode: 0o666 },
	]) {
		const host = fakeAppArmorHost({
			files: { [PATH]: { contents: BOT_APPARMOR_PROFILE, ...wrong } },
		});
		assert.deepEqual(await installBotAppArmorProfile(host), {
			status: 'loaded',
			wrote: true,
		});
		const file = host.files.get(PATH);
		assert.deepEqual([file.uid, file.gid, file.mode], [0, 0, 0o644]);
	}
});

test('no AppArmor, no parser, or not root: skipped and nothing touched', async () => {
	for (const host of [
		fakeAppArmorHost({ absent: ['/sys/kernel/security/apparmor'] }),
		fakeAppArmorHost({ absent: ['/usr/sbin/apparmor_parser'] }),
		fakeAppArmorHost({ uid: 1000 }),
	]) {
		const result = await installBotAppArmorProfile(host);
		assert.equal(result.status, 'skipped');
		assert.deepEqual(host.calls, []);
	}
});

test('a failed write, chown, or chmod warns, cleans up, and never loads', async () => {
	for (const step of ['write', 'chown', 'chmod']) {
		const host = fakeAppArmorHost({ fail: { [step]: true } });
		const result = await installBotAppArmorProfile(host);
		assert.equal(result.status, 'warning', step);
		assert.match(result.warning, /write the terminay-bot AppArmor profile/u);
		assert.deepEqual(loads(host), [], `${step} failure must not load`);
		assert.equal(host.files.has(PATH), false);
		assert.deepEqual([...host.files.keys()], [], 'temporary file removed');
	}
});

test('a parser failure is a warning naming the profile and the cause', async () => {
	const host = fakeAppArmorHost({ fail: { parser: true } });
	const result = await installBotAppArmorProfile(host);
	assert.equal(result.status, 'warning');
	assert.match(result.warning, /load the terminay-bot AppArmor profile/u);
	assert.match(result.warning, /syntax error/u);
});

test('remove deletes the file and never unloads the profile', async () => {
	const host = fakeAppArmorHost({
		files: {
			[PATH]: { contents: BOT_APPARMOR_PROFILE, uid: 0, gid: 0, mode: 0o644 },
		},
	});
	assert.equal(await removeBotAppArmorProfile(host), true);
	assert.equal(host.files.has(PATH), false);
	assert.deepEqual(loads(host), []);
	assert.equal(await removeBotAppArmorProfile(host), false, 'already gone');
	assert.equal(
		await removeBotAppArmorProfile(fakeAppArmorHost({ uid: 1000 })),
		false,
	);
});

test('host-setup installs as root, refuses otherwise, and takes no arguments', async () => {
	const lines = [];
	const host = fakeAppArmorHost();
	assert.equal(await runHostSetup([], (line) => lines.push(line), host), 0);
	assert.deepEqual(loads(host), [LOAD]);
	assert.match(
		lines.join('\n'),
		/Installed the terminay-bot AppArmor profile/u,
	);

	const unprivileged = fakeAppArmorHost({ uid: 1000 });
	assert.equal(await runHostSetup([], () => {}, unprivileged), 1);
	assert.deepEqual(unprivileged.calls, []);

	assert.equal(await runHostSetup(['--now'], () => {}, fakeAppArmorHost()), 2);
});
