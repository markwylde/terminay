import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(
	join(process.cwd(), '.extension-manager-test-'),
);
const outfile = join(directory, 'extension-manager.cjs');
await build({
	entryPoints: ['src/components/ExtensionManager.tsx'],
	outfile,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { ExtensionManager, harnessSwitchKey, isHarnessEnabled } = require(
	outfile,
);
test.after(async () => {
	await rm(directory, { recursive: true, force: true });
});

const SOURCE = 'com.terminay.builtin-agents/agents';
const agentsExtension = {
	id: 'com.terminay.builtin-agents',
	packageName: 'terminay-builtin-agents',
	displayName: 'Built-in Agents',
	description: 'Agent status and Terminay MCP registration.',
	version: '1.0.0',
	state: 'installed',
	official: true,
	permissions: ['agent-observation', 'mcp-registration'],
	dependants: [],
	agentSessionSources: [
		{
			id: SOURCE,
			displayName: 'Agents',
			harnesses: [
				{ id: 'claude-code', displayName: 'Claude Code' },
				{ id: 'codex', displayName: 'Codex' },
				{ id: 'grok', displayName: 'Grok' },
				{ id: 'oh-my-pi', displayName: 'oh-my-pi' },
			],
		},
	],
};

function render(props) {
	return renderToStaticMarkup(
		React.createElement(ExtensionManager, {
			extensions: [agentsExtension],
			serverName: 'This Mac',
			revision: 1,
			onPreview: async () => {
				throw new Error('unused');
			},
			onPreviewPackageFile: async () => {
				throw new Error('unused');
			},
			onInstall: async () => {},
			onUpdate: async () => {},
			onAction: async () => {},
			...props,
		}),
	);
}

test('a session source extension card shows one switch per declared harness, on by default', () => {
	const markup = render({ onHarnessSwitchChange: () => {} });
	for (const harness of ['claude-code', 'codex', 'grok', 'oh-my-pi']) {
		assert.match(
			markup,
			new RegExp(`data-harness-switch="${SOURCE}/${harness}"`),
		);
	}
	assert.equal(markup.match(/aria-label="Report [^"]+ sessions"/g)?.length, 4);
	assert.equal(markup.match(/checked=""/g)?.length, 4);
});

test('a switched-off harness renders off and the others stay on', () => {
	const markup = render({
		harnessSwitches: { [`${SOURCE}/grok`]: false },
		onHarnessSwitchChange: () => {},
	});
	assert.equal(markup.match(/checked=""/g)?.length, 3);
	assert.match(
		markup,
		/data-harness-switch="com\.terminay\.builtin-agents\/agents\/grok"[\s\S]*?<input type="checkbox"\/>/,
	);
});

test('harness switch keys pair the source id with the harness id and default to on', () => {
	assert.equal(harnessSwitchKey(SOURCE, 'codex'), `${SOURCE}/codex`);
	assert.equal(isHarnessEnabled({}, SOURCE, 'codex'), true);
	assert.equal(
		isHarnessEnabled({ [`${SOURCE}/codex`]: false }, SOURCE, 'codex'),
		false,
	);
	assert.equal(
		isHarnessEnabled({ [`${SOURCE}/codex`]: true }, SOURCE, 'codex'),
		true,
	);
});

test('an extension without session sources renders no harness switches', () => {
	const markup = renderToStaticMarkup(
		React.createElement(ExtensionManager, {
			extensions: [
				{ ...agentsExtension, id: 'lang', agentSessionSources: undefined },
			],
			serverName: 'This Mac',
			revision: 1,
			onPreview: async () => ({}),
			onPreviewPackageFile: async () => ({}),
			onInstall: async () => {},
			onUpdate: async () => {},
			onAction: async () => {},
		}),
	);
	assert.doesNotMatch(markup, /data-harness-switch/);
});

test('settings keep only well-formed harness switches', async () => {
	const settingsOut = join(directory, 'terminal-settings.cjs');
	await build({
		entryPoints: ['src/terminalSettings.ts'],
		outfile: settingsOut,
		bundle: true,
		format: 'cjs',
		platform: 'node',
		loader: { '.css': 'empty' },
		logLevel: 'silent',
	});
	const { normalizeTerminalSettings, defaultTerminalSettings } =
		require(settingsOut);
	assert.deepEqual(defaultTerminalSettings.agentIntegration.harnesses, {});
	const normalized = normalizeTerminalSettings({
		agentIntegration: {
			enabled: true,
			harnesses: {
				[`${SOURCE}/grok`]: false,
				[`${SOURCE}/codex`]: true,
				'not a key': false,
				[`${SOURCE}/oh-my-pi`]: 'off',
			},
		},
	});
	assert.deepEqual(normalized.agentIntegration.harnesses, {
		[`${SOURCE}/grok`]: false,
		[`${SOURCE}/codex`]: true,
	});
	assert.deepEqual(
		normalizeTerminalSettings({ agentIntegration: { enabled: false } })
			.agentIntegration,
		{ enabled: false, harnesses: {} },
	);
});
