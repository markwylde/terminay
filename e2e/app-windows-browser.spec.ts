import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Browser, FrameLocator, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import {
	APP_VIEW_PROXY_CONTENT_SECURITY_POLICY,
	DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
} from '../packages/ui-bundle/src/index';

/**
 * The app-window layer in a browser host (terminal-app-windows).
 *
 * The real window host runs in a plain browser page served over HTTP with the
 * exact workspace content security policy, and the sandbox proxy is served
 * with the exact headers a Terminay Server gives it. A stand-in for the
 * server's window store lets the page be the client that controls the
 * terminal, a client that only observes it, or a host with no proxy.
 */

test.describe.configure({ mode: 'default' });

let server: Server;
let origin: string;
let directory: string;

const PAGE_CSS = `
html, body { margin: 0; background: #0f1114; color: #e6e6e6; font: 13px system-ui; }
#tabs { height: 28px; padding: 4px 8px; }
.terminal-panel { position: relative; display: flex; flex-direction: column; background: #111316; color: #e6e6e6; }
.terminal-panel-root { flex: 1; min-height: 0; padding: 8px; }
`;

test.beforeAll(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), 'terminay-app-windows-harness-'));
	await build({
		bundle: true,
		entryPoints: ['e2e/fixtures/app-windows-harness-main.tsx'],
		outfile: path.join(directory, 'harness.js'),
		format: 'esm',
		platform: 'browser',
		jsx: 'automatic',
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'silent',
	});
	const [script, styles, proxy] = await Promise.all([
		readFile(path.join(directory, 'harness.js')),
		readFile(path.join(directory, 'harness.css')),
		readFile('public/app-view.html'),
	]);
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App windows harness</title><link rel="stylesheet" href="/page.css"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`;
	const workspace = { 'content-security-policy': DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY };
	server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://harness');
		const send = (type: string, body: string | Buffer, headers: Record<string, string> = workspace) => {
			response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...headers });
			response.end(body);
		};
		// `/` is a host that serves the proxy; `/no-proxy/` is one that does not.
		if (url.pathname === '/' || url.pathname === '/no-proxy/') return send('text/html; charset=utf-8', html);
		if (url.pathname === '/harness.js') return send('text/javascript; charset=utf-8', script);
		if (url.pathname === '/harness.css') return send('text/css; charset=utf-8', styles);
		if (url.pathname === '/page.css') return send('text/css; charset=utf-8', PAGE_CSS);
		if (url.pathname === '/app-view.html')
			return send('text/html; charset=utf-8', proxy, {
				'content-security-policy': APP_VIEW_PROXY_CONTENT_SECURITY_POLICY,
				'x-content-type-options': 'nosniff',
			});
		response.writeHead(404, workspace);
		response.end('not found');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
});

type Spec = { title: string; html: string; kind?: 'agent' | 'mcp-app'; toolInput?: unknown; toolResult?: unknown; csp?: unknown; broken?: boolean };
type HarnessWindow = Window & {
	harness: {
		calls: unknown[][];
		addWindow(spec: Spec): string;
		replaceWindow(id: string, html: string): void;
		setController(value: boolean): void;
		setPaneSize(width: number, height: number): void;
		windows(): { id: string; title: string; state: string }[];
	};
};

const PROBE = `<pre id="report">running</pre><input id="note" value=""><button id="send">Send</button>
<script>
(async () => {
	const report = { origin: self.origin };
	try { report.parent = String(parent.parent.document.title); } catch { report.parent = 'denied'; }
	try { report.storage = typeof localStorage.length; } catch { report.storage = 'denied'; }
	try { top.location = 'https://example.com/'; report.top = 'allowed'; } catch { report.top = 'denied'; }
	report.popup = window.open('https://example.com/') === null ? 'blocked' : 'opened';
	document.getElementById('report').textContent = JSON.stringify(report);
	document.getElementById('send').onclick = () => window.terminay.sendMessage('from the view');
})();
</script>`;

const APP_VIEW = `<!doctype html><html><body><pre id="out">waiting</pre><script>
const seen = {}; let id = 0; const pending = new Map();
const request = (method, params) => new Promise((resolve) => { const key = ++id; pending.set(key, resolve); parent.postMessage({ jsonrpc: '2.0', id: key, method, params }, '*'); });
addEventListener('message', (event) => {
	const m = event.data; if (!m || m.jsonrpc !== '2.0') return;
	if (m.method === 'ui/notifications/tool-input') seen.input = m.params.arguments;
	if (m.method === 'ui/notifications/tool-result') seen.result = m.params;
	if (m.method === 'ui/notifications/host-context-changed') seen.platform = m.params.platform;
	if (m.method === undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
	document.getElementById('out').textContent = JSON.stringify(seen);
});
(async () => {
	const init = await request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'x', version: '1' }, appCapabilities: {} });
	seen.displayMode = init.result.hostContext.displayMode;
	seen.platform = init.result.hostContext.platform;
	parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} }, '*');
	parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 300, height: 90 } }, '*');
	const polled = await request('tools/call', { name: 'poll', arguments: {} });
	seen.polled = polled.result.structuredContent;
	const violations = [];
	addEventListener('securitypolicyviolation', (event) => violations.push(event.blockedURI));
	for (const url of ['https://api.example/a', 'https://undeclared.example/b']) { try { await fetch(url, { mode: 'no-cors' }); } catch {} }
	await new Promise((resolve) => setTimeout(resolve, 50));
	const blocked = (host) => violations.some((uri) => uri.includes(host)) ? 'blocked' : 'allowed';
	seen.csp = { declared: blocked('api.example'), undeclared: blocked('undeclared.example') };
	document.getElementById('out').textContent = JSON.stringify(seen);
})();
</script></body></html>`;

const card = (page: Page, title: string): Locator =>
	page.locator('.app-window', { has: page.locator('.app-window__title', { hasText: title }) });
const view = (locator: Locator): FrameLocator =>
	locator.frameLocator('.app-window__frame').frameLocator('iframe');
const add = (page: Page, spec: Spec) => page.evaluate((value) => (window as unknown as HarnessWindow).harness.addWindow(value), spec);
const calls = (page: Page) => page.evaluate(() => (window as unknown as HarnessWindow).harness.calls);
const named = async (page: Page, name: string) => (await calls(page)).filter((call) => call[0] === name);

async function box(locator: Locator) {
	const value = await locator.boundingBox();
	if (value === null) throw new Error('no box');
	return value;
}

async function settled(locator: Locator): Promise<void> {
	let previous = '';
	await expect
		.poll(async () => {
			const value = await box(locator);
			const current = [value.x, value.y, value.width, value.height].map(Math.round).join(',');
			const same = current === previous;
			previous = current;
			return same;
		}, { intervals: [120] })
		.toBe(true);
}

async function open(page: Page, pathname = '/'): Promise<void> {
	await page.goto(`${origin}${pathname}`);
	await expect(page.locator('#pane')).toBeVisible();
}

test('in a browser under the workspace policy, a view runs isolated and the window behaves as on Desktop', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	await add(page, { title: 'Probe', html: PROBE });
	const probe = card(page, 'Probe');
	await expect(probe).toHaveAttribute('data-placement', 'window');
	// The view ran its inline script, which the workspace policy forbids to a
	// frame the workspace creates directly, and it can reach nothing.
	const report = view(probe).locator('#report');
	await expect(report).toContainText('"popup"');
	expect(JSON.parse((await report.textContent()) ?? '{}')).toEqual({
		origin: 'null',
		parent: 'denied',
		storage: 'denied',
		top: 'denied',
		popup: 'blocked',
	});
	expect(page.url()).toBe(`${origin}/`);
	// The proxy document itself is opaque too.
	expect(await probe.frameLocator('.app-window__frame').locator('body').evaluate(() => self.origin)).toBe('null');

	// Bottom-left, 440 wide, content height, no rail while it is open.
	await settled(probe);
	const pane = await box(page.locator('#pane'));
	const opened = await box(probe);
	expect(Math.round(opened.x - pane.x)).toBe(12);
	expect(Math.round(opened.width)).toBe(440);
	expect(Math.round(pane.y + pane.height - (opened.y + opened.height))).toBe(12);
	const terminalBefore = await box(page.locator('#terminal'));
	await expect(page.getByRole('img', { name: '1 app window' })).toBeVisible();

	// Minimised: a tab on the edge, and the terminal ends above the rail.
	await probe.getByRole('button', { name: 'Minimise window' }).click();
	await expect(probe).toHaveAttribute('data-placement', 'tab');
	await settled(probe);
	const tab = await box(probe);
	expect(Math.round(tab.y + tab.height)).toBe(Math.round(pane.y + pane.height));
	await expect.poll(async () => Math.round(terminalBefore.height - (await box(page.locator('#terminal'))).height)).toBe(33);
	expect(await named(page, 'focusTerminal')).toHaveLength(1);

	// The tab can be opened from the keyboard.
	await probe.locator('.app-window__header').focus();
	await page.keyboard.press('Enter');
	await expect(probe).toHaveAttribute('data-placement', 'window');
	await expect.poll(async () => Math.round((await box(page.locator('#terminal'))).height)).toBe(Math.round(terminalBefore.height));

	// A message goes to the server and the window gets out of the way.
	await settled(probe);
	await view(probe).locator('#send').click();
	await expect.poll(async () => named(page, 'sendMessage')).toEqual([['sendMessage', 'win_1', 'from the view']]);
	await expect(probe).toHaveAttribute('data-placement', 'tab');
});

test('an MCP App view gets its input and result, reaches its server, and obeys its declared policy', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	await add(page, {
		title: 'Draw',
		kind: 'mcp-app',
		html: APP_VIEW,
		toolInput: { shape: 'circle' },
		toolResult: { content: [{ type: 'text', text: 'drawn' }], structuredContent: { shapes: 1 } },
		csp: { connectDomains: ['https://api.example'] },
	});
	const draw = card(page, 'Draw');
	await expect(draw.locator('.app-window__source')).toHaveText('diagrams · draw');
	const out = view(draw).locator('#out');
	await expect(out).toContainText('"csp"');
	expect(JSON.parse((await out.textContent()) ?? '{}')).toEqual({
		displayMode: 'pip',
		platform: 'desktop',
		input: { shape: 'circle' },
		result: { content: [{ type: 'text', text: 'drawn' }], structuredContent: { shapes: 1 } },
		polled: { polled: true },
		csp: { declared: 'allowed', undeclared: 'blocked' },
	});
	expect(await named(page, 'viewRequest')).toEqual([['viewRequest', 'win_1', 'tools/call', { name: 'poll', arguments: {} }]]);
	// The view said it is 90 tall; the window is that plus its title bar.
	await settled(draw);
	expect(Math.round((await box(draw)).height)).toBe(32 + 90);

	// Filling the pane tells the view its display mode changed.
	await draw.getByRole('button', { name: 'Fill the pane' }).click();
	await expect(draw).toHaveAttribute('data-placement', 'fullscreen');
	await draw.getByRole('button', { name: 'Restore window size' }).click();
	await expect(draw).toHaveAttribute('data-placement', 'window');
});

test('only the client that controls the terminal runs a view; control moving moves the view', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	await add(page, { title: 'Probe', html: PROBE });
	const probe = card(page, 'Probe');
	await expect(view(probe).locator('#report')).toContainText('"origin"');
	await view(probe).locator('#note').fill('typed here');
	expect(await named(page, 'content')).toHaveLength(1);

	// Another device takes control: this client stops running the view.
	await page.evaluate(() => (window as unknown as HarnessWindow).harness.setController(false));
	await expect(probe.locator('.app-window__frame')).toHaveCount(0);
	await expect(probe).toContainText('This window runs on the device controlling the terminal.');
	// The window itself is unchanged: still listed, still open, still badged.
	expect(await page.evaluate(() => (window as unknown as HarnessWindow).harness.windows())).toEqual([{ id: 'win_1', title: 'Probe', state: 'open' }]);
	await expect(page.getByRole('img', { name: '1 app window' })).toBeVisible();
	// Minimising and restoring still work for an observer; no view runs.
	await probe.getByRole('button', { name: 'Minimise window' }).click();
	await expect(probe).toHaveAttribute('data-placement', 'tab');
	await probe.locator('.app-window__header').click();
	await expect(probe).toHaveAttribute('data-placement', 'window');
	await expect(probe.locator('.app-window__frame')).toHaveCount(0);
	expect(await named(page, 'sendMessage')).toHaveLength(0);

	// The observer is offered the terminal's ordinary takeover.
	await probe.getByRole('button', { name: 'Take control' }).click();
	expect(await named(page, 'takeControl')).toHaveLength(1);
	// Now in control, it starts the view afresh from the server's record:
	// same content, and nothing of the state the old view held.
	await expect(view(probe).locator('#report')).toContainText('"origin"');
	await expect(view(probe).locator('#note')).toHaveValue('');
	expect(await named(page, 'content')).toHaveLength(2);
});

test('an agent replacing its document gets a new view in the same window', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	const id = await add(page, { title: 'Doc', html: '<p id="v">first</p>' });
	const doc = card(page, 'Doc');
	await expect(view(doc).locator('#v')).toHaveText('first');
	await page.evaluate((windowId) => (window as unknown as HarnessWindow).harness.replaceWindow(windowId, '<p id="v">second</p>'), id);
	await expect(view(doc).locator('#v')).toHaveText('second');
	await expect(page.locator('.app-window')).toHaveCount(1);
});

test('a host that cannot frame the proxy reports app windows unavailable and runs nothing', async ({ page }) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page, '/no-proxy/');
	await add(page, { title: 'Probe', html: PROBE });
	const probe = card(page, 'Probe');
	await expect(probe).toContainText('App windows cannot be shown on this connection.', { timeout: 15_000 });
	await expect(probe.locator('.app-window__frame')).toHaveCount(0);
	expect(await named(page, 'content')).toHaveLength(0);
});

function mobile(browser: Browser) {
	return browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 740 } });
}

test('on a touch phone the window is a sheet, and its tab is dragged by touch along the edge only', async ({ browser }) => {
	const context = await mobile(browser);
	const page = await context.newPage();
	try {
		await open(page);
		await page.evaluate(() => (window as unknown as HarnessWindow).harness.setPaneSize(390, 640));
		await add(page, { title: 'Draw', kind: 'mcp-app', html: APP_VIEW, toolInput: {}, toolResult: { content: [] } });
		const sheet = card(page, 'Draw');
		await expect(sheet).toHaveAttribute('data-placement', 'sheet');
		await expect(view(sheet).locator('#out')).toContainText('"platform":"mobile"');
		await settled(sheet);
		const pane = await box(page.locator('#pane'));
		const opened = await box(sheet);
		expect([Math.round(opened.x), Math.round(opened.width)]).toEqual([Math.round(pane.x), 390]);
		expect(Math.round(opened.y + opened.height)).toBe(Math.round(pane.y + pane.height));
		// Touch-sized controls.
		const minimise = sheet.getByRole('button', { name: 'Minimise window' });
		expect((await box(minimise)).height).toBeGreaterThanOrEqual(30);
		await minimise.tap();
		await expect(sheet).toHaveAttribute('data-placement', 'tab');
		await settled(sheet);
		const tab = await box(sheet);
		expect(Math.round(tab.height)).toBe(34);

		// A touch drag: sideways it follows the finger, vertically it does not.
		const header = sheet.locator('.app-window__header');
		const start = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 };
		const touch = (type: string, x: number, y: number) =>
			header.dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true });
		await touch('pointerdown', start.x, start.y);
		for (let step = 1; step <= 6; step += 1) await touch('pointermove', start.x + step * 25, start.y - step * 40);
		await touch('pointerup', start.x + 150, start.y - 240);
		await settled(sheet);
		const moved = await box(sheet);
		expect(moved.x).toBeGreaterThan(tab.x + 100);
		expect(Math.round(moved.y)).toBe(Math.round(tab.y));
		await expect(sheet).toHaveAttribute('data-placement', 'tab');
		// A tap opens it again.
		await header.tap();
		await expect(sheet).toHaveAttribute('data-placement', 'sheet');
	} finally {
		await context.close();
	}
});

test('the proxy opened on its own, outside the workspace, is an opaque origin with nothing to reach', async ({ page }) => {
	await page.goto(`${origin}/app-view.html`);
	expect(await page.evaluate(() => self.origin)).toBe('null');
	expect(
		await page.evaluate(() => {
			try {
				return typeof localStorage.length;
			} catch {
				return 'denied';
			}
		}),
	).toBe('denied');
});

// --- the view mirror (ADR-0039): two clients of one terminal ---

const MIRRORED = `<style>.added { color: rgb(10, 200, 30); }</style>
<h1 id="title">Deploy</h1>
<input id="name" value="">
<input id="secret" type="password" value="">
<button id="add">Add</button>
<button id="send">Send</button>
<ul id="list"></ul>
<script>
	document.getElementById('add').onclick = () => {
		const item = document.createElement('li');
		item.className = 'added';
		item.textContent = 'item ' + (document.querySelectorAll('li').length + 1);
		document.getElementById('list').append(item);
	};
	document.getElementById('send').onclick = () => window.terminay.sendMessage('from the view');
	window.flood = (bytes) => {
		const node = document.createElement('p');
		node.id = 'flood';
		node.style.cssText = 'height:0;overflow:hidden;margin:0';
		node.textContent = 'x'.repeat(bytes);
		document.body.append(node);
	};
</script>`;

type MirrorLogEntry = { direction: string; kind: string; epoch: number; seq: number };
const mirrorOf = (locator: Locator): FrameLocator =>
	locator.frameLocator('.app-window__mirror-frame').frameLocator('iframe');
const mirrorLog = (page: Page): Promise<MirrorLogEntry[]> =>
	page.evaluate(
		() => (window as unknown as { harness: { mirrorLog: MirrorLogEntry[] } }).harness.mirrorLog,
	);

async function twoClients(browser: Browser, observerViewport = { width: 1100, height: 760 }) {
	const context = await browser.newContext({ viewport: { width: 1100, height: 760 } });
	const controller = await context.newPage();
	await open(controller, '/?mirror');
	const join = async (): Promise<Page> => {
		const observer = await context.newPage();
		await observer.setViewportSize(observerViewport);
		await open(observer, '/?mirror&role=observer');
		return observer;
	};
	return { context, controller, join };
}

test('an observer sees the controlling client’s view live, read-only, and only while it watches', async ({ browser }) => {
	const { context, controller, join } = await twoClients(browser);
	try {
		const id = await add(controller, { title: 'Deploy', html: MIRRORED });
		const running = card(controller, 'Deploy');
		await expect(view(running).locator('#title')).toHaveText('Deploy');
		// State the view reaches before anyone else is attached.
		await view(running).locator('#name').fill('typed before anyone watched');
		await view(running).locator('#add').click();
		// Nobody is watching, so nothing was recorded.
		expect(await mirrorLog(controller)).toEqual([]);

		// A second client attaches and sees the view as it is now.
		const observer = await join();
		const mirrored = card(observer, 'Deploy');
		await expect(mirrored.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live');
		const replica = mirrorOf(mirrored);
		await expect(replica.locator('#title')).toHaveText('Deploy');
		await expect(replica.locator('#name')).toHaveValue('typed before anyone watched');
		await expect(replica.locator('#list li')).toHaveText(['item 1']);
		// The observer runs no view of its own, and says what it is showing.
		await expect(mirrored.locator('.app-window__frame')).toHaveCount(0);
		await expect(mirrored.locator('.app-window__mirror-bar')).toContainText('Mirror, view only');
		expect((await mirrorLog(controller))[0]).toMatchObject({ direction: 'out', kind: 'snapshot', seq: 0 });

		// What the person in control does appears without the observer doing anything.
		await view(running).locator('#name').fill('typed live');
		await view(running).locator('#add').click();
		await expect(replica.locator('#name')).toHaveValue('typed live');
		await expect(replica.locator('#list li')).toHaveText(['item 1', 'item 2']);
		expect(await replica.locator('#list li').first().evaluate((node) => getComputedStyle(node).color)).toBe('rgb(10, 200, 30)');
		// A password is masked before it leaves the controlling client.
		await view(running).locator('#secret').fill('hunter2');
		await expect(replica.locator('#secret')).toHaveValue('*******');

		// The mirror is the same size as the view, and takes no input.
		await settled(running);
		await settled(mirrored);
		expect(Math.round((await box(mirrored)).width)).toBe(Math.round((await box(running)).width));
		const stage = await box(mirrored.locator('.app-window__mirror-stage'));
		await observer.mouse.click(stage.x + 60, stage.y + 30);
		await observer.mouse.click(stage.x + 40, stage.y + stage.height / 2);
		await observer.keyboard.type('typed at the mirror');
		await observer.waitForTimeout(300);
		await expect(view(running).locator('#name')).toHaveValue('typed live');
		await expect(view(running).locator('#list li')).toHaveCount(2);
		expect(await named(observer, 'sendMessage')).toHaveLength(0);
		expect(await named(controller, 'sendMessage')).toHaveLength(0);
		expect((await mirrorLog(observer)).every((entry) => entry.direction === 'in')).toBe(true);

		// The agent replaces the document: the mirror follows.
		await controller.evaluate((windowId) => (window as unknown as HarnessWindow).harness.replaceWindow(windowId, '<p id="v">second version</p>'), id);
		await expect(view(running).locator('#v')).toHaveText('second version');

		await expect(replica.locator('#v')).toHaveText('second version');
		await expect(replica.locator('#title')).toHaveCount(0);

		// Minimised, the observer shows a tab and stops watching; the recording stops with it.
		await mirrored.getByRole('button', { name: 'Minimise window' }).click();
		await expect(mirrored).toHaveAttribute('data-placement', 'tab');
		await expect(running).toHaveAttribute('data-placement', 'tab');
		await expect.poll(async () => (await named(observer, 'unwatchMirror')).length).toBe(1);
		const sent = (await mirrorLog(controller)).length;
		await running.locator('.app-window__header').click();
		await expect(running).toHaveAttribute('data-placement', 'window');
		// Reopened on both, the observer watches again and is in step again.
		await expect(mirrored.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live');
		await expect(mirrorOf(mirrored).locator('#v')).toHaveText('second version');
		expect((await mirrorLog(controller)).length).toBeGreaterThan(sent);
	} finally {
		await context.close();
	}
});

test('taking control from an observer swaps who runs the view and who mirrors it', async ({ browser }) => {
	const { context, controller, join } = await twoClients(browser);
	try {
		await add(controller, { title: 'Deploy', html: MIRRORED });
		const first = card(controller, 'Deploy');
		await view(first).locator('#name').fill('half-filled form');
		const observer = await join();
		const second = card(observer, 'Deploy');
		await expect(mirrorOf(second).locator('#name')).toHaveValue('half-filled form');

		// The prompt says what taking control does to the window.
		await expect(second.locator('.app-window__mirror-bar')).toContainText('Taking control restarts this window');
		await second.getByRole('button', { name: 'Take control' }).click();

		// The former observer runs the view, afresh from the stored document.
		await expect(view(second).locator('#title')).toHaveText('Deploy');
		await expect(view(second).locator('#name')).toHaveValue('');
		await expect(second.locator('.app-window__mirror')).toHaveCount(0);
		// The former controller stops running it and mirrors the new one.
		await expect(first.locator('.app-window__frame')).toHaveCount(0);
		await expect(first.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live');
		await view(second).locator('#name').fill('typed on the new controller');
		await expect(mirrorOf(first).locator('#name')).toHaveValue('typed on the new controller');
		// Only the client in control publishes.
		const after = (await mirrorLog(controller)).length;
		await view(second).locator('#add').click();
		await expect(mirrorOf(first).locator('#list li')).toHaveCount(1);
		expect((await mirrorLog(controller)).slice(after).every((entry) => entry.direction === 'in')).toBe(true);
	} finally {
		await context.close();
	}
});

test('a mirror is scaled to fit a phone, a large view is streamed whole, and a connection that cannot keep up says so', async ({ browser }) => {
	const { context, controller, join } = await twoClients(browser, { width: 390, height: 740 });
	try {
		await add(controller, { title: 'Deploy', html: MIRRORED });
		const running = card(controller, 'Deploy');
		await expect(view(running).locator('#title')).toHaveText('Deploy');
		const phone = await join();
		await phone.evaluate(() => (window as unknown as HarnessWindow).harness.setPaneSize(390, 640));
		const sheet = card(phone, 'Deploy');
		await expect(sheet).toHaveAttribute('data-placement', 'sheet');
		await expect(sheet.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live');
		await expect(mirrorOf(sheet).locator('#title')).toHaveText('Deploy');

		// The whole width of the 440-wide view fits the 390-wide sheet.
		await settled(sheet);
		const frame = sheet.locator('.app-window__mirror-frame');
		const drawn = await box(frame);
		expect(Math.round(drawn.width)).toBe(390);
		expect(await frame.evaluate((node) => (node as HTMLElement).offsetWidth)).toBe(440);
		const stage = await box(sheet.locator('.app-window__mirror-stage'));
		expect(Math.round(drawn.height)).toBeLessThanOrEqual(Math.round(stage.height) + 1);
		expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

		// A view far larger than one message carries is streamed in parts and mirrored whole.
		const flood = (bytes: number) =>
			view(running).locator('body').evaluate((_body, size) => (window as unknown as { flood(bytes: number): void }).flood(size), bytes);
		await flood(2 * 1024 * 1024);
		const replica = mirrorOf(sheet);
		await expect(replica.locator('#flood')).toHaveCount(1, { timeout: 20_000 });
		expect(await replica.locator('#flood').evaluate((node) => node.textContent?.length)).toBe(2 * 1024 * 1024);
		await expect(sheet.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live');
		expect((await mirrorLog(controller)).some((entry) => entry.kind === 'unavailable')).toBe(false);

		// A connection that keeps losing part of each snapshot asks a few times, then says so and stops.
		await phone.evaluate(() => (window as unknown as { harness: { setLossy(value: boolean): void } }).harness.setLossy(true));
		await flood(400 * 1024);
		await expect(sheet.locator('.app-window__mirror')).toHaveAttribute('data-status', 'unavailable', { timeout: 20_000 });
		await expect(sheet.locator('.app-window__mirror-status')).toContainText('cannot be mirrored right now');
		await expect(sheet.getByRole('button', { name: 'Take control' })).toBeVisible();
		expect(await named(phone, 'resyncMirror')).toHaveLength(4);
		// The view is unaffected where it runs.
		await view(running).locator('#add').click();
		await expect(view(running).locator('#list li')).toHaveCount(1);
		// It does not keep asking.
		await phone.waitForTimeout(500);
		expect(await named(phone, 'resyncMirror')).toHaveLength(4);

		// When a snapshot next arrives whole, the mirror is back.
		await phone.evaluate(() => (window as unknown as { harness: { setLossy(value: boolean): void } }).harness.setLossy(false));
		await flood(400 * 1024);
		await expect(sheet.locator('.app-window__mirror')).toHaveAttribute('data-status', 'live', { timeout: 20_000 });
		await expect(replica.locator('#flood')).toHaveCount(3);
		await expect(replica.locator('#list li')).toHaveCount(1);
	} finally {
		await context.close();
	}
});

// --- a view is told before it is removed; a window that cannot load says so ---

const TEARDOWN_VIEW = (name: string) => `<p id="v">${name}</p><script>
addEventListener('message', (event) => {
	const message = event.data;
	if (message && message.method === 'ui/resource-teardown')
		window.terminay.updateContext('${name} heard teardown: ' + message.params.reason);
});
</script>`;

test('a view is told it is going before its frame is removed: on close, on replacement, and when control moves', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	const heard = async () => (await named(page, 'updateContext')).map((call) => call[2]);

	// The agent replaces the document.
	const id = await add(page, { title: 'Doc', html: TEARDOWN_VIEW('first') });
	const doc = card(page, 'Doc');
	await expect(view(doc).locator('#v')).toHaveText('first');
	await page.evaluate(
		([windowId, html]) => (window as unknown as HarnessWindow).harness.replaceWindow(windowId as string, html as string),
		[id, TEARDOWN_VIEW('second')],
	);
	await expect(view(doc).locator('#v')).toHaveText('second');
	await expect.poll(heard).toEqual(['first heard teardown: replaced']);

	// Control moves to another device.
	await page.evaluate(() => (window as unknown as HarnessWindow).harness.setController(false));
	await expect(doc.locator('.app-window__frame')).toHaveCount(0);
	await expect.poll(heard).toEqual(['first heard teardown: replaced', 'second heard teardown: closed']);
	await page.evaluate(() => (window as unknown as HarnessWindow).harness.setController(true));
	await expect(view(doc).locator('#v')).toHaveText('second');

	// The window is closed.
	await doc.getByRole('button', { name: 'Close window' }).click();
	await expect(doc).toHaveCount(0);
	expect(await heard()).toEqual([
		'first heard teardown: replaced',
		'second heard teardown: closed',
		'second heard teardown: closed',
	]);
});

test('a window whose content cannot be loaded says so', async ({ page }) => {
	await page.setViewportSize({ width: 1100, height: 760 });
	await open(page);
	await add(page, { title: 'Broken', html: '<p>never shown</p>', broken: true });
	const broken = card(page, 'Broken');
	await expect(broken).toContainText('This window could not be loaded.');
	await expect(broken.locator('.app-window__frame')).toHaveCount(0);
	// It can still be closed.
	await broken.getByRole('button', { name: 'Close window' }).click();
	await expect(broken).toHaveCount(0);
});
