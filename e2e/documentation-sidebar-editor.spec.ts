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
					'---\ntitle: Getting Started\n---\n\n# Hello',
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
	const colors = await editor
		.locator('[contenteditable="true"]')
		.evaluate((element) => {
			const style = getComputedStyle(element);
			const root = getComputedStyle(
				element.closest('.documentation-editor__surface')!,
			);
			return { foreground: style.color, background: root.backgroundColor };
		});
	expect(colors.foreground).not.toBe(colors.background);
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
});
