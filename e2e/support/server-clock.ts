import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication } from '@playwright/test';
import { expect } from '../fixtures';

/*
 * The clock a test holds for the embedded server (electron/testServerClock.ts).
 * Activity and notifications are specified in time. A test tagged
 * HELD_SERVER_CLOCK (and every test in terminal-signals.spec.ts) runs the
 * server on this clock: its time stands still until the test advances it, so a
 * period ends exactly where the test says and never while it is still acting.
 * Where a terminal's output has to come after something the test does, the
 * command waits on a gate the test opens, instead of sleeping and hoping the
 * test is done by then.
 */

/** What a terminal does within a second of the user's own input is theirs. */
export const INPUT_WINDOW_MS = 1_000;

/** A plain shell is reported finished once its input has been quiet this long. */
export const INPUT_QUIET_MS = 2_000;

export type TestServerClock = {
	advance(milliseconds: number): void;
	notificationSettleMs: number;
	notifications(): { pending: number; published: number; revision: number };
	activity(sessionId: string):
		| {
				acknowledged: boolean;
				attention: boolean;
				revision: number;
				source: string;
				status: string;
		  }
		| undefined;
	output(sessionId: string): string;
	input(sessionId: string): string;
};

type WithTestServerClock = typeof globalThis & {
	__terminayTestServerClock: TestServerClock;
};

export function serverClock(electronApp: ElectronApplication) {
	return {
		advance: (milliseconds: number) =>
			electronApp.evaluate(
				(_electron, ms) =>
					(globalThis as WithTestServerClock).__terminayTestServerClock.advance(
						ms,
					),
				milliseconds,
			),
		settleMs: () =>
			electronApp.evaluate(
				() =>
					(globalThis as WithTestServerClock).__terminayTestServerClock
						.notificationSettleMs,
			),
		notifications: () =>
			electronApp.evaluate(() =>
				(
					globalThis as WithTestServerClock
				).__terminayTestServerClock.notifications(),
			),
		activity: (sessionId: string) =>
			electronApp.evaluate(
				(_electron, id) =>
					(
						globalThis as WithTestServerClock
					).__terminayTestServerClock.activity(id),
				sessionId,
			),
		output: (sessionId: string) =>
			electronApp.evaluate(
				(_electron, id) =>
					(globalThis as WithTestServerClock).__terminayTestServerClock.output(
						id,
					),
				sessionId,
			),
		input: (sessionId: string) =>
			electronApp.evaluate(
				(_electron, id) =>
					(globalThis as WithTestServerClock).__terminayTestServerClock.input(
						id,
					),
				sessionId,
			),
	};
}

/**
 * The server has every keystroke of a typed command, Enter included. Typing
 * reaches the server on its own path, so until then the user is, as far as the
 * server's clock is concerned, still typing.
 */
export async function commandArrived(
	electronApp: ElectronApplication,
	sessionId: string,
	command: string,
): Promise<void> {
	const typed = command.endsWith('\r') ? command : `${command}\r`;
	await expect
		.poll(() => serverClock(electronApp).input(sessionId))
		.toContain(typed);
}

/** Advance the server's clock through the whole notification settle period. */
export async function endSettlePeriod(
	electronApp: ElectronApplication,
): Promise<void> {
	const clock = serverClock(electronApp);
	await clock.advance(await clock.settleMs());
}

const execFileAsync = promisify(execFile);
let gates = 0;

/**
 * A point a shell command waits at until the test opens it. `wait` is the shell
 * text that blocks on it; `open` lets the command go on.
 */
export async function commandGate(
	directory: string,
): Promise<{ wait: string; open: () => Promise<void> }> {
	gates += 1;
	const fifo = path.join(directory, `terminal-gate-${gates}.fifo`);
	await execFileAsync('mkfifo', [fifo]);
	return {
		wait: `read _ < '${fifo}'`,
		// Opening a FIFO for writing completes once the waiting shell has it open.
		open: () => writeFile(fifo, '\n'),
	};
}

export { HELD_SERVER_CLOCK } from '../fixtures';
