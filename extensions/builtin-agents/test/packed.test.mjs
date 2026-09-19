import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createClaudeFixtureDriver } from '@markwylde/all-your-agents/testing';
import { validateExtensionManifest } from '@terminay/extension-api';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
/** Both packages' main entry is `dist/index.js`. */
const packageDirectory = (name) =>
	dirname(dirname(fileURLToPath(import.meta.resolve(name))));

async function packAndExtract(t) {
	const temporary = await mkdtemp(
		join(tmpdir(), 'terminay-builtin-agents-pack-'),
	);
	t.after(() => rm(temporary, { recursive: true, force: true }));
	await execFileAsync(
		'npm',
		['pack', '--ignore-scripts', '--pack-destination', temporary],
		{ cwd: packageRoot },
	);
	const [archive] = (await readdir(temporary)).filter((name) =>
		name.endsWith('.tgz'),
	);
	const { stdout: listing } = await execFileAsync('tar', [
		'-tzf',
		join(temporary, archive),
	]);
	const extracted = join(temporary, 'package');
	await mkdir(extracted);
	await execFileAsync('tar', [
		'-xzf',
		join(temporary, archive),
		'-C',
		extracted,
		'--strip-components=1',
	]);
	// Resolve the SDK and the library as the staged built-in does: beside the package.
	await mkdir(join(extracted, 'node_modules', '@terminay'), {
		recursive: true,
	});
	await mkdir(join(extracted, 'node_modules', '@markwylde'), {
		recursive: true,
	});
	await symlink(
		packageDirectory('@terminay/extension-api'),
		join(extracted, 'node_modules', '@terminay', 'extension-api'),
		'dir',
	);
	await symlink(
		packageDirectory('@markwylde/all-your-agents'),
		join(extracted, 'node_modules', '@markwylde', 'all-your-agents'),
		'dir',
	);
	return { listing, extracted, temporary };
}

test('the packed tarball ships compiled code only and a valid manifest', async (t) => {
	const { listing, extracted } = await packAndExtract(t);
	assert.match(listing, /^package\/dist\/index\.js$/mu);
	assert.match(listing, /^package\/dist\/source\.js$/mu);
	assert.match(listing, /^package\/dist\/mcp\/targets\.js$/mu);
	assert.match(listing, /^package\/README\.md$/mu);
	assert.match(listing, /^package\/LICENSE$/mu);
	assert.doesNotMatch(listing, /package\/(src|test)\//u);

	const packageJson = JSON.parse(
		await readFile(join(extracted, 'package.json'), 'utf8'),
	);
	assert.equal(validateExtensionManifest(packageJson.terminay).ok, true);
	assert.equal(
		packageJson.dependencies['@markwylde/all-your-agents'],
		'1.4.0',
		'the library is pinned exactly',
	);
	const { stdout } = await execFileAsync(process.execPath, [
		join(packageDirectory('@terminay/extension-api'), 'dist', 'conformance.js'),
		join(extracted, 'package.json'),
	]);
	assert.match(
		stdout,
		/Valid Terminay extension: com\.terminay\.builtin-agents/u,
	);
});

test('the packed extension activates and reports a real process until it exits', async (t) => {
	const { extracted, temporary } = await packAndExtract(t);
	const manifest = JSON.parse(
		await readFile(join(extracted, 'package.json'), 'utf8'),
	).terminay;
	const home = join(temporary, 'claude-home');
	const previous = process.env.CLAUDE_CONFIG_DIR;
	process.env.CLAUDE_CONFIG_DIR = home;
	t.after(() => {
		if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = previous;
	});

	// A real process stands in for the agent, so liveness and exit come from the OS.
	const agent = spawn(
		process.execPath,
		['-e', 'setTimeout(() => {}, 60_000)'],
		{ stdio: 'ignore' },
	);
	t.after(() => agent.kill('SIGKILL'));
	const driver = createClaudeFixtureDriver(home, Date.now());
	const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
	await driver.createLiveSession({
		id,
		pid: agent.pid,
		cwd: '/work/app',
		status: 'busy',
	});

	const loaded = await import(
		pathToFileURL(join(extracted, 'dist', 'index.js'))
	);
	const harness = await createAgentExtensionHarness(loaded.default, {
		manifest,
	});
	t.after(() => harness.dispose());
	await harness.start();
	await harness.waitFor((h) =>
		h.sessions().some((session) => session.id === id),
	);
	assert.deepEqual(
		harness
			.sessions()
			.map((session) => [session.harness, session.pid, session.status]),
		[['claude-code', agent.pid, 'running']],
	);

	const degraded = harness
		.diagnostics()
		.some((diagnostic) => diagnostic.code === 'process-watch-degraded');
	agent.kill('SIGKILL');
	if (degraded) {
		// Without the native watch the library notices on the next change to its index.
		await driver.remove(id);
	}
	await harness.waitFor((h) => h.sessions().length === 0, 10_000);
	harness.assertConformant();
});
