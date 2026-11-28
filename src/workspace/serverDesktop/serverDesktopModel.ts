/**
 * What the server desktop window says. Pure: the server owns the desktop's
 * state and who controls it, and these turn what it published into words.
 */

import type {
	ServerDesktopController,
	ServerDesktopMode,
	ServerDesktopStatus,
} from '@terminay/client-core';

/** The steps of setup, in the order they happen. */
export const SETUP_STEPS = [
	{ step: 'waiting', label: 'Waiting for the package manager' },
	{ step: 'preparing', label: 'Reading the package lists' },
	{ step: 'downloading', label: 'Downloading packages' },
	{ step: 'installing', label: 'Installing packages' },
	{ step: 'starting', label: 'Starting the desktop' },
] as const;

export type SetupStepName = (typeof SETUP_STEPS)[number]['step'];

export type SetupStepState = 'done' | 'current' | 'pending' | 'failed';

/** Each step's place relative to the one setup is on, or failed at. */
export function setupStepStates(
	current: SetupStepName | undefined,
	failed = false,
): readonly { step: SetupStepName; label: string; state: SetupStepState }[] {
	const at = SETUP_STEPS.findIndex((entry) => entry.step === current);
	return SETUP_STEPS.map((entry, index) => ({
		...entry,
		state:
			at < 0
				? 'pending'
				: index < at
					? 'done'
					: index === at
						? failed
							? 'failed'
							: 'current'
						: 'pending',
	}));
}

/** A fraction as a whole percentage, kept inside 0 to 100. */
export function setupPercent(fraction: number): number {
	if (!Number.isFinite(fraction)) return 0;
	return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

/** The header control's name, which says what activating it does. */
export function serverDesktopButtonLabel(serverLabel: string): string {
	return `Show desktop of ${serverLabel}`;
}

/** Who has the desktop, as this device sees it. */
export function controlLine(
	mode: ServerDesktopMode | undefined,
	controller: ServerDesktopController | null,
): string {
	if (mode === 'control') return 'You control this desktop.';
	if (mode === undefined) return 'Opening the desktop…';
	if (controller === null) return 'Viewing. Nobody controls this desktop.';
	return `Viewing. ${deviceLabel(controller)} controls this desktop.`;
}

export function deviceLabel(controller: ServerDesktopController): string {
	const name = controller.deviceName.trim();
	return name.length > 0 ? name : 'Another device';
}

/**
 * Whether a controller the server announced means this device lost control:
 * it held control, did not ask for the change, and the new controller is
 * someone else.
 */
export function controlWasTaken(options: {
	readonly mode: ServerDesktopMode | undefined;
	/** This device's own id, as the server named it when it gave control. */
	readonly ownClientId: string | undefined;
	/** A request of this device's own is in flight. */
	readonly requesting: boolean;
	readonly controller: ServerDesktopController | null;
}): boolean {
	return (
		options.mode === 'control' &&
		!options.requesting &&
		options.controller !== null &&
		options.ownClientId !== undefined &&
		options.controller.clientId !== options.ownClientId
	);
}

/** The confirmation before a desktop with open program windows is turned off. */
export function turnOffConfirmation(windows: number | undefined): string {
	if (windows === undefined || windows <= 0)
		return 'Programs open on the desktop will close. Turn it off?';
	return windows === 1
		? '1 program window is open on the desktop and will close. Turn it off?'
		: `${windows} program windows are open on the desktop and will close. Turn it off?`;
}

/** The window's title: the desktop belongs to a server, not a project. */
export function serverDesktopTitle(serverLabel: string): string {
	return `Desktop · ${serverLabel}`;
}

/** Whether the server can be asked to act on this state, and how. */
export function setupAction(
	status: ServerDesktopStatus,
): 'setup' | 'command' | 'check' | 'none' {
	if (status.state === 'needs-setup')
		return status.setup === 'server' ? 'setup' : 'command';
	if (status.state === 'failed') {
		// A failed start, not a failed setup: asking again starts it again.
		if (status.step === undefined || status.step === 'starting') return 'check';
		return status.setup === 'server' ? 'setup' : 'command';
	}
	return 'none';
}
