import { _electron as electron } from '@playwright/test';
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const outputDir = path.resolve(
	process.env.TERMINAY_DOCS_SCREENSHOT_DIR ?? 'artifacts/docs-screenshots',
);
const size = { width: 1200, height: 800 };
const screenshotDeviceScaleFactor = 2;
const settleDelayMs = 3_000;
const useRealCodex = process.env.TERMINAY_DOCS_REAL_CODEX === '1';
const screenshotGroups = ['workspace', 'agents', 'files', 'git', 'chrome'];
const selectedGroup = process.env.TERMINAY_DOCS_SCREENSHOT_GROUP ?? 'all';
if (selectedGroup !== 'all' && !screenshotGroups.includes(selectedGroup)) {
	throw new Error(`Unknown screenshot group "${selectedGroup}". Use all or one of: ${screenshotGroups.join(', ')}`);
}
const execFileAsync = promisify(execFile);

function log(message) {
	console.log(`[docs-screenshots ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function wantsGroup(name) {
	return selectedGroup === 'all' || selectedGroup === name;
}

const agentsPrompt = 'Spawn 3 subagents to solve simple math problems';
const workspaceCodexPrompts = [
	'Summarize this repository.',
	'Explain the current git status.',
	'What belongs in the handbook?',
	'What is next on the roadmap?',
];

async function seedWorkspace() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-docs-workspace-'));
	const workspace = path.join(root, 'terminay');
	const linkedWorktree = path.join(root, 'terminay-docs-refresh');
	await mkdir(path.join(workspace, 'guides'), { recursive: true });
	await mkdir(path.join(workspace, 'handbook'), { recursive: true });
	await mkdir(path.join(workspace, 'reference'), { recursive: true });
	await mkdir(path.join(workspace, 'src'), { recursive: true });
	await mkdir(path.join(workspace, 'bin'), { recursive: true });
	const stubDestination = path.join(workspace, 'bin', 'codex');
	await copyFile(path.resolve(import.meta.dirname, 'docs-screenshot-codex-stub.sh'), stubDestination);
	await chmod(stubDestination, 0o755);
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

async function setWindowSize(app, page, nextSize = size) {
	const window = await app.browserWindow(page);
	await window.evaluate((nativeWindow, metrics) => nativeWindow.setSize(metrics.width, metrics.height), nextSize);
	const cdpSession = await page.context().newCDPSession(page);
	await cdpSession.send('Emulation.setDeviceMetricsOverride', {
		width: nextSize.width,
		height: nextSize.height,
		deviceScaleFactor: screenshotDeviceScaleFactor,
		mobile: nextSize.width < 600,
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
	log(`capturing ${name}`);
	await page.waitForTimeout(settleDelayMs);
	const window = await app.browserWindow(page);
	const dataUrl = await window.evaluate(async (nativeWindow) => {
		const image = await nativeWindow.webContents.capturePage();
		return image.toDataURL();
	});
	await writeFile(path.join(outputDir, name), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
	log(`wrote ${name}`);
}

const heroThemes = [
	{ name: 'red', hue: 0 },
	{ name: 'orange', hue: 32 },
	{ name: 'green', hue: 145 },
	{ name: 'blue', hue: 210 },
	{ name: 'purple', hue: 280 },
];


async function fillProjectHue(page, hue) {
	const slider = page.getByLabel('Project theme hue');
	await slider.waitFor({ state: 'visible' });
	await slider.fill(String(hue));
}

async function waitForActiveProjectHue(page, previousStyle) {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const style = await page.locator('.project-tab--active').first().getAttribute('style');
		if (style && style !== previousStyle) return;
		await page.waitForTimeout(100);
	}
	throw new Error('Project hue did not apply to the active tab.');
}

async function setActiveProjectHue(page, hue) {
	const previousStyle = await page.locator('.project-tab--active').first().getAttribute('style');
	await page.locator('.project-tab--active').evaluate((element) => {
		element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
	});
	await page.getByRole('heading', { name: 'Edit Project Tab' }).waitFor({ state: 'visible' });
	await fillProjectHue(page, hue);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await page.getByRole('heading', { name: 'Edit Project Tab' }).waitFor({ state: 'hidden' });
	await waitForActiveProjectHue(page, previousStyle);
}

async function editActiveProject(page, { title, rootFolder }) {
	await page.locator('.project-tab--active').evaluate((element) => {
		element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
	});
	await page.getByRole('heading', { name: 'Edit Project Tab' }).waitFor({ state: 'visible' });
	await page.getByPlaceholder('Project name').fill(title);
	await page.getByLabel('Tab icon').fill('');
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
	await page.locator('.project-tab').first().click();
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

function quoteShell(value) {
	return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function typeTerminalCommand(terminal, command) {
	await terminal.click();
	await terminal.pressSequentially(command, { delay: 2 });
	await terminal.press('Enter');
}

async function withHeartbeat(label, work) {
	const started = Date.now();
	const heartbeat = setInterval(() => {
		log(`${label} (${Math.round((Date.now() - started) / 1000)}s elapsed)`);
	}, 10_000);
	try {
		return await work();
	} finally {
		clearInterval(heartbeat);
	}
}

async function withTimeout(label, ms, work) {
	log(label);
	let timer;
	try {
		return await withHeartbeat(label, () => Promise.race([
			work(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
			}),
		]));
	} finally {
		clearTimeout(timer);
	}
}

async function waitForExecComplete(page) {
	const timeout = useRealCodex ? 180_000 : 20_000;
	await withHeartbeat('waiting for Codex exec to finish', () => page.waitForFunction(() => {
		const panels = [...document.querySelectorAll('.project-workspace--active .terminal-panel')]
			.filter((element) => getComputedStyle(element).display !== 'none' && element.offsetParent !== null);
		return panels.some((element) => {
			const text = element.textContent ?? '';
			return text.includes('CODEX_EXEC_DONE') || /tokens used/i.test(text);
		});
	}, undefined, { timeout }));
}

async function runCodexExecThenResume(page, index, workspace, prompt) {
	// Exec creates the session; resume opens the interactive TUI for the screenshot.
	log(`pane ${index + 1}: codex exec — ${prompt}`);
	const terminal = page.locator(
		'.project-workspace--active .terminal-panel:visible .xterm-helper-textarea',
	).nth(index);
	await terminal.click();
	const stubCodex = path.join(workspace, 'bin', 'codex');
	const codex = useRealCodex ? 'codex' : quoteShell(stubCodex);
	const setupCommand = `cd ${quoteShell(workspace)} && clear`;
	await typeTerminalCommand(terminal, setupCommand);
	await page.waitForTimeout(250);
	await typeTerminalCommand(terminal, `${codex} exec --skip-git-repo-check ${quoteShell(prompt)}`);
	await waitForExecComplete(page);
	log(`pane ${index + 1}: exec done, opening resume TUI`);
	await typeTerminalCommand(terminal, 'clear');
	await page.waitForTimeout(200);
	await typeTerminalCommand(terminal, `${codex} resume --last --include-non-interactive`);
	const panel = page.locator('.project-workspace--active .terminal-panel:visible').nth(index);
	await page.waitForTimeout(useRealCodex ? 2_000 : 400);
	if ((await panel.textContent())?.includes('Press enter to continue')) {
		await terminal.press('Enter');
		await page.waitForTimeout(400);
	}
	await page.waitForTimeout(1_000);
	log(`pane ${index + 1}: TUI ready`);
}

async function stopCodexTuis(page, count) {
	const terminals = page.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea');
	for (let index = 0; index < count; index += 1) {
		const terminal = terminals.nth(index);
		if (await terminal.count() === 0) continue;
		await terminal.click();
		await terminal.press('Control+C');
		await page.waitForTimeout(150);
		await terminal.press('Control+C');
	}
	await page.waitForTimeout(400);
}

async function populateCodexTerminalGrid(page, workspace) {
	const terminals = page.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea');
	await terminals.nth(3).waitFor({ state: 'visible', timeout: 30_000 });
	for (const [index, prompt] of workspaceCodexPrompts.entries()) {
		await runCodexExecThenResume(page, index, workspace, prompt);
	}
}

async function openFileExplorer(page) {
	const explorer = page.locator('.project-workspace--active .file-explorer-sidebar');
	if (!(await explorer.isVisible())) await page.getByLabel('Toggle file explorer').click();
	await explorer.waitFor({ state: 'visible' });
}

async function selectSidebarGroup(page, group) {
	await openFileExplorer(page);
	const label = group === 'explorer' ? 'Explorer' : group === 'documentation' ? 'Documentation' : 'Agents';
	const tab = page.locator('.project-workspace--active').getByRole('tab', { name: label });
	await tab.click();
	await tab.waitFor({ state: 'visible' });
}

async function ensureSingleTerminal(page) {
	const panels = page.locator('.project-workspace--active .terminal-tab-content:visible');
	await panels.first().waitFor({ state: 'visible', timeout: 30_000 });
	let remaining = await panels.count();
	log(`agent terminal panes: ${remaining}`);
	while (remaining > 1) {
		log(`closing extra terminal pane (${remaining} open)`);
		await panels.last().click({ timeout: 5_000 });
		await invokeMenuCommand(page, 'close-active');
		await page.waitForTimeout(250);
		const nextCount = await panels.count();
		if (nextCount >= remaining) break;
		remaining = nextCount;
	}
}

async function prepareAgentsPane(page) {
	for (const title of ['Explorer', 'Documentation', 'Git']) {
		const pane = page.locator('.project-workspace--active .sidebar-pane').filter({
			has: page.locator('.sidebar-pane__title', { hasText: title }),
		});
		if (await pane.count() === 0 || !(await pane.first().isVisible())) continue;
		if (!(await pane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed')))) {
			log(`collapsing ${title} pane`);
			await pane.locator('.sidebar-pane__header').click();
		}
	}
	const agentsPane = page.locator('.project-workspace--active .sidebar-pane').filter({
		has: page.locator('.sidebar-pane__title', { hasText: 'Agents' }),
	});
	await agentsPane.waitFor({ state: 'visible', timeout: 15_000 });
	if (await agentsPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
		log('expanding Agents pane');
		await agentsPane.locator('.sidebar-pane__header').click();
	}
	return agentsPane;
}

async function populateAgentsScreenshot(page) {
	const terminalSessionId = await page
		.locator('.project-workspace--active .terminal-panel:visible')
		.first()
		.getAttribute('data-terminay-terminal-session-id');
	if (!terminalSessionId) throw new Error('The docs terminal session is unavailable.');
	log(`publishing agent lifecycle for session ${terminalSessionId}`);

	const prompt = agentsPrompt;
	const accepted = await withTimeout('publish agent lifecycle', 10_000, () => page.evaluate(async ({ sessionId, rootPrompt }) => {
		if (!window.terminayAgentStatusTest) throw new Error('The agent screenshot seam is unavailable.');
		return window.terminayAgentStatusTest.publishLifecycle({
			provider: 'com.terminay.agent.codex/cli',
			terminalSessionId: sessionId,
			providerSessionId: 'docs-agent-root',
			events: [
				{ kind: 'session.started', title: 'Codex' },
				{ kind: 'agent.metadata', promptText: rootPrompt, model: { id: 'gpt-5.6', displayName: 'GPT-5.6' } },
				{ kind: 'turn.started', turnId: 'docs-math-turn' },
				{ kind: 'subagent.started', subagentId: 'addition', title: 'Addition', promptText: 'Solve 128 + 256' },
				{ kind: 'subagent.started', subagentId: 'multiplication', title: 'Multiplication', promptText: 'Solve 24 × 18' },
				{ kind: 'subagent.started', subagentId: 'division', title: 'Division', promptText: 'Solve 1,024 ÷ 16' },
			],
		});
	}, { rootPrompt: prompt, sessionId: terminalSessionId }));
	if (!accepted) throw new Error('The agent screenshot lifecycle was not accepted.');
	log('agent lifecycle accepted');

	const agentsPane = await prepareAgentsPane(page);
	log('waiting for Agents sidebar rows');
	await agentsPane.locator('.agents-sidebar__name', { hasText: prompt }).waitFor({ state: 'visible', timeout: 15_000 });
	await agentsPane.getByRole('button', { name: `Expand 3 subagents for ${prompt}` }).click();
	await agentsPane.getByRole('button', { name: 'Focus Division terminal' }).waitFor({ state: 'visible', timeout: 15_000 });
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	log('Agents sidebar is ready');
}

async function populateRealAgentsScreenshot(page) {
	const prompt = agentsPrompt;
	log('waiting for journal-bound Agents sidebar');
	const agentsPane = await prepareAgentsPane(page);
	await agentsPane.locator('.agents-sidebar__name', { hasText: prompt }).waitFor({ state: 'visible', timeout: 20_000 });
	await agentsPane.getByRole('button', { name: `Expand 3 subagents for ${prompt}` }).waitFor({ state: 'visible', timeout: 15_000 });
	await agentsPane.getByRole('button', { name: `Expand 3 subagents for ${prompt}` }).click();
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	log('journal-bound Agents sidebar is ready');
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

async function openDocsProject(page) {
	await page.locator('.project-tab').filter({ hasText: 'Docs' }).first().click();
	await page.locator('.project-tab--active').filter({ hasText: 'Docs' }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function captureWorkspaceGroup(app, page, workspace) {
	log('group workspace: Codex 2x2 grid');
	await createTerminalGrid(page);
	await populateCodexTerminalGrid(page, workspace);
	await page.locator('.project-workspace--active .xterm-rows').first().waitFor({ state: 'visible' });
	for (const [index, theme] of heroThemes.entries()) {
		await setActiveProjectHue(page, theme.hue);
		const desktopName = `terminay-workspace-${theme.name}.png`;
		const mobileName = `terminay-workspace-mobile-${theme.name}.png`;
		await capture(app, page, desktopName);
		if (index === 0) {
			await copyFile(path.join(outputDir, desktopName), path.join(outputDir, 'terminay-workspace.png'));
			await copyFile(path.join(outputDir, desktopName), path.join(outputDir, 'terminay-hero-workspace.png'));
			log('wrote terminay-hero-workspace.png');
		}
		await setWindowSize(app, page, { width: 390, height: 844 });
		await page.evaluate(() => document.querySelector('.docs-screenshot-window-controls')?.remove());
		await capture(app, page, mobileName);
		if (index === 0) {
			await copyFile(path.join(outputDir, mobileName), path.join(outputDir, 'terminay-workspace-mobile.png'));
		}
		await setWindowSize(app, page);
		await installScreenshotWindowControls(page);
	}
	await stopCodexTuis(page, 4);
}

async function captureAgentsGroup(app, page, workspace) {
	log('group agents: Agents sidebar and Documentation editor');
	await openDocsProject(page);
	await openFileExplorer(page);
	await selectSidebarGroup(page, 'agents');
	await ensureSingleTerminal(page);
	// Publish the sidebar while the PTY is idle. Doing this after `codex resume`
	// deadlocks the test IPC against the live Codex extension in CI.
	let injected = false;
	try {
		await populateAgentsScreenshot(page);
		injected = true;
	} catch (error) {
		log(`test lifecycle missed (${error?.message ?? error}); will use journals after the TUI starts`);
	}
	await runCodexExecThenResume(page, 0, workspace, agentsPrompt);
	const agentsPane = page.locator('.project-workspace--active .sidebar-pane').filter({
		has: page.locator('.sidebar-pane__title', { hasText: 'Agents' }),
	});
	if (await agentsPane.locator('.agents-sidebar__name', { hasText: agentsPrompt }).count() === 0) {
		log(injected ? 'Agents sidebar cleared after TUI start; restoring from journals' : 'filling Agents sidebar from journals');
		await populateRealAgentsScreenshot(page);
	}
	await capture(app, page, 'terminay-agents.png');
	const terminal = page.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea').first();
	await terminal.press('Control+C');
	await page.waitForTimeout(500);
	await terminal.press('Control+C');
	await page.waitForTimeout(400);
	await selectSidebarGroup(page, 'documentation');
	const documentationPane = page.locator('.project-workspace--active .sidebar-pane').filter({
		has: page.locator('.sidebar-pane__title', { hasText: 'Documentation' }),
	});
	if (await documentationPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
		await documentationPane.locator('.sidebar-pane__header').click();
	}
	await documentationPane.getByRole('tree').waitFor({ state: 'visible', timeout: 30_000 });
	await documentationPane.getByRole('treeitem', { name: /^handbook$/i }).evaluate((element) => element.click());
	await documentationPane.getByRole('treeitem', { name: /^Product roadmap, handbook\/roadmap\.md$/i }).evaluate((element) => element.click());
	await page.locator('.documentation-editor').waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('heading', { name: 'Product roadmap', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	await capture(app, page, 'terminay-documentation.png');
}

async function captureFilesGroup(app, page) {
	log('group files: explorer, folders, and tasks');
	await openDocsProject(page);
	await openFileExplorer(page);
	await selectSidebarGroup(page, 'explorer');
	const explorerPane = page.locator('.project-workspace--active .sidebar-pane').filter({
		has: page.locator('.sidebar-pane__title', { hasText: 'Files' }),
	});
	if (await explorerPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
		await explorerPane.locator('.sidebar-pane__header').click();
	}
	const readme = explorerItem(page, 'README.md');
	await readme.waitFor({ state: 'visible', timeout: 30_000 });
	await readme.dblclick();
	await page.locator('.file-preview-markdown').waitFor({ state: 'visible', timeout: 30_000 });
	await capture(app, page, 'terminay-files.png');

	const docsFolder = explorerItem(page, 'handbook');
	await docsFolder.click();
	const roadmap = explorerItem(page, 'roadmap.md');
	await roadmap.waitFor({ state: 'visible', timeout: 30_000 });
	await roadmap.dblclick();
	await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
	await page.locator('.file-tasks').waitFor({ state: 'visible', timeout: 30_000 });
	await capture(app, page, 'terminay-files-tasks.png');

	await docsFolder.dblclick();
	await page.locator('.folder-viewer__title').waitFor({ state: 'visible', timeout: 30_000 });
	await capture(app, page, 'terminay-folders.png');
	await page.locator('.folder-viewer__view-button').filter({ hasText: 'List' }).first().click();
	await page.locator('.folder-viewer__list').waitFor({ state: 'visible' });
	await capture(app, page, 'terminay-folder-list.png');
	await page.locator('.folder-viewer__view-button').filter({ hasText: 'Tasks' }).first().click();
	await page.locator('.folder-tasks').waitFor({ state: 'visible', timeout: 30_000 });
	await capture(app, page, 'terminay-folder-tasks.png');
	await page.getByRole('tab', { name: 'Kanban', exact: true }).click();
	await page.locator('.file-kanban__board').waitFor({ state: 'visible', timeout: 30_000 });
	await capture(app, page, 'terminay-tasks-kanban.png');
}

async function captureGitGroup(app, page) {
	log('group git: worktrees and Quick Push');
	await openDocsProject(page);
	await openFileExplorer(page);
	const gitPane = page.locator('.sidebar-pane').filter({ has: page.locator('.sidebar-pane__title', { hasText: 'Git' }) });
	if (await gitPane.evaluate((element) => element.classList.contains('sidebar-pane--collapsed'))) {
		await gitPane.locator('.sidebar-pane__header').click();
	}
	await gitPane.locator('.worktrees-panel__worktree').first().waitFor({ state: 'visible', timeout: 30_000 });
	await gitPane.scrollIntoViewIfNeeded();
	await capture(app, page, 'terminay-worktrees.png');
	await gitPane.locator('.worktrees-panel__push-button').first().click();
	await page.locator('.context-menu').waitFor({ state: 'visible' });
	await capture(app, page, 'terminay-quick-push.png');
	await page.keyboard.press('Escape');
}

async function captureChromeGroup(app, page) {
	log('group chrome: command bar, MCP, macros, recordings, settings, remote');
	await openDocsProject(page);
	const terminal = page.locator('.project-workspace--active .terminal-panel:visible .xterm-helper-textarea').first();
	const recordingTab = page.locator('.project-workspace--active .terminal-tab-content').first();
	await recordingTab.click();
	await recordingTab.click({ button: 'right' });
	await page.locator('.context-menu__item').filter({ hasText: 'Start Recording' }).click();
	await terminal.focus();
	await terminal.pressSequentially('printf "Recording a documentation session\\n"', { delay: 2 });
	await terminal.press('Enter');
	await page.waitForTimeout(500);
	await recordingTab.click({ button: 'right' });
	await page.locator('.context-menu__item').filter({ hasText: 'Stop Recording' }).click();

	await page.evaluate(async () => {
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
	await page.getByRole('dialog', { name: 'Command bar' }).waitFor({ state: 'visible' });
	await capture(app, page, 'terminay-command-bar.png');
	await page.keyboard.press('Escape');

	await invokeMenuCommand(page, 'open-command-bar');
	const commandBar = page.getByRole('dialog', { name: 'Command bar' });
	await commandBar.waitFor({ state: 'visible' });
	await commandBar.getByLabel('Search commands').fill('Install Terminay MCP');
	await commandBar.locator('.macro-launcher-item').filter({ hasText: 'Install Terminay MCP' }).click();
	await page.getByRole('heading', { name: 'Install Terminay MCP' }).waitFor({ state: 'visible' });
	await capture(app, page, 'terminay-mcp-install.png');
	await page.getByRole('button', { name: 'Close Install Terminay MCP' }).click();

	const macros = await openRoute(app, page, '/?auxiliary=macros', 'macros', '[data-shared-route-body="macros"]');
	await installScreenshotWindowControls(macros, 'floating');
	await capture(app, macros, 'terminay-macros.png');
	await macros.close();

	const recordings = await openRoute(app, page, '/?auxiliary=recordings', 'recordings', '[data-shared-route-body="recordings"]');
	await installScreenshotWindowControls(recordings, 'floating');
	await capture(app, recordings, 'terminay-recordings.png');
	await recordings.close();

	const settings = await openRoute(app, page, '/?auxiliary=settings', 'settings', '[data-shared-route-body="settings"]');
	await installScreenshotWindowControls(settings, 'floating');
	await capture(app, settings, 'terminay-settings.png');
	const shortcuts = settings.locator('.settings-nav-item').filter({ hasText: 'Shortcuts' }).first();
	await shortcuts.click();
	await shortcuts.waitFor({ state: 'visible' });
	await capture(app, settings, 'terminay-shortcuts.png');
	await settings.close();

	const remoteControl = await openRoute(app, page, '/?auxiliary=remote-control', 'remote-control', '[data-shared-route-body="connections"]');
	await installScreenshotWindowControls(remoteControl, 'floating');
	await capture(app, remoteControl, 'terminay-remote-access.png');
	await remoteControl.close();
}

async function run() {
	log(`starting group ${selectedGroup}`);
	// macOS Unix-domain sockets have a short path limit. /var/folders plus a
	// worktree path can push the MCP control socket beyond it before the UI opens.
	const userDataRoot = process.platform === 'darwin' ? '/tmp' : os.tmpdir();
	const userDataDir = await mkdtemp(path.join(userDataRoot, 'terminay-docs-user-data-'));
	const seededWorkspace = await seedWorkspace();
	let app;
	try {
		if (selectedGroup === 'all') await rm(outputDir, { force: true, recursive: true });
		await mkdir(outputDir, { recursive: true });
		log('launching Electron');
		app = await withHeartbeat('Electron still launching', () => electron.launch({
			args: ['--force-device-scale-factor=2', '--high-dpi-support=1', '.'],
			env: {
				...process.env,
				CI: '1',
				TERMINAY_TEST: '1',
				TERMINAY_TEST_ALLOW_UNAVAILABLE_WEBRTC_UI: '1',
				TERMINAY_USER_DATA_DIR: userDataDir,
			},
		}));
		log('Electron launched');
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
		log('workspace projects ready');
		if (wantsGroup('workspace')) await captureWorkspaceGroup(app, mainWindow, seededWorkspace.workspace);
		if (wantsGroup('agents')) await captureAgentsGroup(app, mainWindow, seededWorkspace.workspace);
		if (wantsGroup('files')) await captureFilesGroup(app, mainWindow);
		if (wantsGroup('git')) await captureGitGroup(app, mainWindow);
		if (wantsGroup('chrome')) await captureChromeGroup(app, mainWindow);
		log('done');
	} finally {
		if (app) await app.close();
		await rm(userDataDir, { force: true, recursive: true });
		await rm(seededWorkspace.root, { force: true, recursive: true });
	}
}

await run();
