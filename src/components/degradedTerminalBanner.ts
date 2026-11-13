import { createElement, type ReactElement } from 'react';

/**
 * ADR-0115: a shell kept across a server restart whose temporary directory is
 * gone or read-only. The server cannot give it a new one, but new terminals
 * get a working one, and this says exactly that. It is a notice, not a
 * dialog: it takes no focus and blocks no input, because the shell may still
 * be doing useful work.
 */
export const DEGRADED_TERMINAL_MESSAGE =
	"This terminal's temporary directory is no longer usable. New terminals are not affected.";

export function degradedTerminalBanner(
	degraded: string | undefined,
): ReactElement | null {
	if (degraded !== 'tmp-unusable') return null;
	return createElement(
		'div',
		{
			className: 'terminal-degraded-notice',
			role: 'status',
			'data-degraded': degraded,
		},
		DEGRADED_TERMINAL_MESSAGE,
	);
}
