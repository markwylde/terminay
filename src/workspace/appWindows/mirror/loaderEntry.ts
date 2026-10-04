/**
 * Runs inside every view (ADR-0039). This file is bundled into one small script
 * that the workspace places in each view document. It does two things, and
 * neither until the workspace asks:
 *
 * - It takes the recorder when someone starts watching, so a view nobody
 *   watches carries a few lines, not a library.
 * - It puts back what a person had typed, when control of the terminal has just
 *   moved to this client from one whose view this client was mirroring.
 */
import { applyFieldState, parseFieldState } from './fieldState.ts';
import { MIRROR_MESSAGE_KEY } from './mirrorProtocol.ts';

// The recorder, loaded later into this same document, listens for the same
// key; a message of a type it does not know is nothing to it.

/** How long a control that is not in the page yet is waited for. */
const RESTORE_WINDOW_MS = 4000;

(() => {
	let loaded = false;
	let restored = false;

	const restore = (value: unknown): void => {
		const state = parseFieldState(value);
		if (state === undefined || restored) return;
		restored = true;
		let waiting = new Set(applyFieldState(document, state));
		scrollTo(state.scrollX, state.scrollY);
		if (waiting.size === 0) return;
		// A page that builds itself with script may not have drawn every
		// control yet. Each is filled in as it appears, for a short while.
		const observer = new MutationObserver(() => {
			waiting = new Set(applyFieldState(document, state, waiting));
			if (waiting.size === 0) observer.disconnect();
		});
		observer.observe(document.documentElement, { childList: true, subtree: true });
		setTimeout(() => observer.disconnect(), RESTORE_WINDOW_MS);
	};

	addEventListener('message', (event) => {
		if (event.source !== parent) return;
		const message = (event.data as Record<string, { type?: unknown; code?: unknown; state?: unknown }> | null)?.[
			MIRROR_MESSAGE_KEY
		];
		if (typeof message !== 'object' || message === null) return;
		if (message.type === 'load' && typeof message.code === 'string' && !loaded) {
			loaded = true;
			const script = document.createElement('script');
			script.textContent = message.code;
			(document.head ?? document.documentElement).appendChild(script);
			script.remove();
		} else if (message.type === 'restore') {
			if (document.readyState === 'loading')
				addEventListener('DOMContentLoaded', () => restore(message.state), { once: true });
			else restore(message.state);
		}
	});
})();
