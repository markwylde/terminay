/** A dependency-free document for the interval before the local server and its
 * verified UI bundle are ready. It deliberately has no script or network
 * access, so it can be painted before a server-UI document binding exists.
 *
 * Every phase label is baked into the document as a real text node, hidden by
 * default. The document itself never marks one active: Blink matches an
 * injected author stylesheet BEFORE the document's own <style>, so a rule in
 * here would outrank every rule Desktop main later inserts and the line would
 * be stuck on whichever phase was baked in. Main reveals the current phase by
 * inserting a rule instead.
 *
 * Advancing the phase is therefore a style insertion, never a navigation: the
 * document is loaded once, the dot animation is never interrupted, and a
 * renderer's execution context is never destroyed out from under an attached
 * client. */

import {
	STARTUP_PHASE_IDS,
	STARTUP_SUB_PHASE_IDS,
	type StartupPhaseId,
	type StartupSubPhaseId,
	startupPhaseLabel,
} from './diagnostics/startupTimeline';

export type StartupDocumentPhaseId = StartupPhaseId | StartupSubPhaseId;

const ALL_PHASE_IDS: readonly StartupDocumentPhaseId[] = [
	...STARTUP_PHASE_IDS,
	...STARTUP_SUB_PHASE_IDS,
];

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** The rule that reveals one phase line, inserted by Desktop main.
 *
 * The declarations are `!important` deliberately. Electron's `insertCSS`
 * installs an *injected* author stylesheet, and Blink matches injected author
 * rules BEFORE the document's own <style>. A normal declaration therefore
 * loses to the rule baked into the document and the line never advances --
 * which is exactly what shipped and had to be fixed. An important author
 * declaration wins regardless of that ordering.
 *
 * The rule also hides every phase before showing one, so a rule left behind by
 * an earlier phase cannot keep its own line on screen.
 *
 * Ids come from a closed union, so the selector cannot be widened by a caller. */
export function startupPhaseVisibilityCss(id: StartupDocumentPhaseId): string {
	if (!ALL_PHASE_IDS.includes(id))
		throw new Error('unknown startup phase identifier');
	return `.phase[data-phase]{display:none!important}.phase[data-phase="${id}"]{display:block!important}`;
}

/** Where the document's one link goes. A fragment, so following it loads
 * nothing: Desktop main sees an in-page navigation and acts on it. */
export const STARTUP_SWITCH_TO_LOCAL_FRAGMENT = '#switch-to-local';

/** The rule that offers Local on the loading state, inserted by Desktop main
 * when the server the window is returning to is slow to answer. `!important`
 * for the reason `startupPhaseVisibilityCss` gives. */
export function startupSwitchToLocalCss(): string {
	return '.local{display:inline-block!important}';
}

export function desktopStartupLoadingDocument(): string {
	// A negative animation delay resumes the dot cycle at its current point, so
	// a window that is reloaded for another reason never restarts the animation.
	const loadingPhase = -(Date.now() % 1600);
	const phases = ALL_PHASE_IDS.map(
		(id) =>
			`<p class="phase" data-phase="${id}">${escapeHtml(startupPhaseLabel(id))}</p>`,
	).join('');
	const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Terminay</title><style>:root{--terminay-loading-phase:${loadingPhase}ms}html,body{width:100%;min-height:100%;margin:0}body{display:grid;min-height:100vh;place-items:center;background:#0d1117}.brand{display:grid;justify-items:center;gap:16px}.logo{width:72px;height:72px}.dots{display:flex;gap:7px}.dots span{width:7px;height:7px;border-radius:50%;opacity:.2;transform:scale(.65);animation:loading-dot 1.6s ease-in-out infinite;animation-delay:var(--terminay-loading-phase,0ms)}.dots span:nth-child(1){background:#db5757}.dots span:nth-child(2){background:#c1db57;animation-delay:calc(var(--terminay-loading-phase,0ms) + .12s)}.dots span:nth-child(3){background:#57db8c;animation-delay:calc(var(--terminay-loading-phase,0ms) + .24s)}.dots span:nth-child(4){background:#578cdb;animation-delay:calc(var(--terminay-loading-phase,0ms) + .36s)}.dots span:nth-child(5){background:#c157db;animation-delay:calc(var(--terminay-loading-phase,0ms) + .48s)}.phases{position:fixed;inset-inline:0;bottom:34px;display:grid;justify-items:center;pointer-events:none}.phase{display:none;grid-area:1/1;margin:0;max-width:min(420px,80vw);overflow:hidden;color:#4d5b6e;font:400 11.5px/1.5 ui-rounded,system-ui,-apple-system,"SF Pro Text","Segoe UI",sans-serif;letter-spacing:.055em;text-align:center;text-overflow:ellipsis;white-space:nowrap}@media (prefers-reduced-motion:no-preference){.phase{transition:opacity 160ms ease}}.local{display:none;position:fixed;left:50%;bottom:68px;transform:translateX(-50%);padding:6px 14px;border:1px solid #2b3545;border-radius:7px;background:#161c26;color:#c9d4e3;font:500 12.5px/1.4 ui-rounded,system-ui,-apple-system,"SF Pro Text","Segoe UI",sans-serif;text-decoration:none;cursor:default}.local:hover{background:#1d2532;border-color:#3a475c}.local:focus-visible{outline:2px solid #578cdb;outline-offset:2px}@keyframes loading-dot{0%,55%,100%{opacity:.2;transform:scale(.65)}18%,36%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){.dots span{animation:none;opacity:1;transform:none}}</style></head><body><main class="brand" aria-busy="true" aria-label="Starting Terminay"><svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polygon points="12 4 4.5 7.75 12 11.5 19.5 7.75 12 4"/><polyline points="4.5 15.25 12 19 19.5 15.25"/><polyline points="4.5 11.5 12 15.25 19.5 11.5"/></svg><div class="dots" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div></main><a class="local" href="${STARTUP_SWITCH_TO_LOCAL_FRAGMENT}">Switch to Local</a><div class="phases" aria-live="polite">${phases}</div></body></html>`;
	return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}
