import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import { activeTerminalPanel, createTerminal } from './support/terminal-session';

/**
 * MCP permission approvals end to end (ADR-0031). A stub script in a real
 * terminal sends MCP requests on that terminal's own control socket and
 * capability, framed exactly as the stdio adapter frames them. With the
 * default policy, managing automations asks inline in the terminal's pane,
 * and reading them does not.
 */

const MCP_SCRIPT = `
import { connect } from 'node:net';
const [op, name] = process.argv.slice(2);
const params =
	op === 'create_automation'
		? {
				name,
				trigger: { kind: 'schedule', cron: '0 9 * * 1-5' },
				action: { kind: 'runCommand', command: 'echo digest-' + name },
			}
		: {};
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({
		id: 'mcp-1',
		token: process.env.TERMINAY_CONTROL_TOKEN,
		version: 1,
		op,
		params,
	}) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	const outcome =
		op === 'get_mcp_capabilities' && response.ok
			? 'create_automation=' + response.result.tools.find((tool) => tool.tool === 'create_automation').permission
			: response.ok
				? 'ok'
				: response.error.code;
	console.log(['RESULT', op, name, outcome].filter(Boolean).join(' '));
	socket.end();
});
socket.on('error', (error) => {
	console.error(error.message);
	process.exit(2);
});
`;

/** Sends one operation with the parameters in a file, and reports its outcome
 * or, for capability discovery, the policy the server reports for sending. */
const NOTIFICATION_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, tag, paramsFile] = process.argv.slice(2);
const params = paramsFile ? JSON.parse(readFileSync(paramsFile, 'utf8')) : {};
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	const outcome = !response.ok
		? response.error.code
		: op === 'get_mcp_capabilities'
			? 'send_notification=' + response.result.tools.find((tool) => tool.tool === 'send_notification').permission
			: typeof response.result.notification === 'string'
				? 'handle'
				: 'ok';
	console.log(['RESULT', op, tag, outcome].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`;

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;

const strip = (page: Page): Locator =>
	page.locator('.project-workspace--active .terminal-mcp-approval:visible');

const rows = (page: Page): Locator =>
	page.locator('.project-workspace--active .terminal-panel:visible .xterm-rows');

async function automationNames(userDataDir: string): Promise<string[]> {
	try {
		const state = JSON.parse(
			await readFile(path.join(userDataDir, 'automations.v1.json'), 'utf8'),
		) as { automations: { name: string }[] };
		return state.automations.map((automation) => automation.name).sort();
	} catch {
		return [];
	}
}

test('managing automations over MCP asks inline in the calling terminal', async ({
	mainWindow,
	electronApp,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'mcp-approval-e2e.mjs');
	await writeFile(script, MCP_SCRIPT);
	const run = (op: string, name = '') =>
		submitTerminalCommand(
			mainWindow,
			`'${process.execPath}' '${script}' ${op} ${name}`,
			activeTerminalPanel(mainWindow),
		);

	await run('get_mcp_capabilities');
	await expect(rows(mainWindow)).toContainText(
		'RESULT get_mcp_capabilities create_automation=ask',
	);

	// Reading automations is Always Allow by default: no prompt.
	await run('list_automations');
	await expect(rows(mainWindow)).toContainText('RESULT list_automations ok');
	await expect(strip(mainWindow)).toHaveCount(0);

	// Creating one asks, naming the terminal and the action, with full details.
	await run('create_automation', 'Digest');
	await expect(strip(mainWindow)).toContainText(
		'in Terminal 1 wants to add the automation "Digest", which runs',
	);
	await expect(strip(mainWindow)).toContainText('Full Automation Management');
	// The terminal's tab asks for attention while the request waits.
	await expect(
		mainWindow.getByRole('img', { name: 'Waiting for your approval' }),
	).toBeVisible();
	await strip(mainWindow).getByRole('button', { name: 'Show details' }).click();
	await expect(strip(mainWindow)).toContainText('echo digest-Digest');
	await strip(mainWindow)
		.getByRole('button', { name: 'Allow One Time' })
		.click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT create_automation Digest ok',
	);
	await expect(strip(mainWindow)).toHaveCount(0);
	await expect.poll(() => automationNames(userDataDir)).toEqual(['Digest']);

	// Allow One Time grants nothing more; Decline refuses and changes nothing.
	await run('create_automation', 'Declined');
	await strip(mainWindow).getByRole('button', { name: 'Decline' }).click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT create_automation Declined permission_declined',
	);
	expect(await automationNames(userDataDir)).toEqual(['Digest']);

	// Allow This Session covers this terminal's later requests.
	await run('create_automation', 'Session');
	await strip(mainWindow)
		.getByRole('button', { name: 'Allow This Session' })
		.click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT create_automation Session ok',
	);
	await run('create_automation', 'Granted');
	await expect(rows(mainWindow)).toContainText(
		'RESULT create_automation Granted ok',
	);
	await expect(strip(mainWindow)).toHaveCount(0);
	await run('get_mcp_capabilities');
	await expect(rows(mainWindow)).toContainText(
		'RESULT get_mcp_capabilities create_automation=allow',
	);

	// Another terminal holds no grant, and the prompt works at phone width.
	await createTerminal(mainWindow);
	const nativeWindow = await electronApp.browserWindow(mainWindow);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, PHONE);
	await run('create_automation', 'Phone');
	await expect(strip(mainWindow)).toContainText(
		'wants to add the automation "Phone"',
	);
	await expect(strip(mainWindow)).toBeInViewport();
	await strip(mainWindow)
		.getByRole('button', { name: 'Allow One Time' })
		.click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT create_automation Phone ok',
	);
	await expect
		.poll(() => automationNames(userDataDir))
		.toEqual(['Digest', 'Granted', 'Phone', 'Session']);
});

test('Notifications is set from one window and governs sends asked for in another', async ({
	mainWindow,
	appHarness,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'mcp-notification-e2e.mjs');
	const params = path.join(userDataDir, 'mcp-notification-e2e.json');
	await writeFile(script, NOTIFICATION_SCRIPT);
	await writeFile(
		params,
		JSON.stringify({ title: 'Review ready', body: 'Three files changed' }),
	);
	const run = (op: string, tag: string, withParams = false) =>
		submitTerminalCommand(
			mainWindow,
			`'${process.execPath}' '${script}' ${op} ${tag}${withParams ? ` '${params}'` : ''}`,
			activeTerminalPanel(mainWindow),
		);

	// Always Allow on a fresh server: the send returns a handle and nothing asks.
	await run('get_mcp_capabilities', 'fresh');
	await expect(rows(mainWindow)).toContainText(
		'RESULT get_mcp_capabilities fresh send_notification=allow',
	);
	await run('send_notification', 'allowed', true);
	await expect(rows(mainWindow)).toContainText(
		'RESULT send_notification allowed handle',
	);
	await expect(strip(mainWindow)).toHaveCount(0);

	// --- Ask Permission, set in the Settings window, applies in this one ----
	const settings = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'terminay-mcp',
	});
	const policy = settings
		.locator('.settings-row', { hasText: 'Notifications' })
		.first()
		.locator('select');
	await expect(policy).toHaveValue('allow');
	await policy.selectOption('ask');
	await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
	await mainWindow.bringToFront();
	await run('get_mcp_capabilities', 'asking');
	await expect(rows(mainWindow)).toContainText(
		'RESULT get_mcp_capabilities asking send_notification=ask',
	);
	await run('send_notification', 'declined', true);
	await expect(strip(mainWindow)).toContainText(
		'wants to send a notification titled "Review ready": "Three files changed"',
	);
	await expect(strip(mainWindow)).toContainText('Notifications');
	await strip(mainWindow).getByRole('button', { name: 'Decline' }).click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT send_notification declined permission_declined',
	);
	await run('send_notification', 'once', true);
	await strip(mainWindow)
		.getByRole('button', { name: 'Allow One Time' })
		.click();
	await expect(rows(mainWindow)).toContainText(
		'RESULT send_notification once handle',
	);
	await expect(strip(mainWindow)).toHaveCount(0);

	// A Settings window opened afresh reads the same server-owned value.
	await settings.close();
	const reopened = await appHarness.openSettingsWindow({
		page: mainWindow,
		sectionId: 'terminay-mcp',
	});
	const reread = reopened
		.locator('.settings-row', { hasText: 'Notifications' })
		.first()
		.locator('select');
	await expect(reread).toHaveValue('ask');

	// --- Never Allow refuses without asking ---------------------------------
	await reread.selectOption('deny');
	await expect(reopened.getByText('Saved', { exact: true })).toBeVisible();
	await mainWindow.bringToFront();
	await run('send_notification', 'denied', true);
	await expect(rows(mainWindow)).toContainText(
		'RESULT send_notification denied permission_denied',
	);
	await expect(strip(mainWindow)).toHaveCount(0);
});
