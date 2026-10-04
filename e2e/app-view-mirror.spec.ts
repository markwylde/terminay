import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import {
	APP_VIEW_PROXY_CONTENT_SECURITY_POLICY,
	DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
} from '../packages/ui-bundle/src/index';

/**
 * The view recorder and the replica inside the real sandbox (ADR-0039).
 *
 * A view runs in one sandbox proxy and its mirror in another, on a page served
 * under the exact workspace content security policy, with the proxy served
 * with the exact headers a Terminay Server sends. The page hands each recorded
 * batch straight to the replica; no server and no window layer are involved.
 */

let server: Server;
let origin: string;
let directory: string;

const VIEW = `
<style>.box { padding: 4px; } .added { color: rgb(10, 200, 30); }</style>
<h1 id="title">Recorded view</h1>
<input id="name" value="">
<input id="secret" type="password" value="">
<input id="agree" type="checkbox">
<select id="pick"><option value="a">A</option><option value="b">B</option></select>
<button id="add">Add</button>
<button id="evil" onclick="window.ran = 'handler'">Inline handler</button>
<a id="link" href="javascript:void(window.ran='link')">link</a>
<ul id="list"></ul>
<div id="tall" style="height: 900px"></div>
<script>
	document.getElementById('add').addEventListener('click', () => {
		const item = document.createElement('li');
		item.className = 'added';
		item.textContent = 'item ' + (document.querySelectorAll('li').length + 1);
		document.getElementById('list').append(item);
		document.getElementById('title').textContent = 'Changed';
		document.getElementById('title').setAttribute('data-state', 'changed');
	});
	window.flood = (bytes) => {
		const node = document.createElement('p');
		node.id = 'flood';
		node.textContent = 'x'.repeat(bytes);
		document.body.append(node);
	};
	window.ran = 'script';
</script>`;

test.beforeAll(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), 'terminay-app-view-mirror-'));
	await build({
		bundle: true,
		entryPoints: ['e2e/fixtures/app-view-mirror-main.ts'],
		outfile: path.join(directory, 'main.js'),
		format: 'esm',
		platform: 'browser',
		logLevel: 'silent',
	});
	const [script, proxy] = await Promise.all([
		readFile(path.join(directory, 'main.js')),
		readFile('public/app-view.html'),
	]);
	const html =
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mirror</title></head>' +
		'<body><script type="module" src="/main.js"></script></body></html>';
	const workspace = { 'content-security-policy': DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY };
	server = createServer((request, response) => {
		const url = new URL(request.url ?? '/', 'http://mirror');
		const send = (type: string, body: string | Buffer, headers: Record<string, string> = workspace) => {
			response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...headers });
			response.end(body);
		};
		if (url.pathname === '/') return send('text/html; charset=utf-8', html);
		if (url.pathname === '/main.js') return send('text/javascript; charset=utf-8', script);
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

type Spike = {
	state: { batches: { epoch: number; seq: number; kind: string; bytes: number; reason?: string }[]; reports: { type: string }[]; hold: boolean };
	resnapshot(): void;
	stop(): void;
	release(): void;
};
type SpikeWindow = Window & { startMirrorSpike(html: string): void; mirrorSpike: Spike };

const inner = (page: Page, id: string): FrameLocator => page.frameLocator(`#${id}`).frameLocator('iframe');
const batches = (page: Page) => page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.state.batches);

async function open(page: Page): Promise<{ view: FrameLocator; replica: FrameLocator }> {
	await page.goto(`${origin}/`);
	await page.waitForFunction(() => typeof (window as unknown as SpikeWindow).startMirrorSpike === 'function');
	await page.evaluate((html) => (window as unknown as SpikeWindow).startMirrorSpike(html), VIEW);
	const view = inner(page, 'view');
	const replica = inner(page, 'replica');
	await expect(replica.locator('#title')).toHaveText('Recorded view');
	return { view, replica };
}

test('a view recorded in the sandbox is redrawn live in a second sandbox', async ({ page }) => {
	const { view, replica } = await open(page);
	// The first batch is a whole snapshot, and the replica is as opaque as a view.
	expect((await batches(page))[0]).toMatchObject({ epoch: 1, seq: 0, kind: 'snapshot' });
	expect(await replica.locator('body').evaluate(() => self.origin)).toBe('null');
	// Styles came across.
	expect(await replica.locator('#add').evaluate((node) => node.tagName)).toBe('BUTTON');

	// DOM changes: added nodes, changed text, changed attributes.
	await view.locator('#add').click();
	await view.locator('#add').click();
	await expect(replica.locator('#list li')).toHaveText(['item 1', 'item 2']);
	await expect(replica.locator('#title')).toHaveText('Changed');
	await expect(replica.locator('#title')).toHaveAttribute('data-state', 'changed');
	expect(await replica.locator('#list li').first().evaluate((node) => getComputedStyle(node).color)).toBe('rgb(10, 200, 30)');

	// Form state: text, checkbox, select.
	await view.locator('#name').fill('typed by the controller');
	await view.locator('#agree').check();
	await view.locator('#pick').selectOption('b');
	await expect(replica.locator('#name')).toHaveValue('typed by the controller');
	await expect(replica.locator('#agree')).toBeChecked();
	await expect(replica.locator('#pick')).toHaveValue('b');

	// Scroll position follows.
	await view.locator('body').evaluate(() => scrollTo(0, 300));
	await expect.poll(() => replica.locator('body').evaluate(() => Math.round(scrollY))).toBe(300);

	// Batches after the snapshot are numbered in order within the epoch.
	const all = await batches(page);
	expect(all.every((batch) => batch.epoch === 1)).toBe(true);
	expect(all.map((batch) => batch.seq)).toEqual(all.map((_batch, index) => index));
	// The replica reported the recorded viewport.
	const reports = await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.state.reports);
	expect(reports.at(-1)).toMatchObject({ type: 'size', width: 440 });
});

test('nothing a recording carries can run in a mirror, and a password never leaves the view', async ({ page }) => {
	const { view, replica } = await open(page);
	const ran = (frame: FrameLocator) =>
		frame.locator('body').evaluate(() => String((window as unknown as { ran?: string }).ran));
	// The view's own script ran in the view...
	expect(await ran(view)).toBe('script');
	// ...and in the mirror it is not a script at all.
	await expect(replica.locator('script')).toHaveCount(0);
	expect(await ran(replica)).toBe('undefined');

	// An inline handler and a javascript: link are inert even when activated.
	await replica.locator('#evil').click();
	await replica.locator('#link').click();
	// The same two do run in the view, so the probe is a real one.
	await view.locator('#evil').click();
	expect(await ran(view)).toBe('handler');
	// A script element added later is inert too.
	await view.locator('body').evaluate(() => {
		const script = document.createElement('script');
		script.textContent = "window.ran = 'late-script'";
		document.body.append(script);
	});
	expect(await ran(view)).toBe('late-script');
	await view.locator('#add').click();
	await expect(replica.locator('#list li')).toHaveCount(1);
	expect(await ran(replica)).toBe('undefined');
	// The mirror still has no way out.
	expect(
		await replica.locator('body').evaluate(() => {
			try {
				return String(parent.parent.document.title);
			} catch {
				return 'denied';
			}
		}),
	).toBe('denied');

	// A password is masked before it is recorded.
	await view.locator('#secret').fill('hunter2');
	await view.locator('#name').fill('after');
	await expect(replica.locator('#name')).toHaveValue('after');
	await expect(replica.locator('#secret')).toHaveValue('*******');
});

test('the recorder waits for acknowledgement, restarts from a snapshot on request, and gives up on a view too large', async ({ page }) => {
	const { view, replica } = await open(page);

	// Held batches are not acknowledged, so at most one more is sent.
	await page.evaluate(() => {
		(window as unknown as SpikeWindow).mirrorSpike.state.hold = true;
	});
	const before = (await batches(page)).length;
	for (let index = 0; index < 5; index += 1) {
		await view.locator('#add').click();
		await page.waitForTimeout(80);
	}
	expect((await batches(page)).length - before).toBe(1);
	await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.release());
	await expect(replica.locator('#list li')).toHaveCount(5);

	// A fresh snapshot starts a new epoch at sequence 0, and the replica redraws from it.
	await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.resnapshot());
	await expect.poll(async () => (await batches(page)).at(-1)).toMatchObject({ epoch: 2, seq: 0, kind: 'snapshot' });
	await view.locator('#add').click();
	await expect(replica.locator('#list li')).toHaveCount(6);

	// Stopped, the recorder sends nothing; started again, it begins with a snapshot.
	await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.stop());
	await page.waitForTimeout(200);
	const stopped = (await batches(page)).length;
	await view.locator('#add').click();
	await page.waitForTimeout(200);
	expect((await batches(page)).length).toBe(stopped);
	await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.resnapshot());
	await expect.poll(async () => (await batches(page)).at(-1)).toMatchObject({ epoch: 3, seq: 0, kind: 'snapshot' });
	await expect(replica.locator('#list li')).toHaveCount(7);
	await view.locator('#add').click();
	await expect(replica.locator('#list li')).toHaveCount(8);
	await page.evaluate(() => (window as unknown as SpikeWindow).mirrorSpike.resnapshot());
	await expect.poll(async () => (await batches(page)).at(-1)).toMatchObject({ epoch: 4, seq: 0, kind: 'snapshot' });

	// More than a batch may hold becomes a snapshot instead.
	await view.locator('body').evaluate(() => (window as unknown as { flood(bytes: number): void }).flood(300 * 1024));
	await expect.poll(async () => (await batches(page)).at(-1)).toMatchObject({ epoch: 5, seq: 0, kind: 'snapshot' });
	await expect(replica.locator('#flood')).toHaveCount(1);

	// More than a snapshot may hold is not sent at all.
	await view.locator('body').evaluate(() => (window as unknown as { flood(bytes: number): void }).flood(900 * 1024));
	await expect.poll(async () => (await batches(page)).at(-1)).toMatchObject({ kind: 'unavailable', reason: 'too-large' });
	expect((await batches(page)).every((batch) => batch.bytes <= 768 * 1024)).toBe(true);
});
