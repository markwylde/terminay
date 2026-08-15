import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runServerUiArchiveBenchmark } from './server-ui-archive-benchmark.mjs';

test('archive benchmark records the actual binary one-request model against legacy per-file base64', async (t) => {
	const root = await mkdtemp(
		join(tmpdir(), 'terminay-server-ui-archive-benchmark-'),
	);
	t.after(() => rm(root, { force: true, recursive: true }));
	const rendererDirectory = join(root, 'renderer');
	await mkdir(join(rendererDirectory, 'assets', 'nested'), { recursive: true });
	await writeFile(
		join(rendererDirectory, 'server.html'),
		'<!doctype html><script src="./assets/nested/application.js"></script>',
	);
	await writeFile(
		join(rendererDirectory, 'assets', 'nested', 'application.js'),
		'const repeated = "terminay".repeat(30_000); console.log(repeated);',
	);
	await writeFile(
		join(rendererDirectory, 'assets', 'nested', 'style.css'),
		'.workspace { color: #34d399; }',
	);

	const report = await runServerUiArchiveBenchmark({ rendererDirectory });

	assert.equal(report.schemaVersion, 1);
	assert.equal(report.archive.requestCount, 1);
	assert.equal(report.archive.bodyEncoding, 'binary');
	assert.equal(report.archive.base64BodyBytes, 0);
	assert.equal(report.archive.entriesInstalled, 3);
	assert.equal(report.legacyPerFileBase64.bodyEncoding, 'base64');
	assert.equal(report.legacyPerFileBase64.requestCount, 4);
	assert.ok(report.legacyPerFileBase64.base64BodyBytes > 0);
	assert.ok(
		report.legacyPerFileBase64.totalWireBytes > report.archive.totalWireBytes,
	);
	assert.equal(typeof report.archive.installDurationMs, 'number');
	assert.equal(typeof report.legacyPerFileBase64.installDurationMs, 'number');
	assert.equal(report.archive.installSamplesMs.length, 7);
	assert.equal(report.legacyPerFileBase64.installSamplesMs.length, 7);
});
