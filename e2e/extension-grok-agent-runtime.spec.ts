import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import { selectSidebarGroup } from './support/ui';

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
