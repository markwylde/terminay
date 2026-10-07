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

test('showing a window asks with the window title and the App Windows group', () => {
	const markup = render([
		approval('apr_w', {
			operation: 'show_window',
			group: 'appWindows',
			groupLabel: 'App Windows',
			summary: 'show a window titled "Hello" in this terminal',
			details: [],
		}),
	]);
	assert.match(
		markup,
		/<strong>Claude Code<\/strong> in <strong>Terminal 1<\/strong> wants to show a window titled &quot;Hello&quot; in this terminal\./,
	);
	assert.match(markup, /App Windows/);
	for (const label of ['Allow One Time', 'Allow This Session', 'Decline'])
		assert.match(markup, new RegExp(`>${label}</button>`));
});

test('a window message asks naming the window, with the full text one tap away', () => {
	const markup = render([
		approval('apr_m', {
			operation: 'window_message',
			group: 'windowMessages',
			groupLabel: 'Window Messages',
			agent: 'The window "Deploy configurator"',
			summary: 'type a message into the terminal and send it',
			details: [{ label: 'Message', value: 'Deploy api to eu-west-1', code: true }],
		}),
	]);
	assert.match(
		markup,
		/<strong>The window &quot;Deploy configurator&quot;<\/strong> in <strong>Terminal 1<\/strong> wants to type a message into the terminal and send it\./,
	);
	assert.match(markup, /Window Messages/);
	assert.match(markup, /aria-expanded="false"[^>]*>Show details/);
	for (const label of ['Allow One Time', 'Allow This Session', 'Decline'])
		assert.match(markup, new RegExp(`>${label}</button>`));
});

test('a window message with files names each file and its size in its details', () => {
	const details = [
		{ label: 'Message', value: 'Here is the error', code: true },
		{ label: 'Attachment', value: 'screenshot.png (2.0 MiB)' },
		{ label: 'Attachment', value: 'trace.log (12 B)' },
	];
	const request = approval('apr_f', {
		operation: 'window_message',
		group: 'windowMessages',
		groupLabel: 'Window Messages',
		agent: 'The window "Bug report"',
		summary: 'type a message into the terminal and send it, with 2 files saved on this server',
		details,
	});
	const markup = render([request]);
	assert.match(markup, /wants to type a message into the terminal and send it, with 2 files saved on this server\./);
	assert.match(markup, /aria-expanded="false"[^>]*>Show details/);
	// Attachments alone are still something to show.
	const filesOnly = render([{ ...request, details: details.slice(1) }]);
	assert.match(filesOnly, />Show details/);
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
