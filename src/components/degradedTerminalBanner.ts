import { createElement, type ReactElement } from 'react';

import { ErrorBanner } from './ErrorBanner.ts';

/**
 * ADR-0115: a shell kept across a server restart whose temporary directory is
 * gone or read-only. The server cannot give it a new one, but new terminals
 * get a working one, and this says exactly that. It is the workspace's usual
 * dismissable error bar, across the top of the panel: it takes no focus and
 * the shell keeps taking input, because it may still be doing useful work.
 */
export const DEGRADED_TERMINAL_MESSAGE =
	"This terminal's temporary directory is no longer usable. New terminals are not affected.";

export function degradedTerminalBanner(
	degraded: string | undefined,
	onDismiss: () => void,
): ReactElement | null {
	if (degraded !== 'tmp-unusable') return null;
	return createElement(ErrorBanner, {
		onDismiss,
		'data-degraded': degraded,
		children: DEGRADED_TERMINAL_MESSAGE,
	});
}
