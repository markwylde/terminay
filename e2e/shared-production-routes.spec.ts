import { expect, test } from '@playwright/test';
import {
	type SharedWebShellFixture,
	startSharedWebShellFixture,
} from './support/shared-web-shell-fixture';

let fixture: SharedWebShellFixture;
test.beforeAll(async () => {
	fixture = await startSharedWebShellFixture();
});
test.afterAll(async () => {
	await fixture.close();
});

test('locally emulated touch-mobile Chromium saves and resets terminal settings', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	const settings = page
		.locator('[data-shared-route-body="settings"]')
		.filter({ hasText: 'Mobile workflow' });
	await settings.getByLabel('Search Mobile workflow settings').fill('terminal');
	await settings.getByRole('button', { name: 'Appearance', exact: true }).tap();
	await settings.getByRole('button', { name: 'Terminal', exact: true }).tap();
	await settings.getByLabel('Terminal font size').fill('18');
	await expect(settings.locator('.settings-status')).toHaveText('Not saved');
	await settings.getByRole('button', { name: 'Save terminal settings' }).tap();
	await expect(settings.locator('.settings-status')).toHaveText('Saved');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileSettingsActions: string[] })
						.__mobileSettingsActions,
			),
		)
		.toEqual(['save:18']);
	await settings.getByRole('button', { name: 'Reset to defaults' }).tap();
	await expect(settings.getByLabel('Terminal font size')).toHaveValue('14');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileSettingsActions: string[] })
						.__mobileSettingsActions,
			),
		)
		.toEqual(['save:18', 'reset']);
	await context.close();
});

test('locally emulated touch-mobile Chromium creates, edits, deletes, and resets macros', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(
			window as unknown as { __mobileMacroActions: string[] }
		).__mobileMacroActions.length = 0;
	});
	const library = page.getByRole('complementary', {
		name: 'Mobile macro library',
	});
	const editor = page.getByRole('region', { name: 'Mobile macro editor' });
	await editor.getByRole('button', { name: 'Create macro' }).tap();
	await expect(library).toContainText('Mobile macro');
	await editor.getByRole('button', { name: 'Edit macro' }).tap();
	await expect(library).toContainText('Edited mobile macro');
	await editor.getByRole('button', { name: 'Delete macro' }).tap();
	await expect(library).not.toContainText('Edited mobile macro');
	await editor.getByRole('button', { name: 'Reset macros' }).tap();
	await expect(library).toContainText('Default macro');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileMacroActions: string[] })
						.__mobileMacroActions,
			),
		)
		.toEqual([
			'macros.upsert',
			'macros.upsert',
			'macros.remove',
			'macros.reset',
		]);
	await expect
		.poll(() =>
			editor.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		)
		.toBe(true);
	await context.close();
});

test('locally emulated touch-mobile Chromium observes restart and recovers its server connection', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(
			window as unknown as { __mobileLifecycleActions: string[] }
		).__mobileLifecycleActions.length = 0;
	});
	const lifecycle = page.getByRole('region', {
		name: 'Mobile server lifecycle',
	});
	const profile = lifecycle.getByRole('option', {
		name: /Mobile lifecycle server/u,
	});
	await expect(profile).toContainText('connected');
	await lifecycle.getByRole('button', { name: 'Detect server restart' }).tap();
	await expect(profile).toContainText('offline');
	await lifecycle.getByRole('button', { name: 'Retry connection' }).tap();
	await expect(profile).toContainText('connecting');
	await expect(profile).toContainText('connected');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileLifecycleActions: string[] })
						.__mobileLifecycleActions,
			),
		)
		.toEqual(['restart-detected', 'retry', 'recovered']);
	await expect
		.poll(() =>
			lifecycle.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		)
		.toBe(true);
	await context.close();
});

test('locally emulated touch-mobile Chromium opens a server-owned file entry', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	const files = page.locator('[data-shared-route-body="folder"]').last();
	const readme = files.getByRole('treeitem', { name: /README\.md/u });
	await expect(readme).toContainText('42 bytes');
	await readme.tap();
	await expect(readme).toHaveAttribute('aria-selected', 'true');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileFileActions: string[] })
						.__mobileFileActions,
			),
		)
		.toEqual(['open:README.md']);
	await context.close();
});

test('locally emulated touch-mobile Chromium edits, saves, conflicts, and selects bounded file modes', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	const viewer = page.getByRole('region', {
		name: 'Mobile file viewer workflow',
	});

	await viewer.getByRole('button', { name: 'Open README' }).tap();
	await expect(viewer.getByLabel('File text')).toHaveValue('# Mobile file\n');
	await viewer.getByLabel('File text').fill('# Saved on touch\n');
	await expect(viewer.getByLabel('Mobile file status')).toHaveText(
		'Unsaved changes',
	);
	await viewer.getByRole('button', { name: 'Save file' }).tap();
	await expect(viewer.getByLabel('Mobile file status')).toHaveText('Synced');

	await viewer
		.getByRole('button', { name: 'Simulate external conflict' })
		.tap();
	await viewer.getByLabel('File text').fill('# Conflicting draft\n');
	await viewer.getByRole('button', { name: 'Save file' }).tap();
	await expect(viewer.getByLabel('Mobile file status')).toHaveText(
		'Conflict: external revision',
	);

	await viewer.getByRole('button', { name: 'Open large file' }).tap();
	await expect(viewer.getByLabel('Large file mode')).toHaveText(
		'Performant ranged text',
	);
	await viewer.getByRole('button', { name: 'Open binary file' }).tap();
	await expect(viewer.getByLabel('Binary file mode')).toHaveText(
		'HEX 00 FF 80 41',
	);
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileFileActions: string[] })
						.__mobileFileActions,
			),
		)
		.toEqual([
			'query:files.open',
			'query:files.read-text',
			'command:files.edit',
			'command:files.save',
			'command:files.edit',
			'command:files.save',
			'query:files.content-capabilities',
			'query:files.content-capabilities',
			'query:files.content-hex',
		]);
	await context.close();
});

test('locally emulated touch-mobile Chromium drives a terminal session lifecycle', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(
			window as unknown as { __terminalActions: string[] }
		).__terminalActions.length = 0;
	});
	const terminal = page.locator('[data-shared-route-body="terminal"]').last();
	await terminal.getByRole('button', { name: 'New terminal' }).tap();
	await expect(terminal.getByRole('log')).toContainText('replayed output');
	await terminal.getByLabel('Terminal input').fill('echo mobile-touch\n');
	await terminal.getByRole('button', { name: 'Send input' }).tap();
	await terminal.getByRole('button', { name: 'Resize terminal' }).tap();
	await terminal.getByRole('button', { name: 'Detach terminal' }).tap();
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __terminalActions: string[] })
						.__terminalActions,
			),
		)
		.toEqual([
			'create',
			'attach',
			'write:echo mobile-touch',
			'resize:100x30',
			'detach',
		]);
	await context.close();
});

test('locally emulated touch-mobile Chromium completes the browser Git workflow', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(window as unknown as { __gitActions: string[] }).__gitActions.length = 0;
	});
	const git = page.locator('[data-shared-route-body="git"]').last();
	await expect(git.getByRole('list', { name: 'Git worktrees' })).toContainText(
		'main',
	);
	await expect(git).toContainText('1 changed files');
	await git.getByRole('button', { name: 'Pull' }).tap();
	await expect(git.getByText('Worktree updated.')).toBeVisible();

	await git.getByRole('button', { name: 'Rename presentation' }).tap();
	const rename = git.getByRole('form', {
		name: 'Rename worktree presentation',
	});
	await rename.getByLabel('Presentation name').fill('Mobile worktree');
	await rename.getByRole('button', { name: 'Save presentation name' }).tap();
	await expect(git.getByText('Worktree presentation renamed.')).toBeVisible();

	await git.getByRole('button', { name: 'Prepare Quick Push' }).tap();
	await expect(
		git.getByRole('region', { name: 'Quick Push confirmation' }),
	).toContainText('2 server-planned actions');
	await git.getByRole('button', { name: 'Approve Quick Push' }).tap();
	await expect(git.getByText('Quick Push completed.')).toBeVisible();

	await git.getByRole('button', { name: 'Remove worktree' }).tap();
	await expect(
		git.getByRole('region', { name: 'Confirm worktree removal' }),
	).toBeVisible();
	await git.getByRole('button', { name: 'Confirm removal' }).tap();
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { __gitActions: string[] }).__gitActions,
			),
		)
		.toEqual(['pull', 'rename', 'propose', 'approve', 'remove']);
	await expect
		.poll(() =>
			git.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
		)
		.toBe(true);
	await context.close();
});

test('locally emulated touch-mobile Chromium selects, replays, and deletes a recording', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(
			window as unknown as { __mobileRecordingActions: string[] }
		).__mobileRecordingActions.length = 0;
	});
	const library = page.getByRole('complementary', {
		name: 'Mobile recordings library',
	});
	await library.getByRole('button', { name: 'Mobile recording' }).tap();
	const detail = page.getByRole('region', {
		name: 'Mobile recording detail',
	});
	await expect(detail).toContainText('2 events');
	await detail.getByRole('button', { name: 'Replay' }).tap();
	await expect(detail.getByLabel('Replay output')).toHaveText(
		'mobile replay text',
	);
	await detail.getByRole('button', { name: 'Delete' }).tap();
	await expect(library).toContainText('No recordings yet.');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileRecordingActions: string[] })
						.__mobileRecordingActions,
			),
		)
		.toEqual(['recordings.replay', 'recordings.delete', 'recordings.list']);
	await expect
		.poll(() =>
			library.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		)
		.toBe(true);
	await context.close();
});

test('locally emulated touch-mobile Chromium creates, selects, moves, and closes workspace objects', async ({
	browser,
}) => {
	const context = await browser.newContext({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 820 },
	});
	const page = await context.newPage();
	await page.goto(
		`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
	);
	await page.evaluate(() => {
		(
			window as unknown as { __mobileWorkspaceActions: string[] }
		).__mobileWorkspaceActions.length = 0;
	});
	const workspace = page.getByRole('region', {
		name: 'Mobile workspace workflow',
	});
	await workspace.getByRole('button', { name: 'Create project' }).tap();
	await workspace.getByRole('button', { name: 'Mobile project' }).tap();
	await workspace.getByRole('button', { name: 'Create panel' }).tap();
	await workspace.getByRole('button', { name: 'README.md' }).tap();
	await workspace.getByRole('button', { name: 'Move panel' }).tap();
	await workspace.getByRole('button', { name: 'Close panel' }).tap();
	await expect(workspace).toContainText('Panel closed.');
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					(window as unknown as { __mobileWorkspaceActions: string[] })
						.__mobileWorkspaceActions,
			),
		)
		.toEqual([
			'project.create',
			'project.select',
			'panel.create',
			'panel.activate',
			'panel.move',
			'panel.close',
		]);
	await expect
		.poll(() =>
			workspace.evaluate(
				(element) => element.scrollWidth <= element.clientWidth + 1,
			),
		)
		.toBe(true);
	await context.close();
});

for (const viewport of [
	{ name: 'wide', width: 1280, height: 900 },
	{ name: 'medium', width: 900, height: 900 },
	{ name: 'mobile', width: 390, height: 820 },
] as const) {
	test(`shared production route bodies preserve real states without overflow at ${viewport.name}`, async ({
		page,
	}) => {
		await page.setViewportSize(viewport);
		await page.goto(
			`${fixture.origin}/e2e/fixtures/shared-production-routes.html`,
		);
		const connections = page
			.locator('[data-shared-route-body="connections"]')
			.first();
		await expect(
			connections.getByRole('listbox', { name: 'Saved Terminay servers' }),
		).toBeVisible();
		await expect(
			connections.getByRole('option', { name: /Local connected/u }),
		).toHaveAttribute('aria-selected', 'true');
		await page.evaluate(() => {
			(
				window as unknown as { __connectionActions: string[] }
			).__connectionActions.length = 0;
		});
		await connections.getByRole('button', { name: 'Expose server' }).click();
		await connections.getByRole('button', { name: 'Add connection…' }).click();
		const pairing = connections.getByRole('form', { name: 'Add connection' });
		await pairing
			.getByLabel('Pairing URL')
			.fill('https://terminay.example/pair#one-time-secret');
		await pairing.getByLabel('Pairing PIN').fill('123456');
		await pairing.getByRole('button', { name: 'Continue pairing' }).click();
		await expect(connections.getByRole('status')).toContainText(
			'Opening pairing…',
		);
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __connectionActions: string[] })
							.__connectionActions,
				),
			)
			.toEqual(['expose:local', 'pair']);
		const git = page.locator('[data-shared-route-body="git"]').first();
		await expect(git.getByRole('status')).toHaveText(
			'Git is unavailable on this server.',
		);
		await expect(page.getByText('Loading connections…')).toHaveAttribute(
			'aria-busy',
			'true',
		);
		await expect(
			page.getByText('No saved servers are available.').first(),
		).toBeVisible();
		for (const state of [
			'Empty',
			'Disconnected',
			'Unreachable',
			'Expired',
			'Revoked',
			'Already connected',
		] as const) {
			const stateRegion = page.getByRole('region', {
				name: `${state} Connections state`,
			});
			const addConnection = stateRegion.getByRole('button', {
				name: 'Add connection…',
			});
			await expect(addConnection).toBeVisible();
			await addConnection.focus();
			await page.keyboard.press('Enter');
			const addForm = stateRegion.getByRole('form', {
				name: 'Add connection',
			});
			await expect(addForm.getByLabel('Pairing URL')).toBeEditable();
			await addForm.getByLabel('Pairing URL').fill(
				`https://${state.toLowerCase().replaceAll(' ', '-')}.example/#pairingToken=${'a'.repeat(32)}`,
			);
			await addForm.getByRole('button', { name: 'Cancel' }).click();
		}
		await expect(
			page.getByText('Connection management is unavailable in this host.'),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Connection profiles failed' }),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Repository status failed' }),
		).toBeVisible();
		await expect(
			page.getByText('Select a server project to view Git status.'),
		).toBeVisible();
		const gitWorktrees = page.locator('[data-shared-route-body="git"]').last();
		await expect(
			gitWorktrees.getByRole('list', { name: 'Git worktrees' }),
		).toContainText('main');
		await expect(gitWorktrees).toContainText('1 changed files');
		await expect(gitWorktrees).toContainText(
			'Additional worktrees were omitted by the server limit.',
		);
		await page.evaluate(() => {
			(window as unknown as { __gitActions: string[] }).__gitActions.length = 0;
		});
		await gitWorktrees.getByRole('button', { name: 'Pull' }).click();
		await expect(gitWorktrees.getByText('Worktree updated.')).toBeVisible();
		await gitWorktrees
			.getByRole('button', { name: 'Rename presentation' })
			.click();
		const renameWorktree = gitWorktrees.getByRole('form', {
			name: 'Rename worktree presentation',
		});
		await renameWorktree
			.getByLabel('Presentation name')
			.fill('Primary worktree');
		await renameWorktree
			.getByRole('button', { name: 'Save presentation name' })
			.click();
		await expect(
			gitWorktrees.getByText('Worktree presentation renamed.'),
		).toBeVisible();
		await gitWorktrees.getByRole('button', { name: 'Open terminal' }).click();
		await expect(gitWorktrees.getByText('Terminal opened.')).toBeVisible();
		await gitWorktrees.getByRole('button', { name: 'Switch project' }).click();
		await expect(gitWorktrees.getByText('Project switched.')).toBeVisible();
		await gitWorktrees.getByRole('button', { name: 'Reveal worktree' }).click();
		await expect(gitWorktrees.getByText('Worktree revealed.')).toBeVisible();
		await gitWorktrees
			.getByRole('button', { name: 'Copy worktree path' })
			.click();
		await expect(gitWorktrees.getByText('Worktree path copied.')).toBeVisible();
		await gitWorktrees
			.getByRole('button', { name: 'Prepare Quick Push' })
			.click();
		await expect(
			gitWorktrees.getByRole('region', { name: 'Quick Push confirmation' }),
		).toContainText('2 server-planned actions');
		await gitWorktrees
			.getByRole('button', { name: 'Approve Quick Push' })
			.click();
		await expect(gitWorktrees.getByText('Quick Push completed.')).toBeVisible();
		await gitWorktrees.getByRole('button', { name: 'Remove worktree' }).click();
		await expect(
			gitWorktrees.getByRole('region', { name: 'Confirm worktree removal' }),
		).toBeVisible();
		await gitWorktrees.getByRole('button', { name: 'Confirm removal' }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { __gitActions: string[] }).__gitActions,
				),
			)
			.toEqual([
				'pull',
				'rename',
				'open',
				'switch',
				'reveal',
				'copy',
				'propose',
				'approve',
				'remove',
			]);
		await expect(page.getByText('Loading agents…')).toHaveAttribute(
			'aria-busy',
			'true',
		);
		await expect(
			page.getByText('Agent status is unavailable for this connection.'),
		).toBeVisible();
		await expect(
			page.getByRole('list', { name: 'Agent activity' }),
		).toContainText('Needs input');
		await expect(page.getByText('Loading project files…')).toHaveAttribute(
			'aria-busy',
			'true',
		);
		await expect(
			page.getByText('Project files are unavailable for this connection.'),
		).toBeVisible();
		await expect(page.getByText('This project folder is empty.')).toBeVisible();
		await expect(
			page.getByRole('alert').filter({ hasText: 'File catalog failed' }),
		).toBeVisible();
		await expect(
			page.getByRole('tree', { name: 'Project files' }),
		).toContainText('README.md');
		await expect(
			page.getByText('Additional files were omitted by the server limit.'),
		).toBeVisible();
		await expect(page.getByText('Loading terminal sessions…')).toHaveAttribute(
			'aria-busy',
			'true',
		);
		await expect(
			page.getByText('Terminal capability is unavailable for this connection.'),
		).toBeVisible();
		await expect(
			page.getByText('This project has no terminal sessions.'),
		).toBeVisible();
		await expect(
			page.getByRole('alert').filter({ hasText: 'Terminal catalog failed' }),
		).toBeVisible();
		const terminal = page.locator('[data-shared-route-body="terminal"]').last();
		await page.evaluate(() => {
			(
				window as unknown as { __terminalActions: string[] }
			).__terminalActions.length = 0;
		});
		await terminal.getByRole('button', { name: 'New terminal' }).click();
		await expect(terminal.getByRole('log')).toContainText('replayed output');
		await terminal.getByLabel('Terminal input').fill('pwd\n');
		await terminal.getByRole('button', { name: 'Send input' }).click();
		await terminal.getByRole('button', { name: 'Resize terminal' }).click();
		await terminal.getByRole('button', { name: 'Detach terminal' }).click();
		await expect
			.poll(() =>
				page.evaluate(
					() =>
						(window as unknown as { __terminalActions: string[] })
							.__terminalActions,
				),
			)
			.toEqual(['create', 'attach', 'write:pwd', 'resize:100x30', 'detach']);
		expect(
			await page.evaluate(
				() =>
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth,
			),
		).toBe(false);
	});
}
