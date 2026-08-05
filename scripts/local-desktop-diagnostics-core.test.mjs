import assert from 'node:assert/strict';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const diagnostics = await importBundled('../electron/diagnostics/core.ts');
const {
	DIAGNOSTIC_SCHEMA_VERSION,
	DiagnosticSourceRateLimiter,
	MAX_EVENT_BYTES,
	SegmentedJsonlWriter,
	beginLaunchMarker,
	cleanupDiagnosticArtifacts,
	cleanupManagedArtifacts,
	completeLaunchMarker,
	encodeDiagnosticEvent,
	normalizeDiagnosticEvent,
	readCurrentLaunchMarker,
	recognizeManagedArtifactName,
	sanitizeDiagnosticText,
} = diagnostics;

function input(overrides = {}) {
	return {
		severity: 'error',
		component: 'renderer',
		event: 'renderer.console',
		...overrides,
	};
}

test('schema normalization is stable, bounded, cycle-safe, and cannot forge JSONL records', () => {
	const cyclic = { z: 'last', a: 'first\nforged\u0000line' };
	cyclic.self = cyclic;
	cyclic.deep = {
		one: { two: { three: { four: { five: { six: 'bounded' } } } } },
	};
	const event = normalizeDiagnosticEvent(
		input({ message: 'x'.repeat(MAX_EVENT_BYTES * 3), fields: cyclic }),
		'launch-1',
		{
			now: () => Date.UTC(2026, 7, 5),
		},
	);
	const encoded = encodeDiagnosticEvent(event);
	assert.equal(event.schemaVersion, DIAGNOSTIC_SCHEMA_VERSION);
	assert.equal(event.timestamp, '2026-08-05T00:00:00.000Z');
	assert.equal(event.fields.self, '<circular>');
	assert.equal(event.truncated, true);
	assert.ok(Buffer.byteLength(encoded) <= MAX_EVENT_BYTES);
	assert.equal(encoded.endsWith('\n'), true);
	assert.equal(encoded.slice(0, -1).includes('\n'), false);
	assert.deepEqual(JSON.parse(encoded), event);
});

test('normalization tolerates hostile accessors, symbols, bigint, invalid dates, and errors', () => {
	const hostile = Object.create(null, {
		inaccessible: {
			enumerable: true,
			get: () => {
				throw new Error('getter should not escape');
			},
		},
		bigint: { enumerable: true, value: 12n },
		symbol: { enumerable: true, value: Symbol('diagnostic') },
		invalidDate: { enumerable: true, value: new Date(Number.NaN) },
		error: { enumerable: true, value: new Error('safe failure') },
	});
	const event = normalizeDiagnosticEvent(input({ fields: hostile }), 'launch');
	assert.equal(event.fields.inaccessible, '<unreadable-property>');
	assert.equal(event.fields.bigint, '12n');
	assert.equal(event.fields.symbol, 'diagnostic');
	assert.equal(event.fields.invalidDate, '<invalid-date>');
	assert.match(event.fields.error.message, /safe failure/);
});

test('common credentials, authority URLs, home paths, Windows paths, and private keys are redacted', () => {
	const canaries = [
		'Authorization: Bearer auth-canary-123',
		'api_key=api-canary-123',
		'password="password-canary"',
		'https://person:pass@example.test/private?q=query-canary#fragment-canary',
		'/Users/alice/private/project/file.ts',
		'C:\\Users\\Alice\\private\\file.ts',
		'ghp_githubcanary123456789',
		'-----BEGIN PRIVATE KEY-----\nprivate-canary\n-----END PRIVATE KEY-----',
	].join(' | ');
	const sanitized = sanitizeDiagnosticText(canaries);
	for (const canary of [
		'auth-canary',
		'api-canary',
		'password-canary',
		'query-canary',
		'fragment-canary',
		'alice',
		'githubcanary',
		'private-canary',
	]) {
		assert.equal(
			sanitized.toLowerCase().includes(canary.toLowerCase()),
			false,
			canary,
		);
	}
	assert.match(sanitized, /<redacted>|<url:redacted>|<path:redacted>/);
});

test('secret-shaped fields are recursively redacted even when values have no label', () => {
	const event = normalizeDiagnosticEvent(
		input({
			fields: {
				apiKey: 'unique-api-field-canary',
				nested: { reconnect_grant: 'unique-grant-field-canary' },
			},
		}),
		'launch',
	);
	const encoded = encodeDiagnosticEvent(event);
	assert.equal(encoded.includes('unique-api-field-canary'), false);
	assert.equal(encoded.includes('unique-grant-field-canary'), false);
	assert.equal(event.fields.apiKey, '<redacted>');
	assert.equal(event.fields.nested.reconnect_grant, '<redacted>');
});

test('source limiting accounts for text and lifecycle independently and emits one bounded summary', () => {
	let now = 1_000;
	const limiter = new DiagnosticSourceRateLimiter({
		now: () => now,
		windowMs: 10_000,
		textEntries: 2,
		textBytes: 10,
		lifecycleEntries: 1,
		lifecycleBytes: 100,
	});
	assert.equal(limiter.admit('renderer-1', 5).allowed, true);
	assert.equal(limiter.admit('renderer-1', 5).allowed, true);
	assert.equal(limiter.admit('renderer-1', 1).allowed, false);
	assert.equal(limiter.admit('renderer-1', 1).allowed, false);
	assert.equal(limiter.admit('renderer-1', 20, 'lifecycle').allowed, true);
	assert.equal(limiter.admit('renderer-1', 20, 'lifecycle').allowed, false);
	now += 10_001;
	const summaries = limiter.drainSuppressionSummaries();
	assert.deepEqual(
		summaries.map(({ channel, count }) => ({ channel, count })),
		[
			{ channel: 'text', count: 2 },
			{ channel: 'lifecycle', count: 1 },
		],
	);
	assert.deepEqual(limiter.drainSuppressionSummaries(), []);
	assert.equal(limiter.admit('renderer-1', 10).allowed, true);
});

test('segmented writer produces private, independently parseable complete lines and rotates by size and age', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-writer-'));
	let now = 1_800_000_000_000;
	try {
		const writer = new SegmentedJsonlWriter({
			directory: root,
			launchId: 'launch-write',
			now: () => now,
			segmentMaxBytes: 700,
			segmentMaxAgeMs: 1_000,
		});
		await Promise.all(
			Array.from({ length: 12 }, (_, index) =>
				writer.write(input({ message: `entry-${index}-${'x'.repeat(80)}` })),
			),
		);
		now += 1_001;
		await writer.write(input({ message: 'age-rotation' }));
		await writer.close();
		const files = (await readdir(root)).filter(
			(name) => recognizeManagedArtifactName(name)?.kind === 'segment',
		);
		assert.ok(files.length >= 3);
		assert.equal((await stat(root)).mode & 0o777, 0o700);
		let count = 0;
		for (const name of files) {
			const filePath = join(root, name);
			assert.equal((await stat(filePath)).mode & 0o777, 0o600);
			const content = await readFile(filePath, 'utf8');
			assert.equal(content.endsWith('\n'), true);
			for (const line of content.trimEnd().split('\n')) {
				assert.equal(JSON.parse(line).schemaVersion, 1);
				count += 1;
			}
		}
		assert.equal(count, 13);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('retention removes only recognized old or over-budget artifacts and never follows symlinks', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-retention-'));
	const outside = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-outside-'),
	);
	const now = 1_800_000_000_000;
	const old = `terminay-diagnostics-v1-${now - 100_000}-launch-0000.jsonl`;
	const newer = `terminay-diagnostics-v1-${now - 2_000}-launch-0001.jsonl`;
	const newest = `terminay-crash-v1-${now - 1_000}-launch.dmp`;
	const symlinkName = `terminay-diagnostics-v1-${now - 200_000}-launch-0002.jsonl`;
	try {
		await writeFile(join(root, old), Buffer.alloc(20), { mode: 0o600 });
		await writeFile(join(root, newer), Buffer.alloc(20), { mode: 0o600 });
		await writeFile(join(root, newest), Buffer.alloc(20), { mode: 0o600 });
		await writeFile(join(root, 'notes.txt'), 'user-owned');
		await writeFile(join(outside, 'canary.txt'), 'outside');
		await symlink(join(outside, 'canary.txt'), join(root, symlinkName));
		const result = await cleanupManagedArtifacts(root, {
			now,
			maxAgeMs: 50_000,
			aggregateMaxBytes: 25,
		});
		assert.deepEqual(result.deleted, [old, newer]);
		assert.deepEqual(result.failed, []);
		assert.equal(
			await readFile(join(root, newest), 'utf8').then(() => true),
			true,
		);
		assert.equal(await readFile(join(root, 'notes.txt'), 'utf8'), 'user-owned');
		assert.equal((await lstat(join(root, symlinkName))).isSymbolicLink(), true);
		assert.equal(
			await readFile(join(outside, 'canary.txt'), 'utf8'),
			'outside',
		);
	} finally {
		await rm(root, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test('the combined budget safely recognizes actual Crashpad UUID dumps only in its dedicated root', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-combined-'));
	const crashpad = await mkdtemp(join(tmpdir(), 'terminay-crashpad-combined-'));
	const outside = await mkdtemp(join(tmpdir(), 'terminay-crashpad-outside-'));
	const now = Date.now();
	const segment = `terminay-diagnostics-v1-${now - 2_000}-launch-0000.jsonl`;
	const dump = '7d9dc450-cbaa-4cc4-a758-47d5e8b8a3fc.dmp';
	const linkedDump = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.dmp';
	try {
		await writeFile(join(root, segment), Buffer.alloc(20));
		await mkdir(join(crashpad, 'completed'));
		await writeFile(join(crashpad, 'completed', dump), Buffer.alloc(20));
		await writeFile(
			join(crashpad, 'completed', 'settings.dat'),
			Buffer.alloc(20),
		);
		await writeFile(join(outside, 'canary.dmp'), 'outside');
		await symlink(
			join(outside, 'canary.dmp'),
			join(crashpad, 'completed', linkedDump),
		);
		const result = await cleanupDiagnosticArtifacts(root, {
			crashpadDirectory: crashpad,
			now,
			maxAgeMs: 60_000,
			aggregateMaxBytes: 20,
		});
		assert.equal(result.deleted.length, 1);
		assert.equal((await readdir(root)).includes(segment), false);
		assert.equal(
			(await readdir(join(crashpad, 'completed'))).includes(dump),
			true,
		);
		assert.equal(
			await readFile(join(crashpad, 'completed', 'settings.dat'), 'utf8').then(
				() => true,
			),
			true,
		);
		assert.equal(
			(await lstat(join(crashpad, 'completed', linkedDump))).isSymbolicLink(),
			true,
		);
		assert.equal(
			await readFile(join(outside, 'canary.dmp'), 'utf8'),
			'outside',
		);
	} finally {
		await rm(root, { force: true, recursive: true });
		await rm(crashpad, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test('cleanup preserves the active segment and unfamiliar managed-looking names', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-active-'));
	const now = 1_800_000_000_000;
	const active = `terminay-diagnostics-v1-${now - 100_000}-launch-0000.jsonl`;
	try {
		await writeFile(join(root, active), 'active');
		await writeFile(
			join(root, 'terminay-diagnostics-v2-1-launch-0000.jsonl'),
			'future',
		);
		await cleanupManagedArtifacts(root, {
			now,
			maxAgeMs: 1,
			aggregateMaxBytes: 0,
			activePath: join(root, active),
		});
		assert.equal(await readFile(join(root, active), 'utf8'), 'active');
		assert.equal(
			await readFile(
				join(root, 'terminay-diagnostics-v2-1-launch-0000.jsonl'),
				'utf8',
			),
			'future',
		);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('launch marker detects interruption, records clean exit, and remains private', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-marker-'));
	try {
		const first = await beginLaunchMarker(root, 'launch-one', 1_000);
		assert.equal(first.previousInterrupted, false);
		const second = await beginLaunchMarker(root, 'launch-two', 2_000);
		assert.equal(second.previousInterrupted, true);
		assert.equal(second.previous.launchId, 'launch-one');
		assert.equal(
			await completeLaunchMarker(root, 'wrong-launch', 2_500),
			false,
		);
		assert.equal(await completeLaunchMarker(root, 'launch-two', 3_000), true);
		const clean = await readCurrentLaunchMarker(root);
		assert.equal(clean.state, 'clean');
		assert.equal(clean.endedAt, '1970-01-01T00:00:03.000Z');
		assert.equal(
			(await stat(join(root, 'terminay-launch-v1.json'))).mode & 0o777,
			0o600,
		);
		const third = await beginLaunchMarker(root, 'launch-three', 4_000);
		assert.equal(third.previousInterrupted, false);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});

test('launch marker refuses to replace a symlink', async () => {
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-marker-link-'),
	);
	const outside = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-marker-target-'),
	);
	try {
		const target = join(outside, 'target.json');
		await writeFile(target, 'canary');
		await symlink(target, join(root, 'terminay-launch-v1.json'));
		await assert.rejects(
			beginLaunchMarker(root, 'launch', 1_000),
			/symbolic link/,
		);
		assert.equal(await readFile(target, 'utf8'), 'canary');
	} finally {
		await rm(root, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	}
});

test('degraded writes do not reject callers and warnings are cadence-bounded and sanitized', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-diagnostics-degraded-'));
	let now = 1_000;
	const warnings = [];
	try {
		await chmod(root, 0o500);
		const impossibleDirectory = join(root, 'not-a-directory');
		await writeFile(impossibleDirectory, 'occupied').catch(async () => {
			await chmod(root, 0o700);
			await writeFile(impossibleDirectory, 'occupied');
			await chmod(root, 0o500);
		});
		const writer = new SegmentedJsonlWriter({
			directory: impossibleDirectory,
			launchId: 'launch',
			now: () => now,
			warningIntervalMs: 30_000,
			onWarning: (warning) => warnings.push(warning),
		});
		await writer.write(input({ message: 'first' }));
		await writer.write(input({ message: 'second' }));
		assert.equal(warnings.length, 1);
		now += 30_001;
		await writer.write(input({ message: 'third' }));
		assert.equal(warnings.length, 2);
		assert.equal(
			warnings.some((warning) => warning.includes('\n')),
			false,
		);
	} finally {
		await chmod(root, 0o700).catch(() => undefined);
		await rm(root, { force: true, recursive: true });
	}
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-core-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'core.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node22',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
