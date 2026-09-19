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
	join(process.cwd(), '.mcp-install-modal-test-'),
);
const outfile = join(directory, 'mcp-install-modal.cjs');
await build({
	entryPoints: ['src/components/McpInstallModal.tsx'],
	outfile,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react', 'lucide-react'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});
const { McpInstallTargetList } = require(outfile);
test.after(async () => {
	await rm(directory, { recursive: true, force: true });
});

const target = (id, label, state, extra = {}) => ({
	id: `com.terminay.builtin-agents/${id}`,
	label,
	state,
	installed: state === 'installed',
	configPath: `/home/user/.${id}/config`,
	...extra,
});

function render(status, overrides = {}) {
	return renderToStaticMarkup(
		React.createElement(McpInstallTargetList, {
			status,
			busyTarget: null,
			rowErrors: {},
			onAction: () => {},
			...overrides,
		}),
	);
}

test('rows are keyed by extension target id in declaration order and show every state', () => {
	const markup = render({
		agents: [
			target('claude-code', 'Claude Code', 'installed'),
			target('codex', 'Codex', 'not-installed'),
			target('cursor', 'Cursor CLI', 'changed'),
			target('gemini', 'Gemini CLI', 'unavailable'),
			target('grok', 'Grok', 'error', { message: 'config is not valid TOML' }),
		],
	});
	const ids = [...markup.matchAll(/data-mcp-install-target="([^"]+)"/g)].map(
		(match) => match[1],
	);
	assert.deepEqual(ids, [
		'com.terminay.builtin-agents/claude-code',
		'com.terminay.builtin-agents/codex',
		'com.terminay.builtin-agents/cursor',
		'com.terminay.builtin-agents/gemini',
		'com.terminay.builtin-agents/grok',
	]);
	for (const label of [
		'Installed',
		'Not installed',
		'Changed — review config',
		'Unavailable',
		'Error',
	]) {
		assert.match(markup, new RegExp(`>${label}<`));
	}
	assert.match(markup, /config is not valid TOML/);
	assert.match(markup, /\/home\/user\/\.grok\/config/);
});

test('a busy target disables the other rows only', () => {
	const markup = render(
		{
			agents: [
				target('claude-code', 'Claude Code', 'installed'),
				target('codex', 'Codex', 'not-installed'),
			],
		},
		{ busyTarget: 'com.terminay.builtin-agents/codex' },
	);
	assert.match(markup, />Working…</);
	assert.equal(markup.match(/disabled=""/g)?.length, 2);
});

test('with no targets the list explains the agents extension is disabled and offers no install', () => {
	const markup = render({ agents: [] });
	assert.match(markup, /Built-in Agents extension/);
	assert.match(markup, /disabled or missing/);
	assert.doesNotMatch(markup, /<button/);
	assert.doesNotMatch(markup, /Install</);
});
