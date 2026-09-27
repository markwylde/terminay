import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(process.cwd(), '.mcp-approval-strip-test-'));
const outfile = join(directory, 'mcp-approval-strip.cjs');
await build({
	entryPoints: ['src/components/McpApprovalStrip.tsx'],
	outfile,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react', '@terminay/client-core'],
	logLevel: 'silent',
});
const { McpApprovalStrip } = require(outfile);
test.after(async () => {
	await rm(directory, { recursive: true, force: true });
});

const approval = (id, overrides = {}) => ({
	id,
	terminalSessionId: 'session-1',
	projectId: 'project-1',
	operation: 'create_automation',
	group: 'automationsManage',
	groupLabel: 'Full Automation Management',
	agent: 'Claude Code',
	terminalTitle: 'Terminal 1',
	summary: 'add the automation "Email digest", which runs every 10 minutes',
	details: [{ label: 'Runs', value: 'mail-digest --to me', code: true }],
	createdAt: 1,
	...overrides,
});

function render(approvals) {
	return renderToStaticMarkup(
		React.createElement(McpApprovalStrip, {
			pending: { approvals, decide: async () => undefined },
		}),
	);
}

test('the strip names the agent, the terminal, and the action, with all three choices', () => {
	const markup = render([approval('apr_1')]);
	assert.match(markup, /role="alert"/);
	assert.match(markup, /data-mcp-approval-id="apr_1"/);
	assert.match(
		markup,
		/<strong>Claude Code<\/strong> in <strong>Terminal 1<\/strong> wants to add the automation &quot;Email digest&quot;, which runs every 10 minutes\./,
	);
	assert.match(markup, /Full Automation Management/);
	for (const label of ['Allow One Time', 'Allow This Session', 'Decline'])
		assert.match(markup, new RegExp(`>${label}</button>`));
	// Full details are one tap away, collapsed by default.
	assert.match(markup, /aria-expanded="false"[^>]*>Show details/);
	assert.doesNotMatch(markup, /mail-digest/);
});

test('queued requests show one at a time, oldest first', () => {
	const markup = render([
		approval('apr_1'),
		approval('apr_2', { summary: 'delete the automation "Old"' }),
		approval('apr_3', { summary: 'disable the automation "Nightly"' }),
	]);
	assert.match(markup, /data-mcp-approval-id="apr_1"/);
	assert.match(markup, /· 1 of 3/);
	assert.doesNotMatch(markup, /Old|Nightly/);
});

test('a request with no details offers no details toggle', () => {
	const markup = render([approval('apr_1', { details: [] })]);
	assert.doesNotMatch(markup, /Show details/);
});
