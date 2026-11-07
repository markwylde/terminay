import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';
import {
	commandArrived,
	HELD_SERVER_CLOCK,
	INPUT_QUIET_MS,
	INPUT_WINDOW_MS,
	serverClock,
} from './support/server-clock';
import { submitTerminalCommand } from './support/terminal';
import { settledTerminalSessionId } from './support/terminal-session';

/*
 * Reported from the phone PWA: a terminal idle at a shell prompt in another
 * project flashed working, then done, and raised a finished notification,
 * every time the viewport changed size (which on a phone is nearly every time
 * the switcher opens). Every mounted terminal refit and resized its PTY, even
 * in a background project, and the shell's redraw for the new size read as
 * raw-output work.
 *
 * Contract: a terminal off screen does not resize its PTY (terminal-workspace,
 * "Terminals off screen do not resize their PTY"), and the redraw that answers
 * a resize is not activity (terminal-activity-signals, "Output that follows a
 * resize is not raw-output activity").
 */

const WIDE = { x: 40, y: 40, width: 1280, height: 800 } as const;
const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
const PERIOD = INPUT_WINDOW_MS + INPUT_QUIET_MS;

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

const switcherOf = (page: Page) =>
	page.getByRole('dialog', { name: 'Switch terminal' });

type Clock = ReturnType<typeof serverClock>;

/** Wait until the PTY has stopped printing, and return all it has printed. */
async function quietOutput(clock: Clock, sessionId: string): Promise<string> {
	let last: string | undefined;
	await expect
		.poll(
			async () => {
				const output = await clock.output(sessionId);
				const stable = output === last;
				last = output;
				return stable;
			},
			{ intervals: [500] },
		)
		.toBe(true);
	return last ?? '';
}

test('an idle shell in a background project stays idle through resizes and the switcher', {
	tag: HELD_SERVER_CLOCK,
}, async ({ electronApp, mainWindow }) => {
	const clock = serverClock(electronApp);
	const projectTabs = mainWindow.locator('.project-tab');
	const activePanel = mainWindow.locator(
		'.project-workspace--active .terminal-panel:visible',
	);

	// Two projects. The second is where the user works; the first holds
	// the terminal that will sit idle.
	await resize(mainWindow, electronApp, WIDE);
	await createStartedProject(mainWindow);
	await expect(projectTabs).toHaveCount(2);
	await projectTabs.first().click();
	await expect(projectTabs.first()).toHaveClass(/project-tab--active/);
	const idleProjectId = await mainWindow
		.locator('.app-shell')
		.getAttribute('data-terminay-active-project-id');

	// Settle the idle terminal the way a user does: run one command in it
	// and let it go quiet (spec: "Sessions settle before fallback finished
	// activity"), so later raw output could raise working and then finished.
	await expect(activePanel).toHaveCount(1);
	const idleSessionId = await settledTerminalSessionId(activePanel);
	await activePanel.click();
	await submitTerminalCommand(mainWindow, 'true', activePanel);
	await commandArrived(electronApp, idleSessionId, 'true');
	await clock.advance(PERIOD);
	await expect
		.poll(async () => {
			const now = await clock.activity(idleSessionId);
			return now?.status === 'idle' && now.acknowledged;
		})
		.toBe(true);
	const settled = await quietOutput(clock, idleSessionId);
	const idle = await clock.activity(idleSessionId);
	const notifications = (await clock.notifications()).revision;

	// The user moves to the other project and works there.
	await projectTabs.nth(1).click();
	await expect(projectTabs.nth(1)).toHaveClass(/project-tab--active/);
	await activePanel.click();

	// The viewport changes size, as a phone's does whenever its browser
	// chrome or keyboard comes and goes. The idle terminal is off screen,
	// so its PTY is not resized and its shell redraws nothing.
	await resize(mainWindow, electronApp, PHONE);
	await expect(
		mainWindow.locator('[data-compact-chrome="true"]'),
	).toBeVisible();
	await clock.advance(PERIOD);
	expect(
		JSON.stringify(
			(await quietOutput(clock, idleSessionId)).slice(settled.length),
		),
		'output from the background shell when the viewport resized',
	).toBe('""');
	expect(await clock.activity(idleSessionId)).toEqual(idle);

	// Opening the switcher and closing it changes nothing either.
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	const switcher = switcherOf(mainWindow);
	await expect(switcher).toBeVisible();
	await mainWindow.keyboard.press('Escape');
	await expect(switcher).toHaveCount(0);
	await clock.advance(PERIOD);
	expect(
		JSON.stringify(
			(await quietOutput(clock, idleSessionId)).slice(settled.length),
		),
		'output from the background shell when the switcher opened',
	).toBe('""');
	expect(await clock.activity(idleSessionId)).toEqual(idle);

	// Bringing the project forward fits the terminal to the phone and
	// resizes its PTY once. The shell redraws for the new size, and that
	// redraw is not work.
	await mainWindow.locator('[data-compact-breadcrumb="true"]').click();
	// The drawer lists one project's terminals at a time: pick the
	// project on the rail, then its terminal.
	await switcher
		.locator(`.compact-drawer__rail-item[data-project-id="${idleProjectId}"]`)
		.click();
	await switcher
		.locator(
			`[data-compact-switcher-terminal][data-project-id="${idleProjectId}"]`,
		)
		.click();
	await expect(switcher).toHaveCount(0);
	await expect(mainWindow.locator('.app-shell')).toHaveAttribute(
		'data-terminay-active-project-id',
		idleProjectId ?? '',
	);
	await expect
		.poll(async () => (await clock.output(idleSessionId)).length)
		.toBeGreaterThan(settled.length);
	await quietOutput(clock, idleSessionId);
	await clock.advance(PERIOD);
	const after = await clock.activity(idleSessionId);
	expect(after?.status, 'the redrawn shell is idle').toBe('idle');
	expect(after?.acknowledged, 'the redrawn shell is not finished').toBe(true);
	expect(
		(await clock.notifications()).revision,
		'no finished notification is raised for it',
	).toBe(notifications);
});
