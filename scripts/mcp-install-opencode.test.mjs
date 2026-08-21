import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	getOpenCodeConfigPath,
	inspectOpenCodeRegistration,
	installOpenCode,
	isOpenCodeInstalled,
	resolveOpenCodeConfigPath,
	uninstallOpenCode,
} = await importBundled('../electron/mcpInstall/openCode.ts');

const server = {
	command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
	args: [
		'/Applications/Terminay.app/Contents/Resources/app.asar.unpacked/dist-electron/serverMcpEntry.js',
	],
	env: { ELECTRON_RUN_AS_NODE: '1' },
};

const expectedEntry = {
	type: 'local',
	command: [server.command, ...server.args],
	environment: server.env,
};

test('OpenCode creates a stable mcp.terminay entry and preserves unrelated configuration', async () => {
	await withHome(async (home) => {
		const path = getOpenCodeConfigPath(home);
		await mkdir(join(home, '.config', 'opencode'), { recursive: true });
		await writeFile(
			path,
			`${JSON.stringify({ model: 'kept', mcp: { existing: { type: 'remote', url: 'https://example.test/mcp' } } }, null, 2)}\n`,
		);

		assert.deepEqual(await inspectOpenCodeRegistration(server, home), {
			state: 'not-installed',
		});
		assert.deepEqual(await installOpenCode(server, home), {
			ok: true,
			installed: true,
			message: `Registered terminay in ${path}`,
		});

		const installed = JSON.parse(await readFile(path, 'utf8'));
		assert.equal(installed.model, 'kept');
		assert.deepEqual(installed.mcp.existing, {
			type: 'remote',
			url: 'https://example.test/mcp',
		});
		assert.deepEqual(installed.mcp.terminay, expectedEntry);
		assert.deepEqual(await inspectOpenCodeRegistration(server, home), {
			state: 'installed',
		});
		assert.equal(await isOpenCodeInstalled(home), true);

		const content = await readFile(path, 'utf8');
		assert.deepEqual(await installOpenCode(server, home), {
			ok: true,
			installed: true,
			message: `terminay is already registered in ${path}`,
		});
		assert.equal(await readFile(path, 'utf8'), content);

		assert.deepEqual(await uninstallOpenCode(server, home), {
			ok: true,
			installed: false,
			message: `Removed terminay from ${path}`,
		});
		const removed = JSON.parse(await readFile(path, 'utf8'));
		assert.equal('terminay' in removed.mcp, false);
		assert.deepEqual(removed.mcp.existing, installed.mcp.existing);
	});
});

test('OpenCode omits environment when the Terminay launch contract has none', async () => {
	await withHome(async (home) => {
		const noEnvironment = { command: server.command, args: server.args };
		assert.equal((await installOpenCode(noEnvironment, home)).ok, true);
		const config = JSON.parse(
			await readFile(getOpenCodeConfigPath(home), 'utf8'),
		);
		assert.deepEqual(config.mcp.terminay, {
			type: 'local',
			command: [server.command, ...server.args],
		});
	});
});

test('OpenCode selects the sole .jsonc candidate but refuses JSONC syntax it cannot safely round-trip', async () => {
	await withHome(async (home) => {
		const directory = join(home, '.config', 'opencode');
		const jsoncPath = join(directory, 'opencode.jsonc');
		await mkdir(directory, { recursive: true });
		await writeFile(jsoncPath, '{"model":"kept"}\n');
		assert.equal(await resolveOpenCodeConfigPath(home), jsoncPath);
		assert.equal((await installOpenCode(server, home)).ok, true);
		assert.deepEqual(
			JSON.parse(await readFile(jsoncPath, 'utf8')).mcp.terminay,
			expectedEntry,
		);

		const unsafe = '{\n  // Keep this comment\n  "model": "kept"\n}\n';
		await writeFile(jsoncPath, unsafe);
		const inspection = await inspectOpenCodeRegistration(server, home);
		assert.equal(inspection.state, 'unavailable');
		assert.match(inspection.message, /JSONC that cannot safely round-trip/);
		const result = await installOpenCode(server, home);
		assert.equal(result.ok, false);
		assert.equal(await readFile(jsoncPath, 'utf8'), unsafe);
	});
});

test('OpenCode reports two user config candidates as unavailable without mutation', async () => {
	await withHome(async (home) => {
		const directory = join(home, '.config', 'opencode');
		const jsonPath = getOpenCodeConfigPath(home);
		const jsoncPath = join(directory, 'opencode.jsonc');
		await mkdir(directory, { recursive: true });
		await writeFile(jsonPath, '{"model":"json"}\n');
		await writeFile(jsoncPath, '{"model":"jsonc"}\n');

		assert.equal(await resolveOpenCodeConfigPath(home), jsonPath);
		const inspection = await inspectOpenCodeRegistration(server, home);
		assert.equal(inspection.state, 'unavailable');
		assert.match(
			inspection.message,
			/Both .*opencode\.json and .*opencode\.jsonc exist/,
		);
		const action = await installOpenCode(server, home);
		assert.equal(action.ok, false);
		assert.equal(await readFile(jsonPath, 'utf8'), '{"model":"json"}\n');
		assert.equal(await readFile(jsoncPath, 'utf8'), '{"model":"jsonc"}\n');
	});
});

test('OpenCode refuses replacement or removal of a changed registration', async () => {
	await withHome(async (home) => {
		const path = getOpenCodeConfigPath(home);
		await mkdir(join(home, '.config', 'opencode'), { recursive: true });
		const changed = `${JSON.stringify({ mcp: { terminay: { type: 'local', command: ['/user/terminay'] } } }, null, 2)}\n`;
		await writeFile(path, changed);

		assert.equal(
			(await inspectOpenCodeRegistration(server, home)).state,
			'changed',
		);
		for (const action of [
			installOpenCode(server, home),
			uninstallOpenCode(server, home),
		]) {
			const result = await action;
			assert.equal(result.ok, false);
			assert.equal(result.installed, true);
			assert.match(result.error, /has changed; review it before replacing it/);
			assert.equal(await readFile(path, 'utf8'), changed);
		}
	});
});

test('OpenCode refuses an existing V2 mcp.servers.terminay entry rather than creating a competing stable entry', async () => {
	await withHome(async (home) => {
		const path = getOpenCodeConfigPath(home);
		await mkdir(join(home, '.config', 'opencode'), { recursive: true });
		const legacy = `${JSON.stringify({ mcp: { servers: { terminay: expectedEntry } } }, null, 2)}\n`;
		await writeFile(path, legacy);

		const inspection = await inspectOpenCodeRegistration(server, home);
		assert.equal(inspection.state, 'unavailable');
		assert.match(
			inspection.message,
			/incompatible mcp\.servers\.terminay layout/,
		);
		for (const action of [
			installOpenCode(server, home),
			uninstallOpenCode(server, home),
		]) {
			const result = await action;
			assert.equal(result.ok, false);
			assert.equal(result.installed, true);
			assert.match(result.error, /incompatible mcp\.servers layout/);
			assert.equal(await readFile(path, 'utf8'), legacy);
		}
	});
});

async function withHome(run) {
	const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-opencode-'));
	try {
		await run(home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

async function importBundled(relativePath) {
	const tempDir = await mkdtemp(join(tmpdir(), 'terminay-mcp-install-bundle-'));
	const outputPath = join(tempDir, `${relativePath.split('/').pop()}.mjs`);
	await build({
		bundle: true,
		entryPoints: [new URL(relativePath, import.meta.url).pathname],
		format: 'esm',
		outfile: outputPath,
		platform: 'node',
		target: 'node20',
	});
	return import(outputPath);
}
