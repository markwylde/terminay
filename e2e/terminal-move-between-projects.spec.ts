import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { typeInVisibleTerminal } from './support/terminal-input';
import {
	activeTerminalSessionId,
	createTerminal,
} from './support/terminal-session';
import { contextMenuItem, submitEditWindow } from './support/ui';

const MOVED_TITLE = 'Move Me';
const LONG_RUNNING_TASK = 'while :; do date +TICK_%s; sleep 1; done\r';

function projectTab(page: Page, title: string) {
	return page
		.locator('.project-tab')
		.filter({ hasText: new RegExp(`^${title}$`) });
}

async function activateProject(page: Page, title: string) {
	await projectTab(page, title).click();
	await expect(page.locator('.project-tab--active')).toContainText(title);
}

/** How many tabs titled `Move Me` each project presents, in project order. */
async function movedTabsByProject(page: Page): Promise<number[]> {
	return await page.evaluate(
		(title) =>
			[...document.querySelectorAll('.project-workspace')].map(
				(workspace) =>
					[...workspace.querySelectorAll('.terminal-tab-title')].filter(
						(tab) => tab.textContent === title,
					).length,
			),
		MOVED_TITLE,
	);
}

async function moveActiveProjectTabTo(page: Page, targetProject: string) {
	const tab = page
		.locator('.project-workspace--active .terminal-tab-content')
		.filter({ hasText: MOVED_TITLE })
		.first();
	await tab.click({ button: 'right' });
	await contextMenuItem(page, 'Move to project').click();
	await contextMenuItem(page, targetProject).click();
	await expect(page.locator('.project-tab--active')).toContainText(
		targetProject,
	);
}

/** The moved terminal's task is still printing into the panel on screen. */
async function expectTaskStillTicking(page: Page, sessionId: string) {
	const rows = page.locator(
		`.project-workspace--active .terminal-panel[data-terminay-terminal-session-id="${sessionId}"] .xterm-rows`,
	);
	await expect(rows).toBeVisible();
	const lastTick = async () =>
		((await rows.textContent()) ?? '').match(/TICK_\d+/gu)?.at(-1) ?? null;
	const before = await lastTick();
	await expect
		.poll(async () => await lastTick(), { timeout: 15_000 })
		.not.toBe(before);
}

/**
 * Three projects, each with a long-running task; project 1 has a second
 * terminal titled `Move Me`. Ends on project 1 with `Move Me` active.
 */
async function arrangeProjects(page: Page): Promise<string> {
	await typeInVisibleTerminal(page, LONG_RUNNING_TASK);
	const movedSessionId = await createTerminal(page);
	await typeInVisibleTerminal(page, LONG_RUNNING_TASK);
	await page
		.locator('.project-workspace--active .terminal-tab-content')
		.last()
		.click({ button: 'right' });
	await contextMenuItem(page, 'Open Settings').click();
	await page.getByPlaceholder('Terminal name').fill(MOVED_TITLE);
	await submitEditWindow(page);
	await expect(
		page
			.locator('.project-workspace--active .terminal-tab-title')
			.filter({ hasText: MOVED_TITLE }),
	).toHaveCount(1);

	for (const title of ['Project 2', 'Project 3']) {
		await page.getByLabel('Create project').click();
		await expect(page.locator('.project-tab--active')).toContainText(title);
		await typeInVisibleTerminal(page, LONG_RUNNING_TASK);
	}

	await activateProject(page, 'Project');
	expect(await activeTerminalSessionId(page)).toBe(movedSessionId);
	return movedSessionId;
}

test.describe('moving a terminal between projects', () => {
	test.setTimeout(180_000);

	let consoleErrors: string[] = [];

	test.beforeEach(({ mainWindow }) => {
		consoleErrors = [];
		mainWindow.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text());
		});
		mainWindow.on('pageerror', (error) => {
			consoleErrors.push(`pageerror: ${error.message}`);
		});
	});

	test.afterEach(async ({ mainWindow }, testInfo) => {
		const banners = await mainWindow
			.locator('.error-banner__message')
			.allTextContents();
		await testInfo.attach('move-diagnostics', {
			body: JSON.stringify(
				{
					banners,
					consoleErrors,
					movedTabsByProject: await movedTabsByProject(mainWindow),
				},
				null,
				2,
			),
			contentType: 'application/json',
		});
		console.log(
			`[move-diagnostics] ${testInfo.title}\n${JSON.stringify({ banners, consoleErrors }, null, 2)}`,
		);
	});

	test('a moved terminal stays only in its new project while projects are switched', async ({
		mainWindow,
	}) => {
		const movedSessionId = await arrangeProjects(mainWindow);
		await moveActiveProjectTabTo(mainWindow, 'Project 2');
		expect(await movedTabsByProject(mainWindow)).toEqual([0, 1, 0]);

		for (const title of ['Project', 'Project 3', 'Project 2', 'Project']) {
			await activateProject(mainWindow, title);
			await mainWindow.waitForTimeout(1_500);
			expect
				.soft(await movedTabsByProject(mainWindow), `after opening ${title}`)
				.toEqual([0, 1, 0]);
		}

		await activateProject(mainWindow, 'Project 2');
		await expectTaskStillTicking(mainWindow, movedSessionId);
		await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
	});

	test('a moved terminal does not reappear in its old project when the workspace next synchronizes', async ({
		mainWindow,
	}) => {
		const movedSessionId = await arrangeProjects(mainWindow);
		await moveActiveProjectTabTo(mainWindow, 'Project 2');
		expect(await movedTabsByProject(mainWindow)).toEqual([0, 1, 0]);

		// Any canonical workspace change makes every client reconcile.
		await createTerminal(mainWindow);
		await mainWindow.waitForTimeout(2_000);
		expect
			.soft(await movedTabsByProject(mainWindow), 'after a workspace change')
			.toEqual([0, 1, 0]);

		await activateProject(mainWindow, 'Project');
		await mainWindow.waitForTimeout(1_500);
		expect
			.soft(await movedTabsByProject(mainWindow), 'after returning to Project')
			.toEqual([0, 1, 0]);

		await activateProject(mainWindow, 'Project 2');
		await mainWindow
			.locator('.project-workspace--active .terminal-tab-content')
			.filter({ hasText: MOVED_TITLE })
			.first()
			.click();
		await expectTaskStillTicking(mainWindow, movedSessionId);
		await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
	});

	test('a terminal moved to another project and back is presented once and keeps running', async ({
		mainWindow,
	}) => {
		const movedSessionId = await arrangeProjects(mainWindow);
		await moveActiveProjectTabTo(mainWindow, 'Project 2');
		await createTerminal(mainWindow);
		await mainWindow.waitForTimeout(2_000);
		expect
			.soft(await movedTabsByProject(mainWindow), 'before moving back')
			.toEqual([0, 1, 0]);
		await activateProject(mainWindow, 'Project 3');
		await activateProject(mainWindow, 'Project 2');
		await mainWindow
			.locator('.project-workspace--active .terminal-tab-content')
			.filter({ hasText: MOVED_TITLE })
			.first()
			.click();

		await moveActiveProjectTabTo(mainWindow, 'Project');
		await mainWindow.waitForTimeout(2_000);
		expect
			.soft(await movedTabsByProject(mainWindow), 'after moving back')
			.toEqual([1, 0, 0]);

		await createTerminal(mainWindow);
		await mainWindow.waitForTimeout(2_000);
		expect
			.soft(await movedTabsByProject(mainWindow), 'after a workspace change')
			.toEqual([1, 0, 0]);

		await mainWindow
			.locator('.project-workspace--active .terminal-tab-content')
			.filter({ hasText: MOVED_TITLE })
			.first()
			.click();
		await expectTaskStillTicking(mainWindow, movedSessionId);
		await expect(mainWindow.locator('.error-banner')).toHaveCount(0);
	});
});
