/**
 * A native window activation can restore focus to the previously active xterm
 * after a pointer down has selected a different Dockview terminal. Keep the
 * recovery scoped to the terminal that received that fresh pointer down. This
 * is presentation-only: it must not write to, resize, or otherwise touch the
 * terminal transport.
 */

export const TERMINAL_CREATION_CHROME_SELECTOR =
	'.terminay-add-tab-button, .project-tab-add, .project-tab-add-box, .project-environment-split';

type ClosableElement = {
	closest?: (selector: string) => unknown;
	nodeName?: string;
};

export function shouldClaimCreatedTerminalFocus(
	activeElement: unknown,
): boolean {
	if (activeElement == null) return true;
	if (typeof activeElement !== 'object') return false;
	const candidate = activeElement as ClosableElement;
	if (candidate.nodeName === 'BODY') return true;
	return (
		typeof candidate.closest === 'function' &&
		candidate.closest(TERMINAL_CREATION_CHROME_SELECTOR) != null
	);
}

export function releaseCreatedTerminalChromeFocus(
	activeElement: {
		blur: () => void;
		closest?: (selector: string) => unknown;
	} | null,
): void {
	if (
		activeElement !== null &&
		typeof activeElement.closest === 'function' &&
		activeElement.closest(TERMINAL_CREATION_CHROME_SELECTOR) != null
	) {
		activeElement.blur();
	}
}

export function shouldRestoreTerminalFocusAfterWindowActivation(
	pointerDownAt: unknown,
	now: unknown,
	activationWindowMs = 600,
): boolean {
	if (
		typeof pointerDownAt !== 'number' ||
		!Number.isFinite(pointerDownAt) ||
		typeof now !== 'number' ||
		!Number.isFinite(now) ||
		typeof activationWindowMs !== 'number' ||
		!Number.isFinite(activationWindowMs) ||
		activationWindowMs <= 0
	) {
		return false;
	}

	const elapsed = now - pointerDownAt;
	return elapsed >= 0 && elapsed < activationWindowMs;
}
