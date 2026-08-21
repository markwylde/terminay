import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const preload = await readFile(
	new URL('../electron/serverUiPreload.ts', import.meta.url),
	'utf8',
);
const terminalAuthority = await readFile(
	new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
	'utf8',
);

test('application features have no renderer-owned Electron IPC backdoors', () => {
	const obsoleteChannels = [
		'desktop:connection-host:',
		'remote:get-status',
		'remote:toggle-server',
		'remote:revoke-device',
		'remote:close-connection',
		'remote:set-pairing-pin',
		'remote:get-pairing-pin-status',
		'remote:status-changed',
	];

	for (const channel of obsoleteChannels) {
		assert.doesNotMatch(
			main,
			new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
			channel,
		);
		assert.doesNotMatch(
			preload,
			new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
			channel,
		);
	}
});

test('obsolete renderer-owned profile and broadcast helpers stay deleted', () => {
	// `rememberRemoteConnection` is intentionally not listed here. It is a
	// main-process-only, atomic persistence helper for the sanitized Desktop
	// profile projection; it neither exposes renderer IPC nor retains pairing
	// credentials.
	for (const helper of [
		'connectRemoteServer',
		'openCanonicalRemoteServerWindow',
		'openCanonicalHttpRemoteServerWindow',
		'reconnectRememberedRemoteProfile',
		'saveRememberedRemoteConnections',
		'requireMutableDesktopConnectionProfile',
		'broadcastRemoteAccessStatus',
		'pendingRemoteConnectionWindowsByProfile',
	]) {
		assert.doesNotMatch(main, new RegExp(`\\b${helper}\\b`, 'u'), helper);
	}
});

test('canonical host routes retain server-owned application operations', () => {
	assert.match(main, /applicationFeatures:\s*\{/u);
	assert.match(main, /mcpInstall:\s*\{/u);
	assert.match(terminalAuthority, /'mcp-install\.status':/u);
	assert.match(terminalAuthority, /'mcp-install\.install':/u);
	assert.match(terminalAuthority, /'mcp-install\.uninstall':/u);
	assert.match(main, /remoteAccess:\s*\{/u);
	assert.match(
		main,
		/case 'route\.present':\s*await presentCanonicalAuxiliaryRoute/u,
	);
	assert.match(main, /presentCanonicalAuxiliaryRoute/u);
	assert.match(main, /prepareCanonicalHttpRemoteLaunch/u);
	assert.match(main, /loadRememberedRemoteConnections\(\)/u);
});

test('MCP install command validation accepts every supported provider', () => {
	for (const agent of ['claudeCode', 'codex', 'cursor', 'gemini', 'openCode']) {
		assert.match(
			terminalAuthority,
			new RegExp(`agent !== '${agent}'`, 'u'),
			agent,
		);
	}
});
