import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	DEFAULT_DIAGNOSTICS_PREFERENCES,
	diagnosticsPreferencesPath,
	readDiagnosticsPreferences,
	writeDiagnosticsPreferences,
} = await importBundled('../electron/diagnostics/preferences.ts');

test('diagnostics preferences default to performance logging Off', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-preferences-missing-'),
	);
	try {
		assert.deepEqual(readDiagnosticsPreferences(directory), {
			schemaVersion: 1,
			performanceLogging: false,
		});
		assert.deepEqual(
			DEFAULT_DIAGNOSTICS_PREFERENCES.performanceLogging,
			false,
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test('diagnostics preferences persist only the performance logging flag', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-preferences-write-'),
	);
	try {
		writeDiagnosticsPreferences(directory, {
			schemaVersion: 1,
			performanceLogging: true,
		});
		const path = diagnosticsPreferencesPath(directory);
		assert.match(await readFile(path, 'utf8'), /"performanceLogging":\s*true/u);
		assert.equal(readDiagnosticsPreferences(directory).performanceLogging, true);
		writeDiagnosticsPreferences(directory, {
			schemaVersion: 1,
			performanceLogging: false,
		});
		assert.equal(
			readDiagnosticsPreferences(directory).performanceLogging,
			false,
		);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test('hostile preference files cannot turn performance logging on', async () => {
	const directory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-preferences-hostile-'),
	);
	try {
		const { writeFile } = await import('node:fs/promises');
		await writeFile(
			diagnosticsPreferencesPath(directory),
			'{"performanceLogging":"true","path":"/Users/private"}',
			'utf8',
		);
		assert.deepEqual(readDiagnosticsPreferences(directory), {
			schemaVersion: 1,
			performanceLogging: false,
		});
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-diagnostics-preferences-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'preferences.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
