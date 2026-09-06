import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import {
	openProjectEditWindow,
	selectSidebarGroup,
	setProjectRoot,
	submitEditWindow,
} from './support/ui';

async function nativeGrokSessionId(tempDir: string): Promise<string> {
	const root = path.join(
		tempDir,
		'native-grok-home',
		'sessions',
		'e2e-workspace',
	);
	const names = await readdir(root);
	const id = names.find((name) => /^[0-9a-f-]{36}$/iu.test(name));
	if (!id) {
		throw new Error(
			`native grok session missing in ${root}: ${names.join(',')}`,
		);
	}
	return id;
}

async function expectVisibleAgentCount(
	page: Parameters<typeof selectSidebarGroup>[0],
	count: number,
): Promise<void> {
	await selectSidebarGroup(page, 'agents');
	const workspace = page.locator('.project-workspace--active');
	if (count === 0) {
		await expect(workspace.locator('.agents-sidebar__empty')).toBeVisible({
			timeout: 15_000,
		});
		return;
	}
	await expect(workspace.locator('.agents-sidebar__tree-item')).toHaveCount(
		count,
		{ timeout: 15_000 },
	);
}

async function nameActiveProject(
	page: Parameters<typeof selectSidebarGroup>[0],
	name: string,
): Promise<void> {
	const editor = await openProjectEditWindow(page);
	await editor.getByPlaceholder('Project name').fill(name);
	await submitEditWindow(editor);
	await expect(page.locator('.project-tab--active')).toContainText(name);
}

async function activateNamedProject(
	page: Parameters<typeof selectSidebarGroup>[0],
	name: string,
): Promise<void> {
	const tab = page.locator('.project-tab').filter({ hasText: name });
	await tab.click();
	await expect(tab).toHaveClass(/project-tab--active/);
	const panel = page.locator(
		'.project-workspace--active .terminal-panel:visible',
	);
	await expect(panel).toBeVisible();
	await expect(panel).toHaveAttribute(
		'data-terminay-terminal-session-id',
		/.+/,
	);
}

/**
 * Stub Grok binary: prints canned "Grok e2e ready/resumed" and uses a
 * hardcoded session UUID. This is not Resume proof for the real Grok CLI.
 * Real restore coverage is the opt-in conformance harness
 * (`TERMINAY_CONFORMANCE_GROK=1`), which types `grok --continue`.
 */
test('a real process-bound Grok CLI appears, leaves, and returns to Agents on resume', async ({
	mainWindow,
	tempDir,
}) => {
	test.setTimeout(90_000);
	await typeInVisibleTerminal(mainWindow, 'grok\n');
	const terminal = mainWindow.locator('.terminal-panel:visible');
	await expect
		.poll(async () => await terminal.textContent(), { timeout: 15_000 })
		.toMatch(/Grok e2e ready/u);

	await selectSidebarGroup(mainWindow, 'agents');
	const root = mainWindow.locator('.agents-sidebar__tree-item');
	await expect(root).toBeVisible({ timeout: 15_000 });
	await expect(root.locator('.agents-sidebar__name')).toContainText('Grok', {
		timeout: 15_000,
	});
	await expect(root.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'idle',
	);

	await typeInVisibleTerminal(mainWindow, 'hi\n');
	await expect(root.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'working',
		{ timeout: 15_000 },
	);
	await expect(root.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'done',
		{ timeout: 15_000 },
	);
	await expect(root.locator('.agents-sidebar__name')).toContainText(
		'Native Grok chat',
		{ timeout: 15_000 },
	);
	await expect(root.locator('.agents-sidebar__metadata')).toContainText(
		/Grok.*grok-4\.6|grok-4\.6.*Grok/u,
	);

	await typeInVisibleTerminal(mainWindow, 'quit\n');
	await expect(root).toHaveCount(0, { timeout: 15_000 });
	await expect(mainWindow.locator('.agents-sidebar__empty')).toBeVisible();

	const sessionId = await nativeGrokSessionId(tempDir);
	await typeInVisibleTerminal(mainWindow, `grok --resume ${sessionId}\n`);
	await expect
		.poll(async () => await terminal.textContent(), { timeout: 15_000 })
		.toMatch(/Grok e2e resumed/u);
	await expect(root).toBeVisible({ timeout: 15_000 });
	await expect(root.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'done',
	);
	await expect(root.locator('.agents-sidebar__name')).toContainText(
		'Native Grok chat',
	);
	await expect(mainWindow.locator('.agents-sidebar__tree-item')).toHaveCount(1);
	await expect(mainWindow.locator('.agents-sidebar__empty')).toHaveCount(0);

	const summary = path.join(
		tempDir,
		'native-grok-home',
		'sessions',
		'e2e-workspace',
		sessionId,
		'summary.json',
	);
	await writeFile(
		summary,
		`${JSON.stringify({
			info: { id: sessionId },
			generated_title: 'Renamed native Grok session',
			session_summary: 'Renamed native Grok session',
			current_model_id: 'grok-4.6',
		})}\n`,
		{ mode: 0o600 },
	);
	await expect(root.locator('.agents-sidebar__name')).toContainText(
		'Renamed native Grok session',
		{ timeout: 15_000 },
	);
	await expect(root.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'done',
	);
});

test('two projects each keep a live Grok agent, including after a later turn and resume', async ({
	mainWindow,
	createWorkspace,
	tempDir,
}) => {
	test.setTimeout(120_000);
	const books = await createWorkspace({ name: 'books' });
	const other = await createWorkspace({ name: 'terminay' });
	await setProjectRoot(mainWindow, books.rootDir);
	await nameActiveProject(mainWindow, 'Books');
	await typeInVisibleTerminal(mainWindow, 'grok\n');
	await expect
		.poll(
			async () =>
				await mainWindow.locator('.terminal-panel:visible').textContent(),
			{ timeout: 15_000 },
		)
		.toMatch(/Grok e2e ready/u);
	await expectVisibleAgentCount(mainWindow, 1);
	const booksSessionId = await nativeGrokSessionId(tempDir);

	await mainWindow.getByLabel('Create project on This server').click();
	await expect(mainWindow.locator('.project-tab')).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	await setProjectRoot(mainWindow, other.rootDir);
	await nameActiveProject(mainWindow, 'Terminay');
	await typeInVisibleTerminal(mainWindow, 'grok\n');
	await expect
		.poll(
			async () =>
				await mainWindow.locator('.terminal-panel:visible').textContent(),
			{ timeout: 15_000 },
		)
		.toMatch(/Grok e2e ready/u);
	await expectVisibleAgentCount(mainWindow, 1);

	await activateNamedProject(mainWindow, 'Books');
	await expect
		.poll(
			async () =>
				await mainWindow.locator('.terminal-panel:visible').textContent(),
			{ timeout: 15_000 },
		)
		.toMatch(/Grok e2e ready/u);
	await expectVisibleAgentCount(mainWindow, 1);
	const booksRoot = mainWindow.locator(
		'.project-workspace--active .agents-sidebar__tree-item',
	);
	await typeInVisibleTerminal(mainWindow, 'hi\n');
	await expect(booksRoot.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'done',
		{ timeout: 15_000 },
	);
	await typeInVisibleTerminal(mainWindow, 'again\n');
	await expect(booksRoot.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'working',
		{ timeout: 15_000 },
	);
	await expect(booksRoot.locator('.agents-sidebar__row')).toHaveAttribute(
		'data-agent-state',
		'done',
		{ timeout: 15_000 },
	);

	await typeInVisibleTerminal(mainWindow, 'quit\n');
	await expectVisibleAgentCount(mainWindow, 0);
	await typeInVisibleTerminal(mainWindow, `grok --resume ${booksSessionId}\n`);
	await expect
		.poll(
			async () =>
				await mainWindow.locator('.terminal-panel:visible').textContent(),
			{ timeout: 15_000 },
		)
		.toMatch(/Grok e2e resumed/u);
	await expectVisibleAgentCount(mainWindow, 1);

	await activateNamedProject(mainWindow, 'Terminay');
	await expect
		.poll(
			async () =>
				await mainWindow.locator('.terminal-panel:visible').textContent(),
			{ timeout: 15_000 },
		)
		.toMatch(/Grok e2e ready/u);
	await expectVisibleAgentCount(mainWindow, 1);
});
