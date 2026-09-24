import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	activeTerminalPanel,
	settledTerminalSessionId,
} from './support/terminal-session';

/**
 * Home's Automations section: the list, the editor, run history with the
 * automation space's terminals, the missed-run notice, and the overview
 * widgets that lead into it.
 */

const AUTOMATION_SPACE_ID = 'system:automations';

const homeControl = (page: Page) =>
	page.getByRole('button', { name: 'Home', exact: true });
const sectionTab = (page: Page, section: 'home' | 'tabs' | 'automations') =>
	page.locator(`[data-terminay-home-section-tab="${section}"]`);
const automations = (page: Page) => page.locator('[data-terminay-automations]');
const editor = (page: Page) => page.locator('[data-terminay-automation-editor]');
const field = (page: Page, name: string) =>
	editor(page).locator(`[data-terminay-automation-field="${name}"]`);
const rowNamed = (page: Page, name: string): Locator =>
	page
		.locator('[data-terminay-automation-row]')
		.filter({ has: page.getByText(name, { exact: true }) });

async function openAutomations(page: Page): Promise<void> {
	await homeControl(page).click();
	await sectionTab(page, 'automations').click();
	await expect(automations(page)).toBeVisible();
	// The local server serves automations, so the list, not an explanation.
	await expect(
		page.locator('[data-terminay-automations-unsupported]'),
	).toHaveCount(0);
	await expect(page.locator('[data-terminay-automation-new]')).toBeVisible();
}

async function createCommandAutomation(
	page: Page,
	options: { name: string; command: string; keepTerminal?: boolean },
): Promise<string> {
	await page.locator('[data-terminay-automation-new]').click();
	await expect(editor(page)).toBeVisible();
	await field(page, 'name').fill(options.name);
	await field(page, 'command').fill(options.command);
	if (options.keepTerminal === true)
		await field(page, 'keep-terminal').check();
	await page.locator('[data-terminay-automation-save]').click();
	const row = rowNamed(page, options.name);
	await expect(row).toBeVisible();
	const id = await row.getAttribute('data-terminay-automation-row');
	if (id === null) throw new Error('Saved automation has no id');
	return id;
}

async function resize(
	page: Page,
	electronApp: ElectronApplication,
	bounds: { x: number; y: number; width: number; height: number },
): Promise<void> {
	const nativeWindow = await electronApp.browserWindow(page);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, bounds);
}

test.describe('Automations section', () => {
	test('creating a scheduled automation lists it in plain words with its next run', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		// One server attached: no selector.
		await expect(
			mainWindow.locator('[data-terminay-automations-server-selector]'),
		).toHaveCount(0);
		await expect(automations(mainWindow)).toContainText('No automations yet.');

		await mainWindow.locator('[data-terminay-automation-new]').click();
		await field(mainWindow, 'name').fill('Hourly report');
		// A preset writes the expression, and the preview reads it back.
		await field(mainWindow, 'preset').selectOption('hourly');
		await expect(field(mainWindow, 'cron')).toHaveValue('0 * * * *');
		const preview = editor(mainWindow).locator(
			'[data-terminay-automation-schedule-preview]',
		);
		await expect(
			preview.locator('[data-terminay-automation-schedule-description]'),
		).toHaveText('Every hour, on the hour');
		await expect(preview.locator('li')).toHaveCount(5);
		// A raw expression is accepted too, and described the same way.
		await field(mainWindow, 'cron').fill('0 9 * * 1-5');
		await expect(field(mainWindow, 'preset')).toHaveValue('weekdays');
		await field(mainWindow, 'cron').fill('0 * * * *');
		await field(mainWindow, 'command').fill('echo report');
		await mainWindow.locator('[data-terminay-automation-save]').click();

		const row = rowNamed(mainWindow, 'Hourly report');
		await expect(row).toBeVisible();
		await expect(row.locator('[data-terminay-automation-trigger]')).toHaveText(
			'Every hour, on the hour',
		);
		await expect(
			row.locator('[data-terminay-automation-next-run]'),
		).toContainText('Next');
		await expect(row).toContainText('Never run');

		// Disabling is a server change: the next run goes, and it survives a reload.
		const enabled = row.locator('[data-terminay-automation-enabled]');
		await expect(enabled).toBeChecked();
		await enabled.click({ force: true });
		await expect(enabled).not.toBeChecked();
		await expect(row.locator('[data-terminay-automation-next-run]')).toHaveCount(
			0,
		);
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect(automations(mainWindow)).toBeVisible();
		await expect(
			rowNamed(mainWindow, 'Hourly report').locator(
				'[data-terminay-automation-enabled]',
			),
		).not.toBeChecked();
	});

	test('an event automation offers terminal actions and saves text to write', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await mainWindow.locator('[data-terminay-automation-new]').click();
		await field(mainWindow, 'name').fill('Keep going');

		// A schedule has no subject terminal: only "Run a command" is offered.
		const action = field(mainWindow, 'action');
		await expect(action.locator('option')).toHaveText(['Run a command']);

		await editor(mainWindow)
			.locator('[data-terminay-automation-trigger-kind="event"]')
			.check();
		await field(mainWindow, 'event').selectOption('project.opened');
		await expect(action.locator('option')).toHaveText(['Run a command']);
		await field(mainWindow, 'event').selectOption('agent.needsInput');
		await expect(action.locator('option')).toHaveText([
			'Run a command',
			'Run a Macro on the terminal',
			'Write text into the terminal',
		]);
		await action.selectOption('writeText');
		await field(mainWindow, 'text').fill('continue');
		await mainWindow.locator('[data-terminay-automation-save]').click();

		const row = rowNamed(mainWindow, 'Keep going');
		await expect(row.locator('[data-terminay-automation-trigger]')).toHaveText(
			'When an agent needs input',
		);
		// An event trigger has no next run.
		await expect(row.locator('[data-terminay-automation-next-run]')).toHaveCount(
			0,
		);
		await expect(
			mainWindow.locator('[data-terminay-automation-detail]'),
		).toContainText('Write text into the terminal');
	});

	test('the server’s refusal is shown beside the form', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await mainWindow.locator('[data-terminay-automation-new]').click();
		await field(mainWindow, 'name').fill('Wrong trigger');
		await editor(mainWindow)
			.locator('[data-terminay-automation-trigger-kind="event"]')
			.check();
		await field(mainWindow, 'event').selectOption('agent.needsInput');
		await field(mainWindow, 'action').selectOption('writeText');
		await field(mainWindow, 'text').fill('continue');
		// Moving to a schedule keeps the chosen action, flagged, and saving it
		// is the server's to refuse.
		await editor(mainWindow)
			.locator('[data-terminay-automation-trigger-kind="schedule"]')
			.check();
		await expect(
			editor(mainWindow).locator('[data-terminay-automation-combination-hint]'),
		).toBeVisible();
		await mainWindow.locator('[data-terminay-automation-save]').click();
		await expect(
			editor(mainWindow).locator('[data-terminay-automation-error]'),
		).toHaveText('Scheduled triggers have no subject terminal.');
		await expect(rowNamed(mainWindow, 'Wrong trigger')).toHaveCount(0);

		// An unparseable schedule is refused naming the field at fault.
		await field(mainWindow, 'action').selectOption('runCommand');
		await field(mainWindow, 'command').fill('true');
		await field(mainWindow, 'cron').fill('61 * * * *');
		await expect(
			editor(mainWindow).locator(
				'[data-terminay-automation-schedule-preview="invalid"]',
			),
		).toContainText(/minute/i);
		await mainWindow.locator('[data-terminay-automation-save]').click();
		await expect(
			editor(mainWindow).locator('[data-terminay-automation-error]'),
		).toContainText(/minute/i);
		await expect(rowNamed(mainWindow, 'Wrong trigger')).toHaveCount(0);
	});

	test('an agent state change updates the overview without leaving Home', async ({
		mainWindow,
	}) => {
		const terminalSessionId = await settledTerminalSessionId(
			activeTerminalPanel(mainWindow),
		);
		const pid = await mainWindow.evaluate(async (id) => {
			if (!window.terminayAgentStatusTest)
				throw new Error('Agent status test seam is unavailable');
			return await window.terminayAgentStatusTest.terminalShellPid(id);
		}, terminalSessionId);
		if (pid === null) throw new Error('Terminal shell pid is unavailable');
		const publish = (status: string) =>
			mainWindow.evaluate(async (value) => {
				if (!window.terminayAgentStatusTest)
					throw new Error('Agent status test seam is unavailable');
				return await window.terminayAgentStatusTest.publishSessions({
					sourceId: 'com.terminay.e2e/agents',
					harnesses: [{ id: 'codex', displayName: 'Codex' }],
					publication: { upserts: [value] },
				});
			}, {
				harness: 'codex',
				pid,
				cwd: '/tmp',
				id: 'codex-home-overview',
				title: 'Overview agent',
				status,
			});

		await homeControl(mainWindow).click();
		await sectionTab(mainWindow, 'home').click();
		const working = mainWindow.locator(
			'[data-terminay-home-agent-group="working"] .home-widget__number',
		);
		const needsYou = mainWindow.locator(
			'[data-terminay-home-agent-group="needsYou"] .home-widget__number',
		);
		await expect(working).toHaveText('0');
		expect(await publish('running')).toBe(true);
		await expect(working).toHaveText('1');
		expect(await publish('waiting')).toBe(true);
		await expect(needsYou).toHaveText('1');
		await expect(working).toHaveText('0');
		await expect(mainWindow.locator('[data-terminay-home-overview]')).toBeVisible();
	});

	test('choosing a section in the narrow drawer does not forget the sidebar', async ({
		electronApp,
		mainWindow,
	}) => {
		await homeControl(mainWindow).click();
		await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toBeVisible();
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 600,
			height: 760,
		});
		await sectionTab(mainWindow, 'automations').click();
		// The drawer closes itself over the chosen section...
		await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toHaveCount(0);
		await expect(automations(mainWindow)).toBeVisible();
		// ...but the device still remembers a visible sidebar.
		await resize(mainWindow, electronApp, {
			x: 40,
			y: 40,
			width: 1280,
			height: 800,
		});
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect(mainWindow.locator('[data-terminay-home-sidebar]')).toBeVisible();
	});
});

/*
 * Runs need the server's executor. These start real runs of `echo`.
 */
test.describe('Automation runs', () => {
	test('run now shows the output tail after the run terminal closes, and the overview leads back to it', async ({
		mainWindow,
	}) => {
		await openAutomations(mainWindow);
		await createCommandAutomation(mainWindow, {
			name: 'Echo once',
			command: 'echo automation-e2e-tail',
		});
		await mainWindow.locator('[data-terminay-automation-run-now]').click();
		const detail = mainWindow.locator('[data-terminay-automation-run-detail]');
		await expect(detail).toBeVisible();
		await expect(
			detail.locator('[data-terminay-automation-outcome]'),
		).toHaveAttribute('data-terminay-automation-outcome', 'succeeded', {
			timeout: 20_000,
		});
		await expect(detail.locator('[data-terminay-automation-run-exit-code]')).toHaveText(
			'0',
		);
		await expect(detail.locator('[data-terminay-automation-run-tail]')).toContainText(
			'automation-e2e-tail',
		);
		// "Keep terminal after run" is off: the terminal is gone, the tail stays.
		await expect(
			mainWindow.locator('[data-terminay-automation-terminal]'),
		).toHaveCount(0);
		const runId = await detail.getAttribute('data-terminay-automation-run-detail');
		if (runId === null) throw new Error('Run detail has no run id');

		// The recent-runs widget opens that run in the Automations section.
		await sectionTab(mainWindow, 'home').click();
		const recent = mainWindow.locator(`[data-terminay-home-run="${runId}"]`);
		await expect(recent).toHaveAttribute(
			'data-terminay-home-run-outcome',
			'success',
		);
		await recent.click();
		await expect(mainWindow.locator('[data-terminay-home-view]')).toHaveAttribute(
			'data-terminay-home-view',
			'automations',
		);
		await expect(
			mainWindow.locator(`[data-terminay-automation-run-detail="${runId}"]`),
		).toBeVisible();
	});

	test('a kept run terminal is shown in Automations and never as a project', async ({
		mainWindow,
	}) => {
		const projectTabs = mainWindow.locator('.project-tab');
		const tabsBefore = await projectTabs.count();
		await openAutomations(mainWindow);
		await createCommandAutomation(mainWindow, {
			name: 'Echo and keep',
			command: 'echo automation-e2e-kept',
			keepTerminal: true,
		});
		await mainWindow.locator('[data-terminay-automation-run-now]').click();
		await expect(
			mainWindow.locator('[data-terminay-automation-run-detail] [data-terminay-automation-outcome]'),
		).toHaveAttribute('data-terminay-automation-outcome', 'succeeded', {
			timeout: 20_000,
		});

		// The kept terminal is listed under its run and stays viewable after
		// its process exited: a read-only terminal with its output and exit.
		const kept = mainWindow.locator('[data-terminay-automation-terminal]');
		await expect(kept).toHaveCount(1);
		await expect(kept).toContainText('Exited');
		const view = mainWindow.locator('[data-terminay-automation-exited-terminal]');
		await expect(view).toHaveAttribute(
			'data-terminay-automation-exited-terminal-state',
			'ready',
			{ timeout: 15_000 },
		);
		await expect(view.locator('.xterm-rows')).toContainText(
			'automation-e2e-kept',
		);
		await expect(
			view.locator('[data-terminay-automation-exited-terminal-exit]'),
		).toHaveText('Exited with code 0 · read-only');

		// The automation space is never a project: not in the tab bar, not in Tabs.
		await expect(projectTabs).toHaveCount(tabsBefore);
		await expect(
			mainWindow.locator(`.project-tab[data-project-id="${AUTOMATION_SPACE_ID}"]`),
		).toHaveCount(0);
		await sectionTab(mainWindow, 'tabs').click();
		await expect(mainWindow.locator('[data-terminay-dashboard]')).toBeVisible();
		await expect(
			mainWindow.locator(
				`[data-terminay-dashboard-project="${AUTOMATION_SPACE_ID}"]`,
			),
		).toHaveCount(0);
		await expect(mainWindow.locator('[data-terminay-dashboard]')).not.toContainText(
			'Echo and keep',
		);

		// Closing it from its view closes it on the server.
		await sectionTab(mainWindow, 'automations').click();
		await expect(view.locator('.xterm-rows')).toContainText(
			'automation-e2e-kept',
		);
		await view.locator('[data-terminay-automation-exited-terminal-close]').click();
		await expect(kept).toHaveCount(0);
		await expect(view).toHaveCount(0);
	});
});

/*
 * Missed schedules: the data root is seeded before Terminay starts, as a
 * server that was stopped over a scheduled time leaves it.
 */
const missed = test.extend({
	userDataDir: async ({ userDataDir }, use) => {
		const now = Date.now();
		const automation = (id: string, name: string) => ({
			id,
			name,
			enabled: true,
			// Far enough away that nothing comes due during the test.
			trigger: { kind: 'schedule', cron: '0 0 1 1 *' },
			action: {
				kind: 'runCommand',
				command: `echo ${id}`,
				maxDurationSeconds: 60,
			},
			settings: {
				keepTerminalAfterRun: false,
				recordSession: false,
				cooldownSeconds: 60,
			},
			evaluatedThrough: now,
		});
		await writeFile(
			path.join(userDataDir, 'automations.v1.json'),
			JSON.stringify({
				schemaVersion: 1,
				revision: 1,
				cursor: '1',
				automations: [
					automation('missed-report', 'Morning report'),
					automation('missed-sync', 'Sync mirrors'),
				],
			}),
			{ mode: 0o600 },
		);
		await writeFile(
			path.join(userDataDir, 'automation-runs.v1.json'),
			JSON.stringify({
				schemaVersion: 1,
				runs: {},
				missed: [
					{
						automationId: 'missed-report',
						missedCount: 3,
						latestDueAt: now - 60 * 60 * 1000,
					},
					{
						automationId: 'missed-sync',
						missedCount: 1,
						latestDueAt: now - 2 * 60 * 60 * 1000,
					},
				],
			}),
			{ mode: 0o600 },
		);
		await use(userDataDir);
	},
});

missed.describe('Missed-run notice', () => {
	missed('lists what was missed on attach, and dismissing clears it', async ({
		mainWindow,
	}) => {
		const notice = mainWindow.locator('[data-terminay-missed-runs]');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute('role', 'dialog');
		await expect(notice).toContainText(
			'These automations were scheduled to run while Terminay was closed',
		);
		await expect(notice.locator('[data-terminay-missed-run]')).toHaveCount(2);
		await expect(
			notice.locator('[data-terminay-missed-run="missed-report"]'),
		).toContainText('Morning report');
		await expect(
			notice.locator('[data-terminay-missed-run="missed-report"]'),
		).toContainText('3 times');
		await notice.locator('[data-terminay-missed-dismiss]').click();
		await expect(notice).toHaveCount(0);
		await mainWindow.reload({ waitUntil: 'domcontentloaded' });
		await expect(mainWindow.locator('.project-tabbar')).toBeVisible();
		await expect(mainWindow.locator('[data-terminay-missed-runs]')).toHaveCount(0);
	});

	missed('running one entry from the notice runs it and clears only that entry', async ({
		mainWindow,
	}) => {
		const notice = mainWindow.locator('[data-terminay-missed-runs]');
		await expect(notice.locator('[data-terminay-missed-run]')).toHaveCount(2);
		await notice.locator('[data-terminay-missed-run-now="missed-report"]').click();
		await expect(
			notice.locator('[data-terminay-missed-run="missed-report"]'),
		).toHaveCount(0);
		await expect(
			notice.locator('[data-terminay-missed-run="missed-sync"]'),
		).toBeVisible();
		await notice.locator('[data-terminay-missed-dismiss]').click();
		await expect(notice).toHaveCount(0);
		await openAutomations(mainWindow);
		await rowNamed(mainWindow, 'Morning report')
			.locator('.automations-row__main')
			.click();
		await expect(
			mainWindow.locator('[data-terminay-automation-run]'),
		).toHaveCount(1);
	});
});
