import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

type McpConnection = {
	client: Client;
	close: () => Promise<void>;
};

type McpControlEnvironment = Readonly<{
	projectId: string;
	sessionId: string;
	socketPath: string;
	token: string;
}>;

async function activeSessionIds(page: Page): Promise<string[]> {
	return page
		.locator('.project-workspace--active .terminal-panel')
		.evaluateAll((panels) =>
			panels
				.map((panel) => panel.getAttribute('data-terminay-terminal-session-id'))
				.filter((sessionId): sessionId is string => Boolean(sessionId)),
		);
}

async function connectMcp(
	page: Page,
	sessionId: string,
	projectId: string,
): Promise<McpConnection> {
	const control = await page.evaluate(async (terminalSessionId) => {
		if (!window.terminayMcpControlTest) {
			throw new Error('The canonical MCP test seam is unavailable.');
		}
		return window.terminayMcpControlTest.getControlEnvironment(terminalSessionId);
	}, sessionId) as McpControlEnvironment;
	if (control.sessionId !== sessionId) {
		throw new Error(
			`Canonical MCP scope resolved ${control.sessionId} instead of ${sessionId}.`,
		);
	}
	if (control.projectId !== projectId) {
		throw new Error(
			`Canonical MCP scope resolved project ${control.projectId} instead of ${projectId}.`,
		);
	}

	const transport = new StdioClientTransport({
		command: process.execPath,
		// Desktop ships the selected server's MCP entrypoint. The retired
		// Electron renderer entrypoint no longer exists in the canonical graph.
		args: [path.resolve('dist-electron/serverMcpEntry.js')],
		env: {
			...process.env,
			TERMINAY_CONTROL_SOCKET: control.socketPath,
			TERMINAY_CONTROL_TOKEN: control.token,
		},
		stderr: 'pipe',
	});
	const client = new Client({ name: 'terminay-e2e', version: '1.0.0' });
	await client.connect(transport);

	return {
		client,
		close: () => client.close(),
	};
}

function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
	return result.content
		.filter((item) => item.type === 'text')
		.map((item) => item.text)
		.join('\n');
}

function toolResultJson(
	result: Awaited<ReturnType<Client['callTool']>>,
): unknown {
	const text = toolText(result);
	return JSON.parse(text.slice(text.indexOf('\n') + 1));
}

test('MCP callers see and control only terminals in their own project', async ({
	mainWindow,
}) => {
	await sendAppCommand(mainWindow, 'new-terminal');
	await expect(
		mainWindow.locator('.project-workspace--active .terminal-tab-content'),
	).toHaveCount(2);
	const projectASessions = await activeSessionIds(mainWindow);
	expect(projectASessions).toHaveLength(1);
	const projectAId = await mainWindow
		.locator('.app-shell')
		.getAttribute('data-terminay-active-project-id');
	if (projectAId === null) throw new Error('Project A identity is unavailable.');

	await mainWindow.getByLabel('Create project on This server').click();
	await expect(mainWindow.locator('.project-tab--active')).toContainText(
		'Project 2',
	);
	const activeProjectId = await mainWindow
		.locator('.project-tab--active')
		.getAttribute('data-project-id');
	await expect.poll(async () =>
		mainWindow.locator('.app-shell').getAttribute('data-terminay-active-project-id'),
	).toBe(activeProjectId);
	let projectBSession: string | undefined;
	await expect
		.poll(async () => {
			const session = (await activeSessionIds(mainWindow))[0];
			if (session !== undefined && session !== projectASessions[0]) {
				projectBSession = session;
				return true;
			}
			return false;
		})
		.toBe(true);
	if (projectBSession === undefined) throw new Error('Project B has no canonical terminal session.');
	const projectBSessions = [projectBSession];

	if (activeProjectId === null) throw new Error('Project B identity is unavailable.');
	const projectA = await connectMcp(mainWindow, projectASessions[0], projectAId);
	const projectB = await connectMcp(mainWindow, projectBSessions[0], activeProjectId);

	try {
		const listedA = await projectA.client.callTool({
			name: 'list_terminals',
			arguments: {},
		});
		const listedB = await projectB.client.callTool({
			name: 'list_terminals',
			arguments: {},
		});
		const textA = toolText(listedA);
		const textB = toolText(listedB);
		const resultA = toolResultJson(listedA) as {
			terminals: Array<{ id: string }>;
		};
		const resultB = toolResultJson(listedB) as {
			terminals: Array<{ id: string }>;
		};

		expect(resultA.terminals).toHaveLength(2);
		expect(resultB.terminals).toHaveLength(1);
		for (const sessionId of resultA.terminals.map((terminal) => terminal.id)) {
			expect(textA).toContain(sessionId);
			expect(textB).not.toContain(sessionId);
		}
		for (const sessionId of resultB.terminals.map((terminal) => terminal.id)) {
			expect(textB).toContain(sessionId);
			expect(textA).not.toContain(sessionId);
		}

		const crossProjectRead = await projectA.client.callTool({
			name: 'read_terminal',
			arguments: { terminal: projectBSessions[0] },
		});
		expect(crossProjectRead.isError).toBe(true);
		expect(toolText(crossProjectRead)).toContain('No terminal matches');

		const openedInA = await projectA.client.callTool({
			name: 'open_terminal',
			arguments: { name: 'MCP Project A' },
		});
		expect(openedInA.isError).toBe(false);

		await mainWindow
			.locator('.project-tab')
			.filter({ hasText: /^Project$/ })
			.click();
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-tab-content'),
		).toHaveCount(3);
		await mainWindow
			.locator('.project-tab')
			.filter({ hasText: 'Project 2' })
			.click();
		await expect(
			mainWindow.locator('.project-workspace--active .terminal-tab-content'),
		).toHaveCount(1);
	} finally {
		await Promise.all([projectA.close(), projectB.close()]);
	}
});
