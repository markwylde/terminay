// The renderer half of the spike: projects and terminals, each terminal an xterm.js
// instance with its own PTY, plus an MCP Apps host (SEP-1865). A view opens as a
// floating window at the bottom-left of the terminal that called the tool; the five
// variants differ only in what the window becomes when it is minimised.
//
// A view belongs to one terminal and lives in that terminal's overlay layer. The
// window and its minimised form are the same element, restyled and repositioned,
// never re-parented: moving an iframe in the DOM reloads it, and an app must survive
// minimise, a terminal switch, or a project switch with its state intact.

import { FitAddon } from '/vendor/addon-fit.mjs';
import { Terminal } from '/vendor/xterm.mjs';

const SANDBOX_ORIGIN = window.SPIKE.sandboxOrigin;
const HEADER = 32;
const BAR = 30;
const EDGE = 12;
const MOBILE_WIDTH = 560;
const MAX_FRACTION = 0.6; // a view takes its content height, capped at 60% of the pane
const VARIANTS = ['pill', 'bar', 'shade', 'tab', 'bubble'];

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const state = {
	variant: VARIANTS.includes(localStorage.getItem('spike-variant'))
		? localStorage.getItem('spike-variant')
		: 'pill',
	projectId: 'p1',
};
const projects = [
	{ id: 'p1', name: 'Terminay', terminals: [], activeSid: null },
	{ id: 'p2', name: 'Project 2', terminals: [], activeSid: null },
];
/** sid -> terminal record */
const terminals = new Map();
let commands = {};
let terminalSeq = 0;

const project = () => projects.find((p) => p.id === state.projectId);
const current = () => terminals.get(project().activeSid);
const isVisible = (t) =>
	t.project.id === state.projectId && t.project.activeSid === t.sid;
const allApps = () =>
	[...terminals.values()].flatMap((t) => [...t.apps.values()]);

// ---------------------------------------------------------------- transport

const ws = new WebSocket(`ws://${location.host}/ws`);
const wsSend = (message) =>
	ws.readyState === 1 && ws.send(JSON.stringify(message));
const rpcWaiters = new Map();
let rpcSeq = 0;

ws.onopen = () => {
	for (const t of terminals.values()) startTerminal(t);
};
ws.onmessage = (event) => {
	const m = JSON.parse(event.data);
	if (m.t === 'hello') {
		commands = m.commands;
		// ?cmd=hello runs a toolbar command once the shell has started.
		const auto = new URLSearchParams(location.search).get('cmd');
		if (commands[auto])
			setTimeout(
				() => wsSend({ t: 'input', sid: current().sid, d: `${commands[auto]}\r` }),
				2000,
			);
		return;
	}
	const t = terminals.get(m.sid);
	if (!t) return;
	if (m.t === 'output') t.term.write(m.d);
	else if (m.t === 'app-open') openApp(t, m.app);
	else if (m.t === 'app-result') deliverResult(t, m.id, m.result);
	else if (m.t === 'app-cancelled') cancelApp(t, m.id, m.reason);
	else if (m.t === 'rpc-result') rpcWaiters.get(m.reqId)?.(m);
};

// ---------------------------------------------------------------- terminals

function createTerminal(owner) {
	const sid = `t${++terminalSeq}`;
	const pane = el('div', 'pane is-inactive');
	const body = el('div', 'pane-body');
	const termWrap = el('div', 'term-wrap');
	const termEl = el('div', 'term');
	const bar = el('div', 'min-bar');
	bar.hidden = true;
	const layer = el('div', 'app-layer');
	termWrap.append(termEl);
	body.append(termWrap, bar, layer);
	pane.append(body);
	$('panes').append(pane);

	const term = new Terminal({
		allowProposedApi: true,
		fontFamily: 'Menlo, ui-monospace, monospace',
		fontSize: 13,
		scrollback: 5000,
		theme: {
			background: '#1c1e10',
			foreground: '#e4e7cf',
			cursor: '#b5c44a',
			selectionBackground: '#56602a',
		},
	});
	const fit = new FitAddon();
	term.loadAddon(fit);
	term.open(termEl);

	const t = {
		sid,
		name: `Terminal ${owner.terminals.length + 1}`,
		project: owner,
		pane,
		body,
		termWrap,
		bar,
		layer,
		term,
		fit,
		started: false,
		apps: new Map(),
		unseen: 0,
		fullscreenId: null,
		layoutQueued: false,
	};
	terminals.set(sid, t);
	owner.terminals.push(t);
	owner.activeSid ??= sid;

	term.onData((d) => wsSend({ t: 'input', sid, d }));
	term.onResize(({ cols, rows }) => wsSend({ t: 'resize', sid, cols, rows }));
	// Background panes keep their size (hidden, not removed), so a terminal you
	// are not looking at still has a correctly sized PTY and laid-out views.
	new ResizeObserver(() => {
		if (termWrap.clientWidth === 0) return;
		fit.fit();
		scheduleLayout(t);
	}).observe(termWrap);

	startTerminal(t);
	return t;
}

function startTerminal(t) {
	if (t.started || ws.readyState !== 1) return;
	t.started = true;
	t.fit.fit();
	wsSend({ t: 'open', sid: t.sid, cols: t.term.cols, rows: t.term.rows });
}

function typeIntoTerminal(t, text) {
	const paste = t.term.modes.bracketedPasteMode
		? `\x1b[200~${text}\x1b[201~`
		: text;
	wsSend({ t: 'input', sid: t.sid, d: paste });
	setTimeout(() => wsSend({ t: 'input', sid: t.sid, d: '\r' }), 150);
}

function showTerminal(t) {
	state.projectId = t.project.id;
	t.project.activeSid = t.sid;
	t.unseen = 0;
	renderChrome();
	layout(t);
	t.term.focus();
}

// -------------------------------------------------------------- app records

function openApp(t, spec) {
	const card = el('section', 'card');
	card.innerHTML = `<header><span class="glyph">▣</span><span class="title"></span><span class="meta"></span>
    <span class="spacer"></span>
    <button data-act="min" title="Minimise">–</button>
    <button data-act="fullscreen" title="Fullscreen">⤢</button>
    <button data-act="close" title="Close">×</button></header>`;
	card.querySelector('.title').textContent = spec.title;
	card.querySelector('.meta').textContent =
		`${spec.server} · ${spec.tool.name}`;
	card.title = spec.title;
	const iframe = el('iframe');
	iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
	iframe.src = `${SANDBOX_ORIGIN}/sandbox.html`;
	card.append(iframe);
	t.layer.append(card);

	const app = {
		...spec,
		t,
		card,
		iframe,
		initialized: false,
		result: null,
		contentHeight: null,
		min: false,
		// Where the minimised handle sits: offset from the pane's left and bottom
		// edges. Unset until the user drags it; the window opens from the same spot.
		hx: null,
		hb: null,
		lastContext: '',
	};
	// One window open at a time per terminal; a new view minimises the others.
	for (const other of t.apps.values()) other.min = true;
	t.apps.set(app.id, app);
	// An agent in a terminal you are not looking at just opened a view.
	if (!isVisible(t)) t.unseen += 1;

	enableHeader(app);
	// The plain-CLI helper asks how many rows to leave blank; a float needs none.
	if (spec.reserve) wsSend({ t: 'reserved', sid: t.sid, id: app.id, rows: 0 });
	renderChrome();
	layout(t);
}

function setMin(app, min) {
	const { t } = app;
	if (!min) for (const other of t.apps.values()) other.min = true;
	app.min = min;
	if (min && t.fullscreenId === app.id) t.fullscreenId = null;
	layout(t);
	if (min) t.term.focus();
}

function setFullscreen(app, on) {
	app.t.fullscreenId = on ? app.id : null;
	if (on) app.min = false;
	layout(app.t);
	if (!on) app.t.term.focus();
}

async function closeApp(app) {
	const { t } = app;
	if (app.initialized) {
		post(app, {
			jsonrpc: '2.0',
			id: `teardown-${app.id}`,
			method: 'ui/resource-teardown',
			params: { reason: 'closed by user' },
		});
		await new Promise((r) => setTimeout(r, 150));
	}
	app.card.remove();
	t.apps.delete(app.id);
	if (t.fullscreenId === app.id) t.fullscreenId = null;
	renderChrome();
	layout(t);
	t.term.focus();
}

// Header buttons, click-to-restore, and dragging. Only a minimised view can be
// dragged; an open window always sits where its handle was.
function enableHeader(app) {
	const { t } = app;
	const header = app.card.querySelector('header');
	let drag = null;

	header.addEventListener('pointerdown', (event) => {
		if (event.target.closest('button')) return;
		drag = { x: event.clientX, y: event.clientY, moved: false };
		if (!app.min || state.variant === 'bar') return;
		drag.left = app.rect.x;
		drag.bottom = t.body.clientHeight - app.rect.y - app.rect.h;
		header.setPointerCapture(event.pointerId);
	});
	header.addEventListener('pointermove', (event) => {
		if (!drag || drag.left === undefined) return;
		const dx = event.clientX - drag.x;
		const dy = event.clientY - drag.y;
		if (!drag.moved && Math.hypot(dx, dy) < 5) return;
		drag.moved = true;
		app.card.classList.add('is-dragging');
		app.hx = drag.left + dx;
		// A bottom tab only slides along the edge.
		if (state.variant !== 'tab') app.hb = drag.bottom - dy;
		layout(t);
	});
	header.addEventListener('pointerup', (event) => {
		const wasDrag = drag?.moved;
		drag = null;
		app.card.classList.remove('is-dragging');
		const act = event.target.closest('button')?.dataset.act;
		if (act) return;
		if (wasDrag) {
			// A bubble snaps to the nearer side so it never rests over the text.
			if (state.variant === 'bubble') {
				const W = t.body.clientWidth;
				app.hx = app.rect.x + app.rect.w / 2 < W / 2 ? EDGE : W;
			}
			layout(t);
		} else if (app.min) setMin(app, false);
	});
	header.addEventListener('click', (event) => {
		const act = event.target.closest('button')?.dataset.act;
		if (act === 'close') closeApp(app);
		else if (act === 'fullscreen')
			setFullscreen(app, t.fullscreenId !== app.id);
		else if (act === 'min') setMin(app, true);
	});
}

// ------------------------------------------------------ SEP-1865 host bridge

const hostStyles = {
	'--color-background-primary': '#1c1e10',
	'--color-background-secondary': '#262914',
	'--color-background-tertiary': '#2f3319',
	'--color-text-primary': '#e4e7cf',
	'--color-text-secondary': '#9aa07c',
	'--color-text-tertiary': '#7a805f',
	'--color-border-primary': '#454a28',
	'--color-border-secondary': '#353a1e',
	'--color-ring-primary': '#b5c44a',
	'--font-sans': 'system-ui, -apple-system, sans-serif',
	'--font-mono': 'Menlo, ui-monospace, monospace',
	'--border-radius-sm': '4px',
	'--border-radius-md': '6px',
	'--border-radius-lg': '10px',
};

function post(app, message) {
	log('out', app, message);
	app.iframe.contentWindow?.postMessage(message, SANDBOX_ORIGIN);
}

function deliverResult(t, id, result) {
	const app = t.apps.get(id);
	if (!app) return;
	app.result = result;
	if (app.initialized)
		post(app, {
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-result',
			params: result,
		});
}

function cancelApp(t, id, reason) {
	const app = t.apps.get(id);
	if (app?.initialized)
		post(app, {
			jsonrpc: '2.0',
			method: 'ui/notifications/tool-cancelled',
			params: { reason },
		});
}

function upstreamRpc(app, method, params) {
	return new Promise((resolve) => {
		const reqId = ++rpcSeq;
		rpcWaiters.set(reqId, (reply) => {
			rpcWaiters.delete(reqId);
			resolve(reply);
		});
		wsSend({ t: 'rpc', sid: app.t.sid, reqId, appId: app.id, method, params });
	});
}

window.addEventListener('message', async (event) => {
	if (event.origin !== SANDBOX_ORIGIN) return;
	const app = allApps().find((a) => a.iframe.contentWindow === event.source);
	const m = event.data;
	if (!app || m?.jsonrpc !== '2.0') return;
	const { t } = app;
	log('in', app, m);

	const reply = (result) => post(app, { jsonrpc: '2.0', id: m.id, result });
	const fail = (code, message) =>
		post(app, { jsonrpc: '2.0', id: m.id, error: { code, message } });

	switch (m.method) {
		case undefined:
			return; // a response to a host request (teardown)
		case 'ui/notifications/sandbox-proxy-ready':
			return post(app, {
				jsonrpc: '2.0',
				method: 'ui/notifications/sandbox-resource-ready',
				params: { html: app.html, csp: app.csp, permissions: app.permissions },
			});
		case 'ui/initialize':
			return reply({
				protocolVersion: '2026-01-26',
				hostInfo: { name: 'terminay-mcp-apps-spike', version: '0.0.0' },
				hostCapabilities: {
					openLinks: {},
					serverTools: {},
					serverResources: {},
					logging: {},
				},
				hostContext: {
					toolInfo: { tool: app.tool },
					theme: 'dark',
					styles: { variables: hostStyles },
					availableDisplayModes: ['pip', 'fullscreen'],
					locale: navigator.language,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					userAgent: 'terminay-mcp-apps-spike',
					...currentContext(app),
				},
			});
		case 'ui/notifications/initialized':
			app.initialized = true;
			post(app, {
				jsonrpc: '2.0',
				method: 'ui/notifications/tool-input',
				params: { arguments: app.args ?? {} },
			});
			if (app.result)
				post(app, {
					jsonrpc: '2.0',
					method: 'ui/notifications/tool-result',
					params: app.result,
				});
			return layout(t);
		case 'ui/notifications/size-changed':
			// Only meaningful while the view is open and controls its own height.
			if (
				!app.fixed &&
				!app.min &&
				m.params?.height > 0 &&
				Math.abs((app.contentHeight ?? 0) - m.params.height) >= 1
			) {
				app.contentHeight = m.params.height;
				scheduleLayout(t);
			}
			return;
		case 'tools/call':
		case 'resources/read': {
			const { result, error } = await upstreamRpc(app, m.method, m.params);
			return error ? fail(error.code, error.message) : reply(result);
		}
		case 'ui/message': {
			// The one generic way to put a user turn into *any* agent CLI: type it,
			// into the terminal that owns the view, whichever one is on screen.
			const text = m.params?.content?.text ?? '';
			if (!text) return fail(-32602, 'Invalid message format');
			typeIntoTerminal(t, text);
			setMin(app, true);
			return reply({});
		}
		case 'ui/update-model-context': {
			const text =
				(m.params?.content ?? [])
					.map((c) => c.text)
					.filter(Boolean)
					.join('\n') || JSON.stringify(m.params?.structuredContent ?? {});
			wsSend({ t: 'model-context', sid: t.sid, context: text });
			return reply({});
		}
		case 'ui/open-link':
			if (!/^https?:\/\//.test(m.params?.url ?? ''))
				return fail(-32000, 'Invalid URL');
			window.open(m.params.url, '_blank', 'noopener');
			return reply({});
		case 'ui/request-display-mode':
			setFullscreen(app, m.params?.mode === 'fullscreen');
			return reply({ mode: currentContext(app).displayMode });
		case 'ping':
			return reply({});
		case 'notifications/message':
			return;
		default:
			if (m.id !== undefined) fail(-32601, `Method not found: ${m.method}`);
	}
});

function currentContext(app) {
	const rect = app.openRect ?? { w: 440, h: 240 };
	const mobile = isMobile(app.t);
	return {
		displayMode: app.fixed ? 'fullscreen' : 'pip',
		platform: mobile ? 'mobile' : 'desktop',
		deviceCapabilities: { touch: mobile, hover: !mobile },
		containerDimensions: app.fixed
			? { width: Math.round(rect.w), height: Math.round(rect.h - HEADER) }
			: { width: Math.round(rect.w), maxHeight: maxBody(app.t) },
	};
}

// ------------------------------------------------------------------- layout

const isMobile = (t) => t.body.clientWidth < MOBILE_WIDTH;
const maxBody = (t) =>
	Math.max(80, Math.floor(t.body.clientHeight * MAX_FRACTION) - HEADER);
const flexHeight = (app) =>
	HEADER + Math.min(app.contentHeight ?? 180, maxBody(app.t));
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function scheduleLayout(t) {
	if (t.layoutQueued) return;
	t.layoutQueued = true;
	requestAnimationFrame(() => {
		t.layoutQueued = false;
		layout(t);
	});
}

// Size of a minimised handle for each variant. `null` width means "fit the title".
function handleSize(variant, mobile) {
	if (variant === 'bubble') return { w: mobile ? 52 : 44, h: mobile ? 52 : 44 };
	if (variant === 'shade') return { w: mobile ? 220 : 280, h: HEADER };
	if (variant === 'tab') return { w: null, h: mobile ? 34 : 28 };
	return { w: null, h: mobile ? 38 : 30 };
}

function layout(t) {
	const W = t.body.clientWidth;
	const H = t.body.clientHeight;
	if (W === 0) return;
	const variant = state.variant;
	const mobile = isMobile(t);
	t.body.classList.toggle('is-mobile', mobile);

	// Two variants take rows from the terminal so its text is never covered. The
	// bar and the edge-tab rail both exist only while something is minimised:
	// an empty strip under an open window is wasted space.
	const inBar = [...t.apps.values()].filter((a) => a.min);
	const barShown = variant === 'bar' && inBar.length > 0 && !t.fullscreenId;
	const railShown = variant === 'tab' && inBar.length > 0 && !t.fullscreenId;
	const rail = railShown ? handleSize('tab', mobile).h + 5 : 0;
	t.bar.hidden = !barShown && !railShown;
	t.bar.classList.toggle('is-rail', railShown);
	t.bar.style.flexBasis = railShown ? `${rail}px` : '';
	t.bar.replaceChildren(
		...(barShown ? inBar : []).map((app) => {
			const b = el('button', '', `▣ ${app.title}`);
			b.onclick = () => setMin(app, false);
			return b;
		}),
	);
	const floor = barShown ? t.bar.offsetHeight || BAR : rail; // bottom of the usable area
	t.termWrap.style.visibility = t.fullscreenId ? 'hidden' : '';

	// Minimised handles are placed first so an open window can sit clear of the
	// ones still in their default spot. On a phone the sheet covers them instead.
	const ordered = [...t.apps.values()].sort(
		(a, b) => Number(b.min) - Number(a.min),
	);
	const sheetOpen = mobile && ordered.some((a) => !a.min);
	let stack = 0;
	let lift = EDGE;
	for (const app of ordered) {
		const card = app.card;
		const fullscreen = t.fullscreenId === app.id;
		const min = app.min && !fullscreen;
		let rect;
		let hidden = Boolean(t.fullscreenId) && !fullscreen;

		card.dataset.variant = variant;
		card.classList.toggle('is-min', min);
		card.classList.toggle('is-fullscreen', fullscreen);
		card.classList.toggle('is-sheet', mobile && !min && !fullscreen);
		card.style.width = '';

		if (fullscreen) {
			rect = { x: 0, y: 0, w: W, h: H };
		} else if (!min) {
			const h = flexHeight(app);
			if (mobile) {
				// On a phone an open view is a bottom sheet.
				rect = { x: 0, y: H - floor - h, w: W, h };
			} else {
				const w = Math.min(440, W - EDGE * 2);
				const hb =
					variant === 'bar'
						? EDGE
						: variant === 'tab'
							? lift
							: (app.hb ?? lift);
				rect = {
					x: clamp(app.hx ?? EDGE, EDGE, W - w - EDGE),
					y: clamp(H - floor - hb - h, EDGE, H - floor - h - EDGE),
					w,
					h,
				};
			}
		} else if (variant === 'bar') {
			hidden = true;
			rect = app.rect ?? { x: EDGE, y: H - 200, w: 440, h: 200 };
		} else {
			const size = handleSize(variant, mobile);
			const w =
				size.w ??
				Math.min(
					card.querySelector('header').scrollWidth + 2,
					W - EDGE * 2,
					260,
				);
			const gap = 6;
			let x = app.hx;
			let hb = app.hb;
			if (variant === 'tab') {
				// Tabs line up along the bottom edge.
				x ??= EDGE + 4 + stack;
				stack += w + gap;
				hb = 0;
				lift = EDGE;
			} else {
				// Everything else stacks upward from the bottom-left corner.
				x ??= EDGE;
				if (hb == null) {
					hb = EDGE + stack;
					stack += size.h + gap;
					lift = EDGE + stack;
				}
			}
			hidden ||= sheetOpen && variant !== 'tab';
			const inset = variant === 'tab' ? 0 : EDGE;
			rect = {
				x: clamp(x, EDGE, W - w - EDGE),
				y:
					variant === 'tab'
						? H - size.h
						: clamp(H - floor - hb - size.h, EDGE, H - floor - size.h - inset),
				w,
				h: size.h,
			};
		}

		if (!min) app.openRect = rect;
		app.fixed = fullscreen;
		app.rect = rect;
		card.classList.toggle('is-hidden', hidden);
		Object.assign(card.style, {
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.w}px`,
			height: `${rect.h}px`,
		});

		if (app.initialized && !min) {
			const context = currentContext(app);
			const key = JSON.stringify(context);
			if (key !== app.lastContext) {
				app.lastContext = key;
				post(app, {
					jsonrpc: '2.0',
					method: 'ui/notifications/host-context-changed',
					params: context,
				});
			}
		}
	}
}

// ------------------------------------------------------------------- chrome

const badge = (count, unseen) => {
	const b = el(
		'span',
		`badge${unseen ? ' is-unseen' : ''}`,
		`▣${count > 1 ? ` ${count}` : ''}`,
	);
	b.title = unseen
		? 'A view opened here while you were elsewhere'
		: 'Has open views';
	return b;
};

function renderChrome() {
	for (const button of document.querySelectorAll('#variants button'))
		button.setAttribute(
			'aria-checked',
			String(button.dataset.variant === state.variant),
		);

	const dots = el('span', 'dots');
	dots.innerHTML = '<i></i><i></i><i></i>';
	$('projTabs').replaceChildren(
		dots,
		...projects.map((p) => {
			const b = el('button', 'proj', p.name);
			b.setAttribute('aria-selected', String(p.id === state.projectId));
			const count = p.terminals.reduce((n, t) => n + t.apps.size, 0);
			if (count)
				b.append(
					badge(
						count,
						p.terminals.some((t) => t.unseen > 0),
					),
				);
			b.onclick = () => showTerminal(terminals.get(p.activeSid));
			return b;
		}),
	);

	const add = el('button', 'tab add', '+');
	add.title = 'New terminal';
	add.onclick = () => showTerminal(createTerminal(project()));
	$('termTabs').replaceChildren(
		...project().terminals.map((t) => {
			const b = el('button', 'tab', t.name);
			b.setAttribute('aria-selected', String(t.sid === project().activeSid));
			if (t.apps.size) b.append(badge(t.apps.size, t.unseen > 0));
			b.onclick = () => showTerminal(t);
			return b;
		}),
		add,
	);

	$('statusName').textContent = current().name;
	for (const t of terminals.values())
		t.pane.classList.toggle('is-inactive', !isVisible(t));
}

function setVariant(variant) {
	state.variant = variant;
	localStorage.setItem('spike-variant', variant);
	renderChrome();
	for (const t of terminals.values()) {
		// Handle positions are per variant; start each one from its default.
		for (const app of t.apps.values()) {
			app.hx = null;
			app.hb = null;
		}
		layout(t);
	}
	current().term.focus();
}

$('variants').addEventListener('click', (event) => {
	const variant = event.target.closest('button')?.dataset.variant;
	if (variant) setVariant(variant);
});
for (const button of document.querySelectorAll('[data-cmd]')) {
	button.addEventListener('click', () => {
		const t = current();
		const submit = button.dataset.cmd === 'claude' ? '' : '\r';
		wsSend({
			t: 'input',
			sid: t.sid,
			d: (commands[button.dataset.cmd] ?? '') + submit,
		});
		t.term.focus();
	});
}
$('deviceToggle').addEventListener('click', () => {
	const phone = document.body.classList.toggle('is-phone');
	$('deviceToggle').textContent = phone ? 'Desktop size' : 'Phone size';
});
$('logToggle').addEventListener('click', () => {
	$('log').hidden = !$('log').hidden;
});

function log(direction, app, message) {
	const list = $('logList');
	const label = message.method ?? (message.error ? 'error' : 'result');
	const body =
		message.method === 'ui/notifications/sandbox-resource-ready'
			? '{html…}'
			: JSON.stringify(message.params ?? message.result ?? message.error ?? {});
	list.prepend(
		el(
			'li',
			direction,
			`${direction === 'in' ? 'view→host' : 'host→view'} ${app.t.name}/${app.id} ${label}${message.id !== undefined ? ` #${message.id}` : ''} ${body.slice(0, 160)}`,
		),
	);
	while (list.children.length > 300) list.lastChild.remove();
}

// Two projects, two terminals each, so every kind of switch can be tried.
for (const p of projects) {
	createTerminal(p);
	createTerminal(p);
}
renderChrome();
showTerminal(current());

// Debug handle for poking at the spike from the console.
window.spike = {
	state,
	projects,
	terminals,
	current,
	setVariant,
	setMin,
	showTerminal,
	layout,
};
