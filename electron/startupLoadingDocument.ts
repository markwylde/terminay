/** A dependency-free document for the interval before the local server and its
 * verified UI bundle are ready. It deliberately has no script or network
 * access, so it can be painted before a server-UI document binding exists.
 *
 * Every phase label is baked into the document as a real text node, hidden by
 * default, and exactly one is revealed by a CSS rule. Advancing the phase is
 * therefore a style insertion, never a navigation: the document is loaded once,
 * the dot animation is never interrupted, and a renderer's execution context is
 * never destroyed out from under an attached client. */

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

/** The rule that reveals one phase line. Ids come from a closed union, so the
 * attribute selector cannot be widened by a caller. */
export function startupPhaseVisibilityCss(id: StartupDocumentPhaseId): string {
	if (!ALL_PHASE_IDS.includes(id))
		throw new Error('unknown startup phase identifier');
	return `.phase[data-phase="${id}"]{display:block}`;
}

export function desktopStartupLoadingDocument(
	activePhaseId?: StartupDocumentPhaseId,
): string {
	// A negative animation delay resumes the dot cycle at its current point, so
	// a window that is reloaded for another reason never restarts the animation.
	const loadingPhase = -(Date.now() % 1600);
	const phases = ALL_PHASE_IDS.map(
		(id) =>
			`<p class="phase" data-phase="${id}">${escapeHtml(startupPhaseLabel(id))}</p>`,
	).join('');
	const active =
		activePhaseId === undefined ? '' : startupPhaseVisibilityCss(activePhaseId);
	const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Terminay</title><style>:root{--terminay-loading-phase:${loadingPhase}ms}html,body{width:100%;min-height:100%;margin:0}body{display:grid;min-height:100vh;place-items:center;background:#0d1117}.brand{display:grid;justify-items:center;gap:16px}.logo{width:72px;height:72px;border-radius:18px}.dots{display:flex;gap:7px}.dots span{width:7px;height:7px;border-radius:50%;opacity:.2;transform:scale(.65);animation:loading-dot 1.6s ease-in-out infinite;animation-delay:var(--terminay-loading-phase,0ms)}.dots span:nth-child(1){background:#db5757}.dots span:nth-child(2){background:#c1db57;animation-delay:calc(var(--terminay-loading-phase,0ms) + .12s)}.dots span:nth-child(3){background:#57db8c;animation-delay:calc(var(--terminay-loading-phase,0ms) + .24s)}.dots span:nth-child(4){background:#578cdb;animation-delay:calc(var(--terminay-loading-phase,0ms) + .36s)}.dots span:nth-child(5){background:#c157db;animation-delay:calc(var(--terminay-loading-phase,0ms) + .48s)}.phases{display:grid;min-height:17px}.phase{display:none;grid-area:1/1;margin:-6px 0 0;max-width:260px;overflow:hidden;color:#6f8299;font:400 12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.01em;text-align:center;text-overflow:ellipsis;white-space:nowrap}${active}@keyframes loading-dot{0%,55%,100%{opacity:.2;transform:scale(.65)}18%,36%{opacity:1;transform:scale(1)}}@media (prefers-reduced-motion:reduce){.dots span{animation:none;opacity:1;transform:none}}</style></head><body><main class="brand" aria-busy="true" aria-label="Starting Terminay"><svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="1" y="1" width="22" height="22" rx="5" fill="#000" stroke="none"/><polygon points="12 4 4.5 7.75 12 11.5 19.5 7.75 12 4"/><polyline points="4.5 15.25 12 19 19.5 15.25"/><polyline points="4.5 11.5 12 15.25 19.5 11.5"/></svg><div class="dots" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><div class="phases" aria-live="polite">${phases}</div></main></body></html>`;
	return `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
}
