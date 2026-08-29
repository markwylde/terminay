import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect, nativeGrokSessionId, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { selectSidebarGroup } from './support/ui';

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

	await typeInVisibleTerminal(
		mainWindow,
		`grok --resume ${nativeGrokSessionId}\n`,
	);
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
		nativeGrokSessionId,
		'summary.json',
	);
	await writeFile(
		summary,
		`${JSON.stringify({
			info: { id: nativeGrokSessionId },
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
