import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	createTerminal,
	terminalPanelForSession,
} from './support/terminal-session';
import { contextMenuItem } from './support/ui';

/**
 * An agent keeps Terminay MCP after its terminal moves to another project
 * (mcp-server: Capability token scope and lifecycle). The script runs inside
 * the real terminal and presents that terminal's own launch-environment
 * capability, exactly as the stdio adapter does, so it sees what an agent
 * already running in the shell would see.
 */

const MCP_SCRIPT = `
import { readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile, outFile] = process.argv.slice(2);
const params = JSON.parse(readFileSync(paramsFile, 'utf8'));
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	writeFileSync(outFile, buffer.slice(0, end));
	socket.end();
});
socket.on('error', (error) => {
	writeFileSync(outFile, JSON.stringify({ ok: false, error: { code: 'socket', message: error.message } }));
});
`;

type Response = {
	ok: boolean;
	result?: Record<string, unknown>;
	error?: { code: string; message: string };
};

/** An MCP caller bound to whichever terminal's capability runs the script. */
function mcpFrom(page: Page, userDataDir: string) {
	let sequence = 0;
	const script = path.join(userDataDir, 'mcp-move-e2e.mjs');
	let written = false;
	return async (
		panel: Locator,
		op: string,
		params: Record<string, unknown> = {},
	): Promise<Response> => {
		if (!written) {
			await writeFile(script, MCP_SCRIPT);
			written = true;
		}
		const n = ++sequence;
		const paramsFile = path.join(userDataDir, `mcp-move-${n}.json`);
		const outFile = path.join(userDataDir, `mcp-move-${n}.out`);
		await writeFile(paramsFile, JSON.stringify(params));
		await submitTerminalCommand(
			page,
			`'${process.execPath}' '${script}' ${op} '${paramsFile}' '${outFile}'`,
			panel,
		);
		await expect
			.poll(() => existsSync(outFile), { timeout: 30_000 })
			.toBe(true);
		return JSON.parse(await readFile(outFile, 'utf8')) as Response;
	};
}

test('an agent in a terminal moved to another project can still use Terminay MCP there', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(150_000);
	const mcp = mcpFrom(mainWindow, userDataDir);

	const stays = await activeTerminalSessionId(mainWindow);
	const moved = await createTerminal(mainWindow);
	const from = terminalPanelForSession(mainWindow, moved);

	const before = await mcp(from, 'list_terminals');
	expect(before.ok, JSON.stringify(before)).toBe(true);
	expect(JSON.stringify(before.result)).toContain(stays);

	await createStartedProject(mainWindow);
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	const there = await activeTerminalSessionId(mainWindow);

	await mainWindow
		.locator('.project-tab')
		.filter({ hasText: /^Project$/u })
		.click();
	expect(await activeTerminalSessionId(mainWindow)).toBe(moved);
	await mainWindow
		.locator('.project-workspace--active .terminal-tab-content')
		.last()
		.click({ button: 'right' });
	await contextMenuItem(mainWindow, 'Move to project').click();
	await contextMenuItem(mainWindow, 'Project 2').click();
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	expect(await activeTerminalSessionId(mainWindow)).toBe(moved);

	// The same shell, and so the same launch environment an agent inherited.
	const after = await mcp(from, 'list_terminals');
	expect(after.ok, JSON.stringify(after)).toBe(true);
	const listed = JSON.stringify(after.result);
	expect(listed).toContain(there);
	expect(listed).toContain(moved);
	expect(listed).not.toContain(stays);
});
