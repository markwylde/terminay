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
	await mkdir(path.join(workspace, 'guides'), { recursive: true });
	await mkdir(path.join(workspace, 'handbook'), { recursive: true });
	await mkdir(path.join(workspace, 'reference'), { recursive: true });
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
	await writeFile(path.join(workspace, 'guides', 'getting-started.md'), '# Getting started\n\nCreate a project, open a terminal, and make the workspace your own.\n');
	await writeFile(path.join(workspace, 'guides', 'remote-workspaces.md'), '# Remote workspaces\n\nConnect securely to a Terminay Server from any browser.\n');
	await writeFile(path.join(workspace, 'handbook', 'architecture.md'), '# Architecture\n\nTerminay keeps project state local and moves privileged work behind explicit server APIs.\n');
	await writeFile(path.join(workspace, 'handbook', 'contributing.md'), '# Contributing\n\nKeep changes focused, tested, and documented.\n');
	await writeFile(path.join(workspace, 'handbook', 'releases.md'), '# Release process\n\nShip signed desktop builds and the web client together.\n');
	await writeFile(path.join(workspace, 'handbook', 'security.md'), '# Security model\n\nEvery filesystem operation remains scoped to its project.\n');
	await writeFile(path.join(workspace, 'handbook', 'roadmap.md'), [
		'---',
		'title: Product roadmap',
		'---',
		'',
		'# Product roadmap',
		'',
		'Terminay is becoming the calm, local-first workspace for serious terminal work. This roadmap keeps the experience fast while making projects easier to understand, share, and revisit.',
		'',
		'## Now — documentation that lives with the project',
		'',
		'- [x] Discover Markdown and MDX automatically',
		'- [x] Edit with a focused rich-text surface',
		'- [x] Keep drafts safe with autosave',
		'- [ ] Add cross-document search',
		'',
		'## Next — connected workspaces',
		'',
		'Open the same project from desktop or browser, hand work to an agent, and keep every terminal, document, and change in context.',
		'',
		'### What success looks like',
		'',
		'1. A new contributor understands the project in minutes.',
		'2. Remote sessions feel as responsive as local ones.',
		'3. Every automated change remains visible and reversible.',
		'',
		'> The terminal is where the work happens. Documentation is how the work stays understandable.',
		'',
	].join('\n'));
	await writeFile(path.join(workspace, 'reference', 'commands.md'), '# Command reference\n\nSearch and run every workspace action from the command palette.\n');
	await writeFile(path.join(workspace, 'reference', 'keyboard-shortcuts.md'), '# Keyboard shortcuts\n\nWork quickly without leaving the keyboard.\n');
	await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: workspace });
	await execFileAsync('git', ['config', 'user.email', 'docs@terminay.local'], { cwd: workspace });
	await execFileAsync('git', ['config', 'user.name', 'Terminay Docs'], { cwd: workspace });
	await execFileAsync('git', ['add', '.'], { cwd: workspace });
	await execFileAsync('git', ['commit', '-m', 'Seed documentation workspace'], { cwd: workspace });
	await execFileAsync('git', ['worktree', 'add', '-b', 'docs-refresh', linkedWorktree], { cwd: workspace });
	await writeFile(path.join(workspace, 'README.md'), '# Terminay\n\nA local-first terminal workspace for project work.\n\nDocs screenshots are being refreshed.\n');
	await writeFile(path.join(linkedWorktree, 'handbook', 'releases.md'), '# Release process\n\n- [x] Review release notes\n- [x] Run the docs build\n- [ ] Publish the documentation site\n');
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
		'ls -la handbook',
		'git status --short && git branch --show-current',
		'cat handbook/roadmap.md',
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

async function findWorkspaceWindow(app) {
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		for (const window of app.windows()) {
			if (await window.locator('[data-terminay-app-component]').count()) return window;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error('Terminay workspace window did not become available.');
}

async function run() {
	// macOS Unix-domain sockets have a short path limit. /var/folders plus a
	// worktree path can push the MCP control socket beyond it before the UI opens.
	const userDataRoot = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
	const userDataDir = await mkdtemp(path.join(userDataRoot, 'terminay-docs-user-data-'));
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
		await app.firstWindow();
		const mainWindow = await findWorkspaceWindow(app);
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
		await documentationPane.getByRole('treeitem', { name: /^handbook$/i }).evaluate((element) => element.click());
		await documentationPane.getByRole('treeitem', { name: /^Product roadmap, handbook\/roadmap\.md$/i }).evaluate((element) => element.click());
		await mainWindow.locator('.documentation-editor').waitFor({ state: 'visible', timeout: 30_000 });
		await mainWindow.getByRole('heading', { name: 'Product roadmap', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
		for (const title of ['Explorer', 'Agents', 'Git']) {
			const pane = mainWindow.locator('.project-workspace--active .sidebar-pane').filter({
				has: mainWindow.locator('.sidebar-pane__title', { hasText: title }),
			});
			if (!(await pane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed')))) {
				await pane.locator('.sidebar-pane__header').click();
			}
		}
		await mainWindow.evaluate(() => {
			if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		});
		await capture(app, mainWindow, 'terminay-documentation.png');

		const explorerPane = mainWindow.locator('.project-workspace--active .sidebar-pane').filter({
			has: mainWindow.locator('.sidebar-pane__title', { hasText: 'Explorer' }),
		});
		await explorerPane.locator('.sidebar-pane__header').click();
		const readme = explorerItem(mainWindow, 'README.md');
		await readme.waitFor({ state: 'visible', timeout: 30_000 });
		await readme.dblclick();
		await mainWindow.locator('.file-preview-markdown').waitFor({ state: 'visible', timeout: 30_000 });
		await capture(app, mainWindow, 'terminay-files.png');

		const docsFolder = explorerItem(mainWindow, 'handbook');
		await docsFolder.click();
		const roadmap = explorerItem(mainWindow, 'roadmap.md');
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
		if (await gitPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
			await gitPane.locator('.sidebar-pane__header').click();
		}
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
