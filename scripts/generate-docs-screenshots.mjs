import { _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const outputDir = path.resolve(
	process.env.TERMINAY_DOCS_SCREENSHOT_DIR ?? 'artifacts/docs-screenshots',
);
const size = { width: 1200, height: 800 };
const screenshotDeviceScaleFactor = 2;
const settleDelayMs = 3_000;
const execFileAsync = promisify(execFile);

async function seedWorkspace() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-docs-workspace-'));
	const workspace = path.join(root, 'terminay');
	const linkedWorktree = path.join(root, 'terminay-docs-refresh');
	await mkdir(path.join(workspace, 'docs'), { recursive: true });
	await mkdir(path.join(workspace, 'src'), { recursive: true });
	await writeFile(path.join(workspace, 'README.md'), [
		'# Terminay',
		'',
		'A local-first terminal workspace for project work.',
		'',
		'- Split terminal layouts',
		'- Files, tasks, and worktrees',
		'- Secure remote access',
		'',
	].join('\n'));
	await writeFile(path.join(workspace, 'src', 'workspace.ts'), 'export const workspaceTitle = "Terminay";\n');
	await writeFile(path.join(workspace, 'docs', 'ROADMAP.md'), [
		'# Documentation roadmap',
		'',
		'## Capture',
		'- [x] Refresh the workspace guide',
		'- [ ] Capture the Files screen',
		'- [ ] Review remote access copy',
		'',
		'## Publish',
		'- [x] Verify dark mode screenshots',
		'- [ ] Publish the documentation site',
		'',
	].join('\n'));
	await writeFile(path.join(workspace, 'docs', 'RELEASE.md'), '# Release checklist\n\n- [ ] Review release notes\n- [x] Run the docs build\n');
	await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: workspace });
	await execFileAsync('git', ['config', 'user.email', 'docs@terminay.local'], { cwd: workspace });
	await execFileAsync('git', ['config', 'user.name', 'Terminay Docs'], { cwd: workspace });
	await execFileAsync('git', ['add', '.'], { cwd: workspace });
	await execFileAsync('git', ['commit', '-m', 'Seed documentation workspace'], { cwd: workspace });
	await execFileAsync('git', ['worktree', 'add', '-b', 'docs-refresh', linkedWorktree], { cwd: workspace });
	await writeFile(path.join(workspace, 'README.md'), '# Terminay\n\nA local-first terminal workspace for project work.\n\nDocs screenshots are being refreshed.\n');
	await writeFile(path.join(linkedWorktree, 'docs', 'RELEASE.md'), '# Release checklist\n\n- [x] Review release notes\n- [x] Run the docs build\n- [ ] Publish the documentation site\n');
	return { root, workspace };
}

async function setWindowSize(app, page) {
	const window = await app.browserWindow(page);
	await window.evaluate((nativeWindow, nextSize) => nativeWindow.setSize(nextSize.width, nextSize.height), size);
	const cdpSession = await page.context().newCDPSession(page);
	await cdpSession.send('Emulation.setDeviceMetricsOverride', {
		width: size.width,
		height: size.height,
		deviceScaleFactor: screenshotDeviceScaleFactor,
		mobile: false,
	});
}

async function useDarkMode(page) {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.addStyleTag({ content: ':root { color-scheme: dark; }' });
}

async function installScreenshotWindowControls(page, placement = 'tabbar') {
	await page.addStyleTag({
		content: `
			.docs-screenshot-window-controls {
				display: flex;
				align-items: center;
				gap: 8px;
				height: 100%;
				padding: 0 12px 0 16px;
				flex: 0 0 auto;
				-webkit-app-region: drag;
			}

			.docs-screenshot-window-controls--floating {
				position: fixed;
				top: 16px;
				left: 16px;
				z-index: 10000;
				height: auto;
				padding: 0;
			}

			.docs-screenshot-window-control {
				width: 12px;
				height: 12px;
				border-radius: 50%;
				display: block;
				box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.25);
			}

			.docs-screenshot-window-control--close { background: #ff5f57; }
			.docs-screenshot-window-control--minimize { background: #ffbd2e; }
			.docs-screenshot-window-control--zoom { background: #28c840; }

			.app-shell--macos .project-tabbar {
				padding-left: 0 !important;
			}
		`,
	});

	await page.evaluate((nextPlacement) => {
		document.querySelector('.docs-screenshot-window-controls')?.remove();
		const controls = document.createElement('div');
		controls.className = nextPlacement === 'floating'
			? 'docs-screenshot-window-controls docs-screenshot-window-controls--floating'
			: 'docs-screenshot-window-controls';
		controls.setAttribute('aria-hidden', 'true');

		for (const name of ['close', 'minimize', 'zoom']) {
			const control = document.createElement('span');
			control.className = `docs-screenshot-window-control docs-screenshot-window-control--${name}`;
			controls.append(control);
		}

		const tabbar = document.querySelector('.project-tabbar');
		if (nextPlacement === 'tabbar' && tabbar) {
			tabbar.prepend(controls);
			return;
		}
		document.body.append(controls);
	}, placement);
}

async function capture(app, page, name) {
	await page.waitForTimeout(settleDelayMs);
	const window = await app.browserWindow(page);
	const dataUrl = await window.evaluate(async (nativeWindow) => {
		const image = await nativeWindow.webContents.capturePage();
		return image.toDataURL();
	});
	await writeFile(path.join(outputDir, name), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
}

async function editActiveProject(page, { title, hue, rootFolder }) {
	await page.locator('.project-tab--active').evaluate((element) => {
		element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
	});
	await page.getByRole('heading', { name: 'Edit Project Tab' }).waitFor({ state: 'visible' });
	await page.getByPlaceholder('Project name').fill(title);
	await page.getByLabel('Tab icon').fill('');
	await page.getByLabel('Project theme hue').evaluate((element, nextHue) => {
		const input = element;
		input.value = String(nextHue);
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new Event('change', { bubbles: true }));
	}, hue);
	await page.getByPlaceholder('Enter folder path').fill(rootFolder);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('heading', { name: 'Edit Project Tab' }).waitFor({ state: 'hidden' });
}

async function invokeMenuCommand(page, command) {
	await page.evaluate(async (nextCommand) => {
		const host = window.terminayHost;
		if (!host) throw new Error('Canonical Terminay host is unavailable.');
		const context = await host.getContext();
		await host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: { command: nextCommand, type: 'menu.invoke' },
		});
	}, command);
}

async function createWorkspaceProjects(page, rootFolder) {
	const projects = [
		{ title: 'Terminay', hue: 0 },
		{ title: 'Docs', hue: 145 },
		{ title: 'Shells', hue: 295 },
		{ title: 'API', hue: 30 },
		{ title: 'Release', hue: 52 },
	];
	const createProject = page.getByLabel('Create project on This server');
	for (const [index, project] of projects.entries()) {
		if (index > 0) {
			const projectCount = await page.locator('.project-tab').count();
			await createProject.click();
			await page.waitForFunction((previousCount) => document.querySelectorAll('.project-tab').length > previousCount, projectCount);
			await page.locator('.project-tab').nth(projectCount).click();
		}
		await editActiveProject(page, { ...project, rootFolder });
	}
	await page.locator('.project-tab').filter({ hasText: 'Terminay' }).first().click();
}

async function createTerminalGrid(page) {
	const panels = page.locator('.project-workspace--active .terminal-tab-content');
	await panels.first().click();
	await invokeMenuCommand(page, 'split-vertical');
	await panels.nth(1).waitFor({ state: 'visible', timeout: 30_000 });
	await panels.nth(1).click();
	await invokeMenuCommand(page, 'split-horizontal');
	await panels.nth(2).waitFor({ state: 'visible', timeout: 30_000 });
	await panels.first().click();
	await invokeMenuCommand(page, 'split-horizontal');
	await panels.nth(3).waitFor({ state: 'visible', timeout: 30_000 });
}

async function populateTerminalGrid(page, workspace) {
	const commands = [
		'cat README.md',
		'ls -la docs',
		'git status --short && git branch --show-current',
		'cat docs/ROADMAP.md',
	];
	const terminals = page.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea');
	await terminals.nth(3).waitFor({ state: 'visible', timeout: 30_000 });
	for (const [index, command] of commands.entries()) {
		const terminal = terminals.nth(index);
		await terminal.click();
		await terminal.pressSequentially(`cd '${workspace}' && clear`, { delay: 2 });
		await terminal.press('Enter');
		await page.waitForTimeout(250);
		await terminal.pressSequentially(command, { delay: 2 });
		await terminal.press('Enter');
		await page.waitForTimeout(250);
	}
	await page.waitForTimeout(1_000);
}

async function openFileExplorer(page) {
	const explorer = page.locator('.project-workspace--active .file-explorer-sidebar');
	if (!(await explorer.isVisible())) await page.getByLabel('Toggle file explorer').click();
	await explorer.waitFor({ state: 'visible' });
}

function explorerItem(page, name) {
	return page.locator('.file-explorer-tree-item').filter({ hasText: name }).first();
}

async function requestRoute(page, route, logicalViewId) {
	await page.evaluate(async ({ nextRoute, nextLogicalViewId }) => {
		const host = window.terminayHost;
		if (!host) throw new Error('Canonical Terminay host is unavailable.');
		const context = await host.getContext();
		await host.requestAction({
			bridgeVersion: context.hostBridgeVersion,
			profileId: context.profileId,
			schemaVersion: context.schemaVersion,
			serverId: context.serverId,
			sourceId: context.sourceId,
			userGesture: true,
			windowId: context.windowId,
			action: {
				disposition: 'native-window',
				logicalViewId: nextLogicalViewId,
				route: nextRoute,
				type: 'route.present',
			},
		});
	}, { nextLogicalViewId: logicalViewId, nextRoute: route });
}

async function openRoute(app, page, route, logicalViewId, selector) {
	const nextWindow = app.waitForEvent('window');
	await requestRoute(page, route, logicalViewId);
	const window = await nextWindow;
	await window.waitForLoadState('domcontentloaded');
	await useDarkMode(window);
	await setWindowSize(app, window);
	await window.locator(selector).waitFor({ state: 'visible', timeout: 30_000 });
	return window;
}

async function run() {
	const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-docs-user-data-'));
	const seededWorkspace = await seedWorkspace();
	let app;
	try {
		await rm(outputDir, { force: true, recursive: true });
		await mkdir(outputDir, { recursive: true });
		app = await electron.launch({
			args: ['--force-device-scale-factor=2', '--high-dpi-support=1', '.'],
			env: {
				...process.env,
				CI: '1',
				TERMINAY_TEST: '1',
				TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI: '1',
				TERMINAY_USER_DATA_DIR: userDataDir,
			},
		});
		await app.evaluate(({ nativeTheme }) => {
			nativeTheme.themeSource = 'dark';
		});
		const mainWindow = await app.firstWindow();
		await mainWindow.waitForLoadState('domcontentloaded');
		await useDarkMode(mainWindow);
		await setWindowSize(app, mainWindow);
		await mainWindow.locator('[data-terminay-app-component]').waitFor({ state: 'visible', timeout: 60_000 });
		await installScreenshotWindowControls(mainWindow);
		await createWorkspaceProjects(mainWindow, seededWorkspace.workspace);
		await createTerminalGrid(mainWindow);
		await populateTerminalGrid(mainWindow, seededWorkspace.workspace);
		const terminal = mainWindow.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea').first();
		await mainWindow.locator('.project-workspace--active .xterm-rows').first().waitFor({ state: 'visible' });
		await capture(app, mainWindow, 'terminay-hero-workspace.png');
		await capture(app, mainWindow, 'terminay-workspace.png');

		// Keep the feature walkthroughs legible: the workspace image above intentionally
		// demonstrates the 2x2 layout, while the Docs project is a clean one-pane canvas.
		await mainWindow.locator('.project-tab').filter({ hasText: 'Docs' }).first().click();
		await openFileExplorer(mainWindow);
		const documentationPane = mainWindow.locator('.project-workspace--active .sidebar-pane').filter({
			has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Documentation' }),
		});
		if (await documentationPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
			await documentationPane.locator('.sidebar-pane__header').click();
		}
		await documentationPane.getByRole('tree').waitFor({ state: 'visible', timeout: 30_000 });
		await documentationPane.getByRole('treeitem', { name: 'Docs', exact: true }).click();
		await documentationPane.getByRole('treeitem', { name: /^Readme, README\.md$/i }).click();
		await mainWindow.locator('.documentation-editor').waitFor({ state: 'visible', timeout: 30_000 });
		await mainWindow.getByRole('heading', { name: 'Terminay', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-documentation.png');

		const readme = explorerItem(mainWindow, 'README.md');
		await readme.waitFor({ state: 'visible', timeout: 30_000 });
		await readme.dblclick();
		await mainWindow.locator('.file-preview-markdown').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-files.png');

		const docsFolder = explorerItem(mainWindow, 'docs');
		await docsFolder.click();
		const roadmap = explorerItem(mainWindow, 'ROADMAP.md');
		await roadmap.waitFor({ state: 'visible', timeout: 30_000 });
		await roadmap.dblclick();
		await mainWindow.getByRole('tab', { name: 'Tasks', exact: true }).click();
		await mainWindow.locator('.file-tasks').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-files-tasks.png');

		await docsFolder.dblclick();
		await mainWindow.locator('.folder-viewer__title').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-folders.png');
		await mainWindow.locator('.folder-viewer__view-button').filter({ hasText: 'List' }).first().click();
		await mainWindow.locator('.folder-viewer__list').waitFor({ state: 'visible' });
		await capture(app, mainWindow, 'terminay-folder-list.png');
		await mainWindow.locator('.folder-viewer__view-button').filter({ hasText: 'Tasks' }).first().click();
		await mainWindow.locator('.folder-tasks').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-folder-tasks.png');
		await mainWindow.getByRole('tab', { name: 'Kanban', exact: true }).click();
		await mainWindow.locator('.file-kanban__board').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-tasks-kanban.png');

		const gitPane = mainWindow.locator('.sidebar-pane').filter({ has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Git' }) });
		await gitPane.locator('.worktrees-panel__worktree').first().waitFor({ state: 'visible', timeout: 30_000 });
		await gitPane.scrollIntoViewIfNeeded();
		await capture(app, mainWindow, 'terminay-worktrees.png');
		await gitPane.locator('.worktrees-panel__push-button').first().click();
		await mainWindow.locator('.context-menu').waitFor({ state: 'visible' });
		await capture(app, mainWindow, 'terminay-quick-push.png');
		await mainWindow.keyboard.press('Escape');

		const recordingTab = mainWindow.locator('.project-workspace--active .terminal-tab-content').first();
		await recordingTab.click();
		await recordingTab.click({ button: 'right' });
		await mainWindow.locator('.context-menu__item').filter({ hasText: 'Start Recording' }).click();
		await terminal.focus();
		await terminal.pressSequentially('printf "Recording a documentation session\\n"', { delay: 2 });
		await terminal.press('Enter');
		await mainWindow.waitForTimeout(500);
		await recordingTab.click({ button: 'right' });
		await mainWindow.locator('.context-menu__item').filter({ hasText: 'Stop Recording' }).click();

		await mainWindow.evaluate(async () => {
			const host = window.terminayHost;
			if (!host) throw new Error('Canonical Terminay host is unavailable.');
			const context = await host.getContext();
			await host.requestAction({
				bridgeVersion: context.hostBridgeVersion,
				profileId: context.profileId,
				schemaVersion: context.schemaVersion,
				serverId: context.serverId,
				sourceId: context.sourceId,
				userGesture: true,
				windowId: context.windowId,
				action: { command: 'open-command-bar', type: 'menu.invoke' },
			});
		});
		await mainWindow.getByRole('dialog', { name: 'Command bar' }).waitFor({ state: 'visible' });
		await capture(app, mainWindow, 'terminay-command-bar.png');
		await mainWindow.keyboard.press('Escape');

		await invokeMenuCommand(mainWindow, 'open-command-bar');
		const commandBar = mainWindow.getByRole('dialog', { name: 'Command bar' });
		await commandBar.waitFor({ state: 'visible' });
		await commandBar.getByLabel('Search commands').fill('Install Terminay MCP');
		await commandBar.locator('.macro-launcher-item').filter({ hasText: 'Install Terminay MCP' }).click();
		await mainWindow.getByRole('heading', { name: 'Install Terminay MCP' }).waitFor({ state: 'visible' });
		await capture(app, mainWindow, 'terminay-mcp-install.png');
		await mainWindow.getByRole('button', { name: 'Close Install Terminay MCP' }).click();

	const macros = await openRoute(app, mainWindow, '/?auxiliary=macros', 'macros', '[data-shared-route-body="macros"]');
		await installScreenshotWindowControls(macros, 'floating');
		await capture(app, macros, 'terminay-macros.png');
		await macros.close();

	const recordings = await openRoute(app, mainWindow, '/?auxiliary=recordings', 'recordings', '[data-shared-route-body="recordings"]');
		await installScreenshotWindowControls(recordings, 'floating');
		await capture(app, recordings, 'terminay-recordings.png');
		await recordings.close();

		const settings = await openRoute(app, mainWindow, '/?auxiliary=settings', 'settings', '[data-shared-route-body="settings"]');
		await installScreenshotWindowControls(settings, 'floating');
		await capture(app, settings, 'terminay-settings.png');
		const shortcuts = settings.locator('.settings-nav-item').filter({ hasText: 'Shortcuts' }).first();
		await shortcuts.click();
		await shortcuts.waitFor({ state: 'visible' });
		await capture(app, settings, 'terminay-shortcuts.png');
		await settings.close();

	const remoteControl = await openRoute(app, mainWindow, '/?auxiliary=remote-control', 'remote-control', '[data-shared-route-body="connections"]');
		await installScreenshotWindowControls(remoteControl, 'floating');
		await capture(app, remoteControl, 'terminay-remote-access.png');
		await remoteControl.close();
	} finally {
		if (app) await app.close();
		await rm(userDataDir, { force: true, recursive: true });
		await rm(seededWorkspace.root, { force: true, recursive: true });
	}
}

await run();
