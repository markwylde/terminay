import test from 'node:test';
import assert from 'node:assert/strict';
import {
	TerminalCommandDefaultRegistry,
	decodeCommandDefaults,
	encodeCommandDefaults,
	launcherCommandLine,
} from '../dist/index.js';

const BUILT_IN = 'com.terminay.builtin-agents';
const SOURCE = `${BUILT_IN}/agents`;

function entry(extensionId, local, command, extra = {}) {
	return {
		extensionId,
		contribution: { id: `${extensionId}/${local}`, command, ...extra },
	};
}

/** A stand-in for the extension host manager. */
function fakeSource(entries, resolutions) {
	const listeners = new Set();
	const calls = [];
	return {
		calls,
		entries,
		terminalCommandDefaultContributions: () => entries,
		async resolveTerminalCommandDefault(id) {
			calls.push(id);
			const answer = resolutions[id];
			if (answer instanceof Error) throw answer;
			if (typeof answer === 'function') return answer();
			return answer ?? { applies: false, reason: 'unsupported' };
		},
		onContributionsChanged(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async changed() {
			for (const listener of listeners) await listener();
		},
	};
}

const codex = entry(BUILT_IN, 'codex-no-daemon', 'codex', {
	harness: { source: SOURCE, harness: 'codex' },
});
const applies = { applies: true, args: ['--no-daemon'] };

test('applies a default once its extension answers with flags', async () => {
	const source = fakeSource([codex], { [codex.contribution.id]: applies });
	const registry = new TerminalCommandDefaultRegistry();
	registry.attach(source);
	await registry.refresh();
	assert.deepEqual(registry.current(), [
		{ command: 'codex', args: ['--no-daemon'] },
	]);
	assert.deepEqual(registry.argsForExecutable('/Users/me/.local/bin/codex'), [
		'--no-daemon',
	]);
	assert.deepEqual(
		registry.argsForExecutable('/Users/me/.local/bin/claude'),
		[],
	);
});

test('a launch never waits: an unanswered default is simply absent', async () => {
	let release;
	const source = fakeSource([codex], {
		[codex.contribution.id]: () =>
			new Promise((resolve) => {
				release = () => resolve(applies);
			}),
	});
	const registry = new TerminalCommandDefaultRegistry();
	registry.attach(source);
	assert.deepEqual(registry.current(), []);
	release();
	await registry.refresh();
	assert.deepEqual(registry.current(), [
		{ command: 'codex', args: ['--no-daemon'] },
	]);
});

test('a default whose harness is off is neither applied nor asked', async () => {
	const source = fakeSource([codex], { [codex.contribution.id]: applies });
	const registry = new TerminalCommandDefaultRegistry({
		harnessSwitches: { [`${SOURCE}/codex`]: false },
	});
	registry.attach(source);
	await registry.refresh();
	assert.deepEqual(registry.current(), []);
	assert.deepEqual(source.calls, []);
	registry.setHarnessSwitches({ [`${SOURCE}/codex`]: true });
	await registry.refresh();
	assert.deepEqual(registry.current(), [
		{ command: 'codex', args: ['--no-daemon'] },
	]);
	registry.setHarnessSwitches({ [`${SOURCE}/codex`]: false });
	assert.deepEqual(registry.current(), []);
});

test('an answer that is not flags, a failure, or a timeout does not apply', async () => {
	for (const answer of [
		{ applies: true, args: ['exec'] },
		{ applies: true, args: [] },
		{ applies: true, args: ['--a\nb'] },
		new Error('boom'),
		{ applies: false, reason: 'not_installed' },
	]) {
		const source = fakeSource([codex], { [codex.contribution.id]: answer });
		const registry = new TerminalCommandDefaultRegistry();
		registry.attach(source);
		await registry.refresh();
		assert.deepEqual(
			registry.current(),
			[],
			JSON.stringify(answer?.message ?? answer),
		);
	}
});

test('a contribution naming a reserved word never applies', async () => {
	const cd = entry('example.ext', 'cd', 'cd');
	const source = fakeSource([cd], { [cd.contribution.id]: applies });
	const registry = new TerminalCommandDefaultRegistry();
	registry.attach(source);
	await registry.refresh();
	assert.deepEqual(registry.current(), []);
	assert.deepEqual(source.calls, []);
});

test('two extensions claiming one command cancel out and are reported', async () => {
	const other = entry('example.other', 'codex', 'codex');
	const reports = [];
	const source = fakeSource([codex, other], {
		[codex.contribution.id]: applies,
		[other.contribution.id]: { applies: true, args: ['--yolo'] },
	});
	const registry = new TerminalCommandDefaultRegistry({
		onConflicts: (conflicts) => reports.push(conflicts),
	});
	registry.attach(source);
	await registry.refresh();
	assert.deepEqual(registry.current(), []);
	assert.deepEqual(registry.conflicts(), [
		{
			command: 'codex',
			contributionIds: [codex.contribution.id, other.contribution.id].sort(),
			extensionIds: [BUILT_IN, 'example.other'],
		},
	]);
	assert.equal(reports.length, 1);
	source.entries.splice(1, 1);
	await source.changed();
	assert.deepEqual(registry.current(), [
		{ command: 'codex', args: ['--no-daemon'] },
	]);
	assert.deepEqual(registry.conflicts(), []);
	assert.deepEqual(reports.at(-1), []);
});

test('a stale answer is asked again in the background, and a removed default goes', async () => {
	let now = 0;
	let answer = applies;
	const source = fakeSource([codex], { [codex.contribution.id]: () => answer });
	const registry = new TerminalCommandDefaultRegistry({
		now: () => now,
		maxResolutionAgeMs: 1_000,
	});
	registry.attach(source);
	await registry.refresh();
	assert.equal(source.calls.length, 1);
	answer = { applies: false, reason: 'unsupported' };
	now = 2_000;
	assert.deepEqual(registry.current(), [
		{ command: 'codex', args: ['--no-daemon'] },
	]);
	await registry.refresh();
	assert.deepEqual(registry.current(), []);
	source.entries.length = 0;
	await source.changed();
	assert.deepEqual(registry.current(), []);
});

test('the environment encoding round-trips hostile flags as data and drops invalid entries', () => {
	const defaults = [
		{
			command: 'codex',
			args: ['--no-daemon', '--x=$(touch /tmp/p) \'q\' "d";z', '--ü=✓'],
		},
		{ command: 'cd', args: ['--bad'] },
		{ command: 'sub', args: ['exec'] },
		{ command: 'nl', args: ['--a\nb'] },
	];
	const encoded = encodeCommandDefaults(defaults);
	assert.equal(
		encoded,
		'codex\u001f--no-daemon\u001f--x=$(touch /tmp/p) \'q\' "d";z\u001f--ü=✓',
	);
	assert.deepEqual(decodeCommandDefaults(encoded), [defaults[0]]);
	assert.equal(encodeCommandDefaults([]), '');
	assert.deepEqual(decodeCommandDefaults(''), []);
});

test("a launcher line carries a matching default's flags, quoted for the shell", () => {
	assert.equal(
		launcherCommandLine('/Users/me/.local/bin/codex', '/bin/zsh', [
			'--no-daemon',
		]),
		"'/Users/me/.local/bin/codex' '--no-daemon'\r",
	);
	assert.equal(
		launcherCommandLine('/opt/codex', '/bin/bash', ["--x='y'"]),
		"'/opt/codex' '--x='\\''y'\\'''\r",
	);
	assert.equal(
		launcherCommandLine('/opt/codex', '/usr/bin/fish', ["--x=a\\'b"]),
		"'/opt/codex' '--x=a\\\\\\'b'\r",
	);
	assert.equal(
		launcherCommandLine("C:\\it's\\codex.exe", 'pwsh.exe', ['--no-daemon']),
		"& 'C:\\it''s\\codex.exe' '--no-daemon'\r",
	);
	assert.equal(
		launcherCommandLine('C:\\codex.exe', 'cmd.exe', ['--no-daemon']),
		'"C:\\codex.exe" "--no-daemon"\r',
	);
	assert.equal(
		launcherCommandLine('C:\\codex.exe', 'cmd.exe', ['--x=%PATH%']),
		'"C:\\codex.exe"\r',
	);
	assert.equal(
		launcherCommandLine('/opt/codex', '/bin/zsh', ['exec']),
		"'/opt/codex'\r",
	);
	assert.equal(launcherCommandLine('/opt/codex', '/bin/zsh'), "'/opt/codex'\r");
});
