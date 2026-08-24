import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from './fixtures';
import { openFileExplorer, setProjectRoot } from './support/ui';

test('Documentation groups Markdown by folder and opens the rich document surface', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'documentation-sidebar-editor',
		seed: {
			directories: ['docs/guides'],
			files: {
				'README.md': '# Read me',
				'docs/guides/getting-started.md':
					'---\ntitle: Getting Started\n---\n\n# Hello\n\nA comfortable paragraph for checking documentation typography.\n\n- First item\n- Second item\n\n- [ ] An incomplete task\n- [x] A completed task',
			},
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	const documentationPane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	if (
		await documentationPane.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		)
	) {
		await documentationPane.locator('.sidebar-pane__header').click();
	}
	await expect(mainWindow.getByRole('tree')).toBeVisible();
	await expect(
		mainWindow.getByRole('treeitem', { name: /^Readme, README\.md$/i }),
	).toBeVisible();
	await mainWindow.getByRole('treeitem', { name: /docs/ }).click();
	await mainWindow.getByRole('treeitem', { name: /guides/ }).click();
	await mainWindow.getByRole('treeitem', { name: /Getting Started/ }).click();
	const editor = mainWindow.locator('.documentation-editor');
	await expect(editor).toBeVisible();
	await expect(editor.getByText('Hello', { exact: true })).toBeVisible();
	const richText = editor.locator('.documentation-editor__content');
	const typography = await richText.evaluate((element) => {
		const style = getComputedStyle(element);
		const root = getComputedStyle(
			element.closest('.documentation-editor__surface')!,
		);
		return {
			foreground: style.color,
			background: root.backgroundColor,
			fontFamily: style.fontFamily,
			fontSize: style.fontSize,
			lineHeight: style.lineHeight,
		};
	});
	expect(typography.foreground).not.toBe(typography.background);
	expect(typography.fontFamily).toContain('Open Sans');
	expect(['16px', '17px']).toContain(typography.fontSize);
	expect(Number.parseFloat(typography.lineHeight)).toBeGreaterThanOrEqual(27);
	const taskListLayout = await richText
		.locator("li[role='checkbox']")
		.first()
		.evaluate((element) => {
			const before = getComputedStyle(element, '::before');
			return {
				markerWidth: Number.parseFloat(before.width),
				markerTop: Number.parseFloat(before.top),
				labelPadding: Number.parseFloat(
					getComputedStyle(element).paddingInlineStart,
				),
			};
		});
	expect(taskListLayout.markerWidth).toBeGreaterThan(0);
	expect(taskListLayout.markerTop).toBeGreaterThan(0);
	expect(taskListLayout.labelPadding).toBeGreaterThan(
		taskListLayout.markerWidth,
	);
	const trailingReadingSpace = await richText.evaluate((element) => ({
		padding: Number.parseFloat(getComputedStyle(element).paddingBlockEnd),
		tabHeight: element.closest('.documentation-editor')!.clientHeight,
	}));
	expect(trailingReadingSpace.padding).toBeGreaterThanOrEqual(
		trailingReadingSpace.tabHeight * 0.75,
	);
	const widths = await richText.evaluate((element) => ({
		content: element.clientWidth,
		surface: element.closest('.documentation-editor__surface')!.clientWidth,
	}));
	expect(
		Math.abs(widths.content - Math.min(widths.surface, 1080)),
	).toBeLessThan(2);
	await expect
		.poll(() =>
			mainWindow.evaluate(() => document.fonts.check('16px "Open Sans"')),
		)
		.toBe(true);
	await richText.focus();
	await mainWindow.keyboard.press('End');
	await mainWindow.keyboard.type(' Focus stays here.');
	await expect(richText).toBeFocused();
	await mainWindow.waitForTimeout(1_200);
	await expect(richText).toBeFocused();
	await expect(editor.locator('.documentation-editor__status')).toHaveCount(0);
	await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced');
	await expect(mainWindow.locator('.file-status-bar')).not.toContainText(
		'Monaco',
	);

	await editor.getByRole('combobox').first().click();
	const blockTypeMenu = mainWindow.getByRole('listbox').last();
	await expect(blockTypeMenu).toBeVisible();
	await expect(blockTypeMenu).toHaveCSS('background-color', 'rgb(17, 21, 27)');
	await mainWindow.keyboard.press('Escape');
	const selectedToolbarButton = editor
		.locator('.mdxeditor-toolbar button[data-state="on"]')
		.first();
	if (await selectedToolbarButton.count()) {
		const background = await selectedToolbarButton.evaluate(
			(element) => getComputedStyle(element).backgroundColor,
		);
		expect(background).not.toBe('rgb(255, 255, 255)');
	}
	await editor.getByRole('combobox', { name: 'Insert Admonition' }).click();
	await mainWindow.getByText('Info', { exact: true }).click();
	const infoAdmonition = editor.locator(
		'.documentation-editor__admonition--info',
	);
	await expect(infoAdmonition).toBeVisible();
	await expect(infoAdmonition).toHaveCSS(
		'background-color',
		'rgba(59, 130, 246, 0.12)',
	);
	await expect(infoAdmonition).toHaveCSS(
		'border-left-color',
		'rgb(96, 165, 250)',
	);
	await expect(infoAdmonition.locator('[contenteditable="true"]')).toHaveCSS(
		'background-color',
		'rgba(0, 0, 0, 0)',
	);
	await expect(editor).toBeVisible();
	await expect(mainWindow.locator('.project-workspace--active')).toBeVisible();
	await mainWindow.waitForTimeout(1_200);
	expect(
		await readFile(
			path.join(workspace.rootDir, 'docs/guides/getting-started.md'),
			'utf8',
		),
	).toContain(':::info');
	await editor.getByRole('radio', { name: 'Source mode' }).click();
	await expect(editor.getByText('Source mode', { exact: true })).toBeVisible();
	await expect(editor.locator('.cm-sourceView')).toHaveCSS(
		'background-color',
		'rgb(13, 16, 20)',
	);
	await editor.getByRole('radio', { name: 'Diff mode' }).click();
	await expect(editor.getByText('Diff mode', { exact: true })).toBeVisible();
	for (const pane of await editor
		.locator('.cm-mergeViewEditor .cm-editor')
		.all()) {
		await expect(pane).toHaveCSS('background-color', 'rgb(13, 16, 20)');
	}
	await mainWindow.waitForTimeout(1_200);
	expect(
		await readFile(
			path.join(workspace.rootDir, 'docs/guides/getting-started.md'),
			'utf8',
		),
	).toContain(':::info');

	await editor.getByRole('radio', { name: 'Rich text', exact: true }).click();
	await editor.getByRole('button', { name: 'Insert Table' }).click();
	const richTable = editor.locator('table[class*="_tableEditor_"]');
	await expect(richTable).toBeVisible();
	await expect(
		richTable
			.locator('tbody tr')
			.first()
			.locator(
				':is(td, th):not([data-tool-cell="true"]):not([class*="_toolCell_"])',
			)
			.first(),
	).toHaveCSS('background-color', 'rgb(23, 28, 36)');

	await editor.getByRole('button', { name: 'Insert Code Block' }).click();
	await expect(editor.locator('.cm-editor')).toBeVisible();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

test('Documentation autosave does not report its own root-file write as an external conflict', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'documentation-autosave-self-watch',
		seed: {
			files: {
				'AGENTS.md':
					'# AGENTS\n\n## Editing instructions\n\nOriginal guidance.\n',
			},
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	const documentationPane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	if (
		await documentationPane.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		)
	) {
		await documentationPane.locator('.sidebar-pane__header').click();
	}
	await mainWindow
		.getByRole('treeitem', { name: /^Agents, AGENTS\.md$/i })
		.click();

	const editor = mainWindow.locator('.documentation-editor');
	const heading = editor.getByText('Editing instructions', { exact: true });
	await heading.click();
	await mainWindow.keyboard.press('End');
	await mainWindow.keyboard.type(' updated');
	await expect(mainWindow.locator('.file-status-bar')).toContainText(
		'Unsaved changes',
	);
	await expect
		.poll(() => workspace.readText('AGENTS.md'))
		.toContain('## Editing instructions updated');
	await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced');

	await expect(
		mainWindow.getByText(
			'This file changed on disk while you had unsaved edits.',
			{ exact: true },
		),
	).toHaveCount(0);
	await expect(editor.locator('.documentation-editor__status')).toHaveCount(0);
});

test('repeated AGENTS.md autosaves do not conflict with their own filesystem events', async ({
	createWorkspace,
	mainWindow,
}) => {
	// This scenario intentionally waits for twelve one-second autosave cycles.
	// Keep its timeout independent from the suite default so Docker build/load
	// variance cannot cancel the final pending save before it is observed.
	test.setTimeout(60_000);
	const workspace = await createWorkspace({
		name: 'documentation-repeated-autosave-self-watch',
		seed: {
			files: {
				'AGENTS.md': [
					'# AGENTS — Terminay',
					'',
					'Terminay is a local-first Electron terminal workspace.',
					'',
					':::info',
					'**Amazing right?** Well it could be better',
					':::',
					'',
				].join('\n'),
			},
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	const documentationPane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	if (
		await documentationPane.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		)
	) {
		await documentationPane.locator('.sidebar-pane__header').click();
	}
	await mainWindow
		.getByRole('treeitem', { name: /^Agents, AGENTS\.md$/i })
		.click();

	const editor = mainWindow.locator('.documentation-editor');
	const paragraph = editor.getByText(
		'Terminay is a local-first Electron terminal workspace.',
		{ exact: true },
	);
	await paragraph.click();
	await mainWindow.keyboard.press('End');

	for (let revision = 1; revision <= 12; revision += 1) {
		const marker = ` ${revision}`;
		await mainWindow.keyboard.type(marker);
		await expect(mainWindow.locator('.file-status-bar')).toContainText(
			'Unsaved changes',
		);
		await expect
			.poll(() => workspace.readText('AGENTS.md'))
			.toContain(
				`workspace.${Array.from({ length: revision }, (_, index) => ` ${index + 1}`).join('')}`,
			);
		await expect(mainWindow.locator('.file-status-bar')).toContainText(
			'Synced',
		);
		await expect(
			mainWindow.getByText(
				'This file changed on disk while you had unsaved edits.',
				{ exact: true },
			),
		).toHaveCount(0);
		await expect(editor.locator('.documentation-editor__status')).toHaveCount(
			0,
		);
	}
});

test('a task checkbox autosave does not conflict with the next document edit', async ({
	createWorkspace,
	mainWindow,
}) => {
	const workspace = await createWorkspace({
		name: 'documentation-checkbox-autosave-self-watch',
		seed: {
			files: {
				'AGENTS.md': '# AGENTS\n\n- [ ] Item one\n\nWrite here.\n',
			},
		},
	});
	await setProjectRoot(mainWindow, workspace.rootDir);
	await openFileExplorer(mainWindow);
	const documentationPane = mainWindow
		.locator('.project-workspace--active .sidebar-pane')
		.filter({
			has: mainWindow.locator('.sidebar-pane__title', {
				hasText: 'Documentation',
			}),
		});
	if (
		await documentationPane.evaluate((element) =>
			element.classList.contains('sidebar-pane--collapsed'),
		)
	) {
		await documentationPane.locator('.sidebar-pane__header').click();
	}
	await mainWindow
		.getByRole('treeitem', { name: /^Agents, AGENTS\.md$/i })
		.click();
	const editor = mainWindow.locator('.documentation-editor');
	const taskCheckbox = editor.getByRole('checkbox').first();
	await taskCheckbox.click({ position: { x: 8, y: 8 } });
	await expect(taskCheckbox).toHaveAttribute('aria-checked', 'true');
	await expect
		.poll(() => workspace.readText('AGENTS.md'))
		.toContain('* [x] Item one');
	await expect(mainWindow.locator('.file-status-bar')).toContainText('Synced');

	const paragraph = editor.getByText('Write here.', { exact: true });
	await paragraph.click();
	await mainWindow.keyboard.press('End');
	await mainWindow.keyboard.type(' Again.');
	await expect(mainWindow.locator('.file-status-bar')).toContainText(
		'Unsaved changes',
	);
	await expect(
		mainWindow.getByText(
			'This file changed on disk while you had unsaved edits.',
			{ exact: true },
		),
	).toHaveCount(0);
	await expect(editor.locator('.documentation-editor__status')).toHaveCount(0);
});
