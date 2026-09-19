import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { validateExtensionManifest } from '@terminay/extension-api';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../fixtures/session-source');
const sdkRoot = resolve(here, '..');

test('independent third-party session source validates, packs, activates, and publishes', async (t) => {
	const manifest = JSON.parse(
		await readFile(join(packageRoot, 'package.json'), 'utf8'),
	);
	assert.equal(validateExtensionManifest(manifest.terminay).ok, true);

	const temporary = await mkdtemp(
		join(tmpdir(), 'terminay-third-party-source-'),
	);
	t.after(() => rm(temporary, { recursive: true, force: true }));
	await execFileAsync(
		'npm',
		['pack', '--ignore-scripts', '--pack-destination', temporary],
		{ cwd: packageRoot },
	);
	const archives = (await readdir(temporary)).filter((name) =>
		name.endsWith('.tgz'),
	);
	assert.equal(archives.length, 1);
	const archive = join(temporary, archives[0]);
	const { stdout: archiveListing } = await execFileAsync('tar', [
		'-tzf',
		archive,
	]);
	assert.match(archiveListing, /^package\/dist\/extension\.js$/m);
	assert.match(archiveListing, /^package\/README\.md$/m);

	const extracted = join(temporary, 'package');
	await mkdir(extracted, { recursive: true });
	await execFileAsync('tar', [
		'-xzf',
		archive,
		'-C',
		extracted,
		'--strip-components=1',
	]);
	await mkdir(join(extracted, 'node_modules', '@terminay'), {
		recursive: true,
	});
	await symlink(
		sdkRoot,
		join(extracted, 'node_modules', '@terminay', 'extension-api'),
		'dir',
	);

	const loaded = await import(
		pathToFileURL(join(extracted, 'dist', 'extension.js'))
	);
	const home = join(temporary, 'home');
	await mkdir(home);
	await writeFile(
		join(home, 'live.json'),
		JSON.stringify([
			{
				id: 'sess-1',
				pid: 101,
				cwd: '/work/app',
				title: 'Public fixture',
				status: 'running',
			},
		]),
	);
	process.env.FIXTURE_AGENT_HOME = home;
	t.after(() => {
		delete process.env.FIXTURE_AGENT_HOME;
	});

	const harness = await createAgentExtensionHarness(loaded.default, {
		manifest: manifest.terminay,
	});
	t.after(() => harness.dispose());
	await harness.start();
	assert.deepEqual(
		harness
			.sessions()
			.map((session) => [session.id, session.pid, session.title]),
		[['sess-1', 101, 'Public fixture']],
	);

	await writeFile(join(home, 'live.json'), JSON.stringify([]));
	await harness.waitFor((h) => h.sessions().length === 0);
	harness.assertConformant();
});
