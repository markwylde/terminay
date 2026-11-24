import assert from 'node:assert/strict';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const [cursor, antigravity] = await Promise.all([
	import('../dist/mcp/cursor.js'),
	import('../dist/mcp/antigravity.js'),
]);

const server = {
	command: '/Applications/Terminay.app/Contents/MacOS/Terminay',
	args: [
		'/Applications/Terminay.app/Contents/Resources/app.asar.unpacked/dist-electron/serverMcpEntry.js',
	],
	env: { ELECTRON_RUN_AS_NODE: '1' },
};

const providers = [
	{
		name: 'Cursor CLI',
		adapter: cursor,
		directory: '.cursor',
		filename: 'mcp.json',
		configPath: cursor.getCursorConfigPath,
		inspect: cursor.inspectCursorRegistration,
		install: cursor.installCursor,
		uninstall: cursor.uninstallCursor,
		isInstalled: cursor.isCursorInstalled,
		unrelated: {
			theme: 'dark',
			mcpServers: {
				existing: { command: '/usr/bin/existing', args: ['--kept'] },
			},
		},
	},
	{
		name: 'Antigravity CLI',
		adapter: antigravity,
		directory: join('.gemini', 'config'),
		filename: 'mcp_config.json',
		configPath: antigravity.getAntigravityConfigPath,
		inspect: antigravity.inspectAntigravityRegistration,
		install: antigravity.installAntigravity,
		uninstall: antigravity.uninstallAntigravity,
		isInstalled: antigravity.isAntigravityInstalled,
		unrelated: {
			version: 2,
			mcpServers: {
				existing: {
					command: '/usr/bin/existing',
					args: ['--kept'],
					disabled: true,
				},
				remote: { serverUrl: 'https://example.invalid/mcp' },
			},
		},
	},
];

for (const provider of providers) {
	test(`${provider.name} creates an absent user-level entry and preserves unrelated configuration`, async () => {
		const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'));
		const path = provider.configPath(home);
		try {
			assert.deepEqual(await provider.inspect(server, home), {
				state: 'not-installed',
			});
			assert.equal(await provider.isInstalled(home), false);

			const installed = await provider.install(server, home);
			assert.deepEqual(installed, {
				ok: true,
				installed: true,
				message: `Registered terminay in ${path}`,
			});
			const created = JSON.parse(await readFile(path, 'utf8'));
			assert.deepEqual(created, { mcpServers: { terminay: server } });
			assert.equal('trust' in created.mcpServers.terminay, false);
			assert.deepEqual(await provider.inspect(server, home), {
				state: 'installed',
			});
			assert.equal(await provider.isInstalled(home), true);

			await writeFile(path, `${JSON.stringify(provider.unrelated, null, 2)}\n`);
			const preserved = await provider.install(server, home);
			assert.equal(preserved.ok, true);
			const configured = JSON.parse(await readFile(path, 'utf8'));
			assert.deepEqual(
				configured.mcpServers.existing,
				provider.unrelated.mcpServers.existing,
			);
			assert.deepEqual(configured.mcpServers.terminay, server);
			for (const [key, value] of Object.entries(provider.unrelated)) {
				if (key !== 'mcpServers') assert.deepEqual(configured[key], value);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test(`${provider.name} exact entries are idempotent and uninstall removes only Terminay`, async () => {
		const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'));
		const path = provider.configPath(home);
		try {
			await mkdir(join(home, provider.directory), { recursive: true });
			await writeFile(
				path,
				`${JSON.stringify({ ...provider.unrelated, mcpServers: { ...provider.unrelated.mcpServers, terminay: server } }, null, 2)}\n`,
			);

			const before = await readFile(path, 'utf8');
			assert.deepEqual(await provider.install(server, home), {
				ok: true,
				installed: true,
				message: `terminay is already registered in ${path}`,
			});
			assert.equal(await readFile(path, 'utf8'), before);

			assert.deepEqual(await provider.uninstall(server, home), {
				ok: true,
				installed: false,
				message: `Removed terminay from ${path}`,
			});
			const removed = JSON.parse(await readFile(path, 'utf8'));
			assert.deepEqual(removed, provider.unrelated);
			assert.deepEqual(await provider.uninstall(server, home), {
				ok: true,
				installed: false,
				message: 'terminay was not registered',
			});
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test(`${provider.name} marks changed entries for review and never mutates them`, async () => {
		const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'));
		const path = provider.configPath(home);
		const changed = {
			...provider.unrelated,
			mcpServers: {
				...provider.unrelated.mcpServers,
				terminay: { command: '/user/changed-command', args: ['--custom'] },
			},
		};
		try {
			await mkdir(join(home, provider.directory), { recursive: true });
			const original = `${JSON.stringify(changed, null, 2)}\n`;
			await writeFile(path, original);

			assert.deepEqual(await provider.inspect(server, home), {
				state: 'changed',
				message:
					'The existing Terminay MCP entry differs from this version of Terminay.',
			});
			for (const action of [provider.install, provider.uninstall]) {
				const result = await action(server, home);
				assert.equal(result.ok, false);
				assert.equal(result.installed, true);
				assert.match(
					result.error,
					/has changed; review it before replacing it/,
				);
				assert.equal(await readFile(path, 'utf8'), original);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	test(`${provider.name} reports malformed or unsupported configuration as unavailable without rewriting it`, async () => {
		const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-provider-'));
		const path = provider.configPath(home);
		try {
			await mkdir(join(home, provider.directory), { recursive: true });
			for (const original of [
				'{ malformed',
				'[]',
				'"text"',
				'{"mcpServers":[]}',
				'{"mcpServers":"x"}',
			]) {
				await writeFile(path, original);
				const status = await provider.inspect(server, home);
				assert.equal(status.state, 'unavailable');
				assert.equal(await provider.isInstalled(home), false);
				const install = await provider.install(server, home);
				assert.equal(install.ok, false);
				assert.equal(install.installed, false);
				const uninstall = await provider.uninstall(server, home);
				assert.equal(uninstall.ok, false);
				assert.equal(uninstall.installed, false);
				assert.equal(await readFile(path, 'utf8'), original);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});
}

test('Antigravity CLI registers at ~/.gemini/config/mcp_config.json without a disabled flag', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-antigravity-'));
	try {
		const path = antigravity.getAntigravityConfigPath(home);
		assert.equal(path, join(home, '.gemini', 'config', 'mcp_config.json'));
		await antigravity.installAntigravity(server, home);
		const written = JSON.parse(await readFile(path, 'utf8'));
		assert.deepEqual(Object.keys(written.mcpServers.terminay).sort(), [
			'args',
			'command',
			'env',
		]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('Antigravity CLI parse diagnostics never include configuration secrets', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-antigravity-'));
	try {
		const path = antigravity.getAntigravityConfigPath(home);
		await mkdir(join(home, '.gemini', 'config'), { recursive: true });
		const original = '{"secret":"private-api-key", BROKEN}';
		await writeFile(path, original);
		for (const result of [
			await antigravity.inspectAntigravityRegistration(server, home),
			await antigravity.installAntigravity(server, home),
			await antigravity.uninstallAntigravity(server, home),
		]) {
			assert.match(result.message ?? result.error, /Could not parse/);
			assert.doesNotMatch(JSON.stringify(result), /private-api-key|BROKEN/);
		}
		assert.equal(await readFile(path, 'utf8'), original);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('Antigravity CLI treats a disabled flag as a changed entry that Replace clears and Uninstall removes', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-antigravity-'));
	const path = antigravity.getAntigravityConfigPath(home);
	try {
		await mkdir(join(home, '.gemini', 'config'), { recursive: true });
		for (const disabled of [true, false]) {
			const flagged = {
				mcpServers: {
					existing: { command: '/usr/bin/existing', args: [] },
					terminay: { ...server, disabled },
				},
			};
			const original = `${JSON.stringify(flagged, null, 2)}\n`;
			await writeFile(path, original);

			assert.equal(
				(await antigravity.inspectAntigravityRegistration(server, home)).state,
				'changed',
			);
			const install = await antigravity.installAntigravity(server, home);
			assert.equal(install.ok, false);
			assert.equal(await readFile(path, 'utf8'), original);

			const replaced = await antigravity.installAntigravity(server, home, {
				replace: true,
			});
			assert.equal(replaced.ok, true);
			const afterReplace = JSON.parse(await readFile(path, 'utf8'));
			assert.deepEqual(afterReplace.mcpServers.terminay, server);
			assert.deepEqual(
				afterReplace.mcpServers.existing,
				flagged.mcpServers.existing,
			);

			await writeFile(path, original);
			const removed = await antigravity.uninstallAntigravity(server, home);
			assert.equal(removed.ok, true);
			assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
				mcpServers: { existing: flagged.mcpServers.existing },
			});
		}
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test('Antigravity CLI leaves every other file under ~/.gemini untouched', async () => {
	const home = await mkdtemp(join(tmpdir(), 'terminay-mcp-antigravity-'));
	try {
		const settingsPath = join(home, '.gemini', 'settings.json');
		await mkdir(join(home, '.gemini'), { recursive: true });
		const settings = `${JSON.stringify(
			{ mcpServers: { terminay: { command: '/old/terminay', args: [] } } },
			null,
			2,
		)}\n`;
		await writeFile(settingsPath, settings);

		await antigravity.inspectAntigravityRegistration(server, home);
		await antigravity.installAntigravity(server, home);
		await antigravity.installAntigravity(server, home, { replace: true });
		await antigravity.uninstallAntigravity(server, home);

		assert.equal(await readFile(settingsPath, 'utf8'), settings);
		assert.deepEqual((await readdir(join(home, '.gemini'))).sort(), [
			'config',
			'settings.json',
		]);
		assert.deepEqual(await readdir(join(home, '.gemini', 'config')), [
			'mcp_config.json',
		]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
