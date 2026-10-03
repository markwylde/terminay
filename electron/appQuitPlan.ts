import type { CloseConfirmationDialogOptions } from './mainWindowCloseConfirmation';

/**
 * What quitting Terminay does to its terminals.
 *
 * With a session holder, terminals outlive the application, so quitting keeps
 * them and the only question worth asking is whether to end them instead. An
 * update restart never asks: nothing is lost by it. Without a holder, quitting
 * ends every terminal, and the confirmation is the one that has always applied.
 */
export type AppQuitPlan =
	/** Quit now; terminals keep running in the background. */
	| 'quit-keeping-terminals'
	/** Ask whether to keep terminals, end them, or stay. */
	| 'ask-keep-or-end'
	/** Quit now; there is nothing running to lose. */
	| 'quit'
	/** Ask before ending running processes. */
	| 'ask-before-ending';

export interface AppQuitFacts {
	/** Whether terminals are held outside this process. */
	readonly keepsTerminals: boolean;
	/** Whether this quit is a Restart to update. */
	readonly restartToUpdate: boolean;
	/** Terminals with a foreground process other than their shell. */
	readonly runningTerminalCount: number;
}

export function planAppQuit(facts: AppQuitFacts): AppQuitPlan {
	if (!facts.keepsTerminals)
		return facts.runningTerminalCount > 0 ? 'ask-before-ending' : 'quit';
	if (facts.restartToUpdate) return 'quit-keeping-terminals';
	return facts.runningTerminalCount > 0
		? 'ask-keep-or-end'
		: 'quit-keeping-terminals';
}

export type AppQuitChoice = 'keep' | 'end' | 'cancel';

const KEEP_BUTTON = 0;
const END_BUTTON = 1;
const CANCEL_BUTTON = 2;

/** Dismissing the dialog is Cancel, as is any response it does not offer. */
export function appQuitChoice(response: number): AppQuitChoice {
	if (response === KEEP_BUTTON) return 'keep';
	if (response === END_BUTTON) return 'end';
	return 'cancel';
}

export function createAppQuitConfirmationDialog(
	runningTerminalCount: number,
	limitMs: number | null,
	platform: NodeJS.Platform = process.platform,
): CloseConfirmationDialogOptions {
	const terminalLabel =
		runningTerminalCount === 1 ? 'terminal has' : 'terminals have';
	return {
		type: 'warning',
		buttons: ['Quit and Keep Terminals', 'Quit and End Terminals', 'Cancel'],
		defaultId: KEEP_BUTTON,
		cancelId: CANCEL_BUTTON,
		noLink: true,
		message: `${runningTerminalCount} ${terminalLabel} a process running`,
		detail: `Terminals you keep carry on in the background ${describeBackgroundLimit(limitMs, platform)}, and come back as they were when you reopen Terminay. Ending them closes their tabs.`,
	};
}

/** The limit as it reads in a sentence: "for up to 5 minutes". */
export function describeBackgroundLimit(
	limitMs: number | null,
	platform: NodeJS.Platform = process.platform,
): string {
	if (limitMs === null)
		return `until this ${platform === 'darwin' ? 'Mac' : 'computer'} restarts`;
	const minutes = Math.round(limitMs / 60_000);
	if (minutes < 1) return 'for under a minute';
	if (minutes < 60)
		return `for up to ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
	const hours = Math.round(minutes / 60);
	return `for up to ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
