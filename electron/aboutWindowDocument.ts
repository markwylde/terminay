/** Terminay's own About window, as a dependency-free document.
 *
 * Like the startup loading document it has no script, no preload, and no
 * network: the CSP allows inline styles and nothing else. Links are plain
 * anchors; Desktop main intercepts every navigation and hands the URL to the
 * operating system only when `aboutWindowExternalUrl` recognises it. */

export const ABOUT_WINDOW_LINKS = {
	website: 'https://terminay.com/',
	repository: 'https://github.com/markwylde/terminay',
	license: 'https://github.com/markwylde/terminay/blob/main/LICENSE',
} as const;

const ALLOWED_URLS: ReadonlySet<string> = new Set(
	Object.values(ABOUT_WINDOW_LINKS),
);

/** The URL to open externally, or null when it is not one of the About links. */
export function aboutWindowExternalUrl(url: unknown): string | null {
	return typeof url === 'string' && ALLOWED_URLS.has(url) ? url : null;
}

/** The loading indicator's colours, in order. */
const SPECTRUM = ['#db5757', '#c1db57', '#57db8c', '#578cdb', '#c157db'];

const ART_WIDTH = 440;
const ART_HEIGHT = 210;

/** Each line: vertical centre, wave period, amplitude, and seconds per period.
 * Periods and speeds differ slightly so the lines drift through one another
 * instead of moving as a block. */
const WAVES = [
	{ y: 84, period: 300, amplitude: 22, seconds: 17 },
	{ y: 96, period: 340, amplitude: 18, seconds: 21 },
	{ y: 106, period: 280, amplitude: 26, seconds: 15 },
	{ y: 116, period: 360, amplitude: 16, seconds: 23 },
	{ y: 128, period: 320, amplitude: 20, seconds: 19 },
];

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** A sine-like path from one period left of the artwork to one period past its
 * right edge, so translating it by exactly one period loops seamlessly. */
function wavePath(y: number, period: number, amplitude: number): string {
	const half = period / 2;
	const halves = Math.ceil((ART_WIDTH + 2 * period) / half);
	return `M${-period} ${y}q${period / 4} ${-2 * amplitude} ${half} 0${` t${half} 0`.repeat(halves - 1)}`;
}

function waveArtwork(): string {
	const lines = WAVES.map((wave, index) => {
		const d = wavePath(wave.y, wave.period, wave.amplitude);
		const delay = -((index * 3.7) % wave.seconds);
		return `<g class="w" style="--p:${wave.period}px;animation-duration:${wave.seconds}s;animation-delay:${delay}s"><path d="${d}" stroke="${SPECTRUM[index]}"/></g>`;
	}).join('');
	return `<svg class="art" viewBox="0 0 ${ART_WIDTH} ${ART_HEIGHT}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs><filter id="glow" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="7"/></filter></defs><g class="glow" filter="url(#glow)">${lines}</g><g class="lines">${lines}</g></svg>`;
}

const LOGO = `<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="1" y="1" width="22" height="22" rx="5" fill="#000" stroke="none"/><polygon points="12 4 4.5 7.75 12 11.5 19.5 7.75 12 4"/><polyline points="4.5 15.25 12 19 19.5 15.25"/><polyline points="4.5 11.5 12 15.25 19.5 11.5"/></svg>`;

const GLOBE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`;

const GITHUB_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>`;

const STYLE = `
:root{color-scheme:dark;--bg:#0d1117;--text:#e6edf3;--muted:#8b98a9;--faint:#4d5b6e;--line:rgba(255,255,255,.08)}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:400 13px/1.55 system-ui,-apple-system,"SF Pro Text","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden;user-select:none;cursor:default}
body{display:flex;flex-direction:column}
.hero{position:relative;height:${ART_HEIGHT}px;flex:none;-webkit-app-region:drag}
.art{position:absolute;inset:0;width:100%;height:100%;-webkit-mask-image:linear-gradient(90deg,transparent,#000 22%,#000 78%,transparent),linear-gradient(transparent,#000 30%,#000 62%,transparent);-webkit-mask-composite:source-in;mask-composite:intersect}
.art path{fill:none;stroke-width:1.6;stroke-linecap:round}
.glow{opacity:.55}
.lines{opacity:.9}
.w{animation-name:drift;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(var(--p))}}
.logo{position:absolute;left:50%;bottom:-6px;width:76px;height:76px;margin-left:-38px;border-radius:19px;box-shadow:0 0 0 1px rgba(255,255,255,.1),0 12px 32px rgba(0,0,0,.55)}
main{flex:1;display:flex;flex-direction:column;align-items:center;text-align:center;padding:26px 36px 0}
h1{margin:0;font-size:24px;font-weight:650;letter-spacing:-.01em}
.version{margin:6px 0 0;padding:2px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font:500 11.5px/1.6 ui-monospace,"SF Mono",Menlo,Consolas,monospace}
.about{margin:20px 0 0;max-width:340px;color:var(--muted)}
.about strong{color:var(--text);font-weight:560}
.links{display:flex;gap:10px;margin-top:22px}
.links a{display:inline-flex;align-items:center;gap:7px;padding:7px 14px;border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.035);color:var(--text);font-weight:520;text-decoration:none;transition:background 140ms ease,border-color 140ms ease}
.links a:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.16)}
.links a:focus-visible{outline:2px solid #578cdb;outline-offset:2px}
.links svg{width:15px;height:15px}
footer{padding:0 24px 20px;text-align:center;color:var(--faint);font-size:11.5px}
footer a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}
footer a:hover{color:var(--muted)}
.heart{color:#db5757}
@media (prefers-reduced-motion:reduce){.w{animation:none}}
`;

export type AboutWindowDocumentOptions = {
	version: string;
	year?: number;
};

export function aboutWindowDocumentHtml({
	version,
	year = new Date().getFullYear(),
}: AboutWindowDocumentOptions): string {
	return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="color-scheme" content="dark"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>About Terminay</title><style>${STYLE}</style></head><body><div class="hero">${waveArtwork()}${LOGO}</div><main><h1>Terminay</h1><p class="version">Version ${escapeHtml(version)}</p><p class="about">Made with <span class="heart" aria-label="love">♥</span> by <strong>Mark Wylde</strong>. Terminay is free, open source software, built out of a love for open&nbsp;source.</p><nav class="links"><a href="${ABOUT_WINDOW_LINKS.website}">${GLOBE_ICON}terminay.com</a><a href="${ABOUT_WINDOW_LINKS.repository}">${GITHUB_ICON}GitHub</a></nav></main><footer>© ${year} Mark Wylde · Licensed under the <a href="${ABOUT_WINDOW_LINKS.license}">GNU AGPL v3.0 or later</a></footer></body></html>`;
}

export function aboutWindowDocument(
	options: AboutWindowDocumentOptions,
): string {
	return `data:text/html;charset=UTF-8,${encodeURIComponent(aboutWindowDocumentHtml(options))}`;
}
