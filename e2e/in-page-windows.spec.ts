import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY } from '../packages/ui-bundle/src/index';

/**
 * The in-page window frame in a browser host (in-page-windows).
 *
 * The real frame runs in a plain browser page served with the workspace
 * content security policy, around stand-in content: one resizable management
 * window, one content-sized window, the framed About document, and a dialog
 * opened from inside a window.
 */

test.describe.configure({ mode: 'default' });

let server: Server;
let origin: string;
let directory: string;

const PAGE_CSS = `
html, body { margin: 0; height: 100%; background: #0b0e13; color: #dce2f0; font: 13px system-ui; }
.harness-content { padding: 20px; }
.harness-tall { height: 900px; }
.harness-about { display: block; width: 100%; height: 464px; border: 0; }
`;

const STORAGE_KEY = 'terminay.view.in-page-window.v1';

test.beforeAll(async () => {
	directory = await mkdtemp(path.join(os.tmpdir(), 'terminay-in-page-windows-harness-'));
	await build({
		bundle: true,
		entryPoints: ['e2e/fixtures/in-page-windows-harness-main.tsx'],
		outfile: path.join(directory, 'harness.js'),
		format: 'esm',
		platform: 'browser',
		jsx: 'automatic',
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'silent',
	});
	const [script, styles] = await Promise.all([
		readFile(path.join(directory, 'harness.js')),
		readFile(path.join(directory, 'harness.css')),
	]);
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>In-page windows harness</title><link rel="stylesheet" href="/page.css"><link rel="stylesheet" href="/harness.css"></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`;
	const headers = { 'content-security-policy': DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY, 'cache-control': 'no-store' };
	server = createServer((request, response) => {
		const { pathname } = new URL(request.url ?? '/', 'http://harness');
		const send = (type: string, body: string | Buffer) => {
			response.writeHead(200, { 'content-type': type, ...headers });
			response.end(body);
		};
		if (pathname === '/') return send('text/html; charset=utf-8', html);
		if (pathname === '/harness.js') return send('text/javascript; charset=utf-8', script);
		if (pathname === '/harness.css') return send('text/css; charset=utf-8', styles);
		if (pathname === '/page.css') return send('text/css; charset=utf-8', PAGE_CSS);
		response.writeHead(404, headers);
		response.end('not found');
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	await rm(directory, { recursive: true, force: true });
});

type Box = { x: number; y: number; width: number; height: number };

const VIEWPORT = { width: 1400, height: 900 };

async function openHarness(page: Page, viewport = VIEWPORT): Promise<void> {
	await page.setViewportSize(viewport);
	await page.goto(origin);
}

async function openWindow(page: Page, name: string): Promise<Locator> {
	await page.locator(`[data-open="${name}"]`).click();
	const frame = page.locator(`[data-in-page-window="${name}"]`);
	await expect(frame).toBeVisible();
	return frame;
}

async function boxOf(locator: Locator): Promise<Box> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('Expected the window to have a layout box');
	return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

async function drag(page: Page, from: { x: number; y: number }, deltaX: number, deltaY: number): Promise<void> {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + deltaX / 2, from.y + deltaY / 2, { steps: 4 });
	await page.mouse.move(from.x + deltaX, from.y + deltaY, { steps: 4 });
	await page.mouse.up();
}

/** A point on the title bar that is not on a control. */
const titleBar = (box: Box) => ({ x: box.x + 100, y: box.y + 18 });

test('a management window has one title bar with maximise and close', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
	await expect(frame).toHaveAttribute('aria-modal', 'true');
	await expect(frame.getByRole('heading', { name: 'Settings' })).toHaveCount(1);
	await expect(frame.getByRole('button', { name: 'Close' })).toHaveCount(1);
	await expect(frame.getByRole('button', { name: 'Maximise' })).toBeVisible();
	expect(await boxOf(frame)).toEqual({ x: 250, y: 150, width: 900, height: 600 });
});

test('a window is moved by its title bar and its title bar stays reachable', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const start = await boxOf(frame);
	await drag(page, titleBar(start), 200, 0);
	expect(await boxOf(frame)).toEqual({ ...start, x: start.x + 200 });

	await drag(page, titleBar(await boxOf(frame)), 0, -5000);
	expect((await boxOf(frame)).y).toBe(0);

	await drag(page, titleBar(await boxOf(frame)), 5000, 0);
	expect((await boxOf(frame)).x).toBe(VIEWPORT.width - 160);

	const beforePress = await boxOf(frame);
	await page.mouse.click(beforePress.x + 60, beforePress.y + 18);
	expect(await boxOf(frame)).toEqual(beforePress);
});

test('pressing close on the title bar closes the window without moving it', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	await frame.getByRole('button', { name: 'Close' }).click();
	await expect(frame).toHaveCount(0);
});

test('a management window is resized from edges and corners down to its minimum', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const start = await boxOf(frame);

	await drag(page, { x: start.x + start.width, y: start.y + 300 }, 150, 0);
	expect(await boxOf(frame)).toEqual({ ...start, width: start.width + 150 });

	const widened = await boxOf(frame);
	await drag(page, { x: widened.x, y: widened.y }, -40, -30);
	expect(await boxOf(frame)).toEqual({ x: widened.x - 40, y: widened.y - 30, width: widened.width + 40, height: widened.height + 30 });

	const grown = await boxOf(frame);
	await drag(page, { x: grown.x + grown.width, y: grown.y + grown.height }, -5000, -5000);
	expect(await boxOf(frame)).toEqual({ x: grown.x, y: grown.y, width: 480, height: 320 });

	await expect(frame.locator('[data-in-page-window-resize="e"]')).toHaveCSS('cursor', 'ew-resize');
	await expect(frame.locator('[data-in-page-window-resize="nw"]')).toHaveCSS('cursor', 'nwse-resize');
});

test('a resize that ends over the backdrop leaves the window open', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const start = await boxOf(frame);
	await drag(page, { x: start.x + start.width, y: start.y + 300 }, 120, 0);
	await expect(frame).toBeVisible();
	expect((await boxOf(frame)).width).toBe(start.width + 120);
});

test('maximise fills the viewport and restore returns the earlier rectangle', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	await drag(page, titleBar(await boxOf(frame)), -60, 40);
	const placed = await boxOf(frame);

	await frame.getByRole('button', { name: 'Maximise' }).click();
	expect(await boxOf(frame)).toEqual({ x: 0, y: 0, ...VIEWPORT });
	await expect(frame.locator('[data-in-page-window-resize]')).toHaveCount(0);

	// A maximised window does not move.
	await drag(page, { x: 100, y: 18 }, 150, 150);
	expect(await boxOf(frame)).toEqual({ x: 0, y: 0, ...VIEWPORT });

	await frame.locator('.in-page-window__titlebar').dblclick({ position: { x: 100, y: 18 } });
	expect(await boxOf(frame)).toEqual(placed);
	await frame.locator('.in-page-window__titlebar').dblclick({ position: { x: 100, y: 18 } });
	await expect(frame.getByRole('button', { name: 'Restore' })).toBeVisible();
});

test('a content-sized window has no maximise or resize and reopens centred', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'about');
	await expect(frame.getByRole('button', { name: 'Maximise' })).toHaveCount(0);
	await expect(frame.locator('[data-in-page-window-resize]')).toHaveCount(0);
	await expect(frame.locator('iframe')).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
	const centred = await boxOf(frame);
	expect(centred.width).toBe(440);

	await frame.locator('.in-page-window__titlebar').dblclick({ position: { x: 100, y: 18 } });
	expect(await boxOf(frame)).toEqual(centred);

	// The drag passes over the framed document and the window keeps following.
	await drag(page, titleBar(centred), 0, 300);
	expect(await boxOf(frame)).toEqual({ ...centred, y: centred.y + 300 });

	await frame.getByRole('button', { name: 'Close' }).click();
	expect(await boxOf(await openWindow(page, 'about'))).toEqual(centred);
});

test('the page behind is inert to the keyboard and focus returns on close', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	for (let press = 0; press < 12; press += 1) {
		await page.keyboard.press('Tab');
		expect(await page.evaluate(() => document.activeElement?.closest('[data-in-page-window]') !== null)).toBe(true);
	}
	await page.keyboard.press('Shift+Tab');
	expect(await page.evaluate(() => document.activeElement?.closest('[data-in-page-window]') !== null)).toBe(true);

	await page.keyboard.press('Escape');
	await expect(frame).toHaveCount(0);
	await expect(page.locator('[data-open="settings"]')).toBeFocused();
});

test('a window that focuses its own field keeps that focus', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'edit-tab');
	await expect(frame.getByRole('textbox', { name: 'Name' })).toBeFocused();
});

test('pressing the backdrop closes the window', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	await page.mouse.click(5, 5);
	await expect(frame).toHaveCount(0);
});

test('a dialog opened from a window stacks above it and one Escape closes one', async ({ page }) => {
	await openHarness(page);
	const settings = await openWindow(page, 'settings');
	await settings.locator('[data-open-pairing]').click();
	const pairing = page.getByRole('dialog', { name: 'Pair Device' });
	await expect(pairing).toBeVisible();

	// The nested dialog is centred in the viewport, not inside its parent.
	const box = await boxOf(pairing);
	expect(box.x).toBe((VIEWPORT.width - 400) / 2);
	expect(Math.abs(box.y + box.height / 2 - VIEWPORT.height / 2)).toBeLessThanOrEqual(1);

	await page.keyboard.press('Escape');
	await expect(pairing).toHaveCount(0);
	await expect(settings).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(settings).toHaveCount(0);
});

test('a control popup inside a window opens above the frame', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const theme = frame.getByRole('combobox', { name: 'Theme' });
	await theme.selectOption('light');
	await expect(theme).toHaveValue('light');
});

test('geometry is remembered per window across a reload and refitted to the viewport', async ({ page }) => {
	await openHarness(page);
	let frame = await openWindow(page, 'settings');
	const start = await boxOf(frame);
	await drag(page, titleBar(start), -100, 60);
	const moved = await boxOf(frame);
	await drag(page, { x: moved.x + moved.width, y: moved.y + 300 }, 130, 0);
	const placed = await boxOf(frame);
	await page.keyboard.press('Escape');

	await page.reload();
	frame = await openWindow(page, 'settings');
	expect(await boxOf(frame)).toEqual(placed);
	await page.keyboard.press('Escape');

	// Another window has its own geometry: none yet, so it opens centred.
	expect(await boxOf(await openWindow(page, 'recordings'))).toEqual(start);
	await page.keyboard.press('Escape');

	// The stored value is numbers and one flag, keyed by window id only.
	const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STORAGE_KEY);
	expect(stored).toEqual({ settings: { x: placed.x, y: placed.y, width: placed.width, height: placed.height, maximized: false } });

	await page.setViewportSize({ width: 800, height: 500 });
	await page.reload();
	const fitted = await boxOf(await openWindow(page, 'settings'));
	expect(fitted.x).toBeGreaterThanOrEqual(0);
	expect(fitted.y).toBeGreaterThanOrEqual(0);
	expect(fitted.x + fitted.width).toBeLessThanOrEqual(800);
	expect(fitted.y + fitted.height).toBeLessThanOrEqual(500);
});

test('a window opens at its default and works when storage is unavailable', async ({ page }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, 'localStorage', {
			get() {
				throw new DOMException('denied', 'SecurityError');
			},
		});
	});
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const start = await boxOf(frame);
	expect(start).toEqual({ x: 250, y: 150, width: 900, height: 600 });
	await drag(page, titleBar(start), 50, 50);
	expect(await boxOf(frame)).toEqual({ ...start, x: start.x + 50, y: start.y + 50 });
	await frame.getByRole('button', { name: 'Close' }).click();
	await expect(frame).toHaveCount(0);
});

test('a window follows a shrinking viewport and returns when it widens', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	await drag(page, titleBar(await boxOf(frame)), 200, 0);
	const placed = await boxOf(frame);

	await page.setViewportSize({ width: 1000, height: 900 });
	await expect.poll(() => boxOf(frame)).toEqual({ ...placed, x: 100 });

	await page.setViewportSize({ width: 700, height: 900 });
	await expect.poll(() => boxOf(frame)).toEqual({ ...placed, x: 0, width: 700 });

	await page.setViewportSize(VIEWPORT);
	await expect.poll(() => boxOf(frame)).toEqual(placed);
});

test('at the compact breakpoint a window fills the viewport and cannot be moved or resized', async ({ page }) => {
	await openHarness(page);
	const frame = await openWindow(page, 'settings');
	const placed = await boxOf(frame);

	await page.setViewportSize({ width: 390, height: 820 });
	await expect.poll(() => boxOf(frame)).toEqual({ x: 0, y: 0, width: 390, height: 820 });
	await expect(frame.getByRole('button', { name: 'Close' })).toBeVisible();
	await expect(frame.getByRole('button', { name: 'Maximise' })).toHaveCount(0);
	await expect(frame.locator('[data-in-page-window-resize]')).toHaveCount(0);
	await drag(page, { x: 100, y: 20 }, 100, 100);
	expect(await boxOf(frame)).toEqual({ x: 0, y: 0, width: 390, height: 820 });

	await page.setViewportSize(VIEWPORT);
	await expect.poll(() => boxOf(frame)).toEqual(placed);

	// A content-sized window fills a phone too.
	await page.keyboard.press('Escape');
	await page.setViewportSize({ width: 390, height: 820 });
	expect(await boxOf(await openWindow(page, 'about'))).toEqual({ x: 0, y: 0, width: 390, height: 820 });
});

test('tall content in a short viewport scrolls under a fixed title bar', async ({ page }) => {
	await openHarness(page, { width: 1400, height: 500 });
	const frame = await openWindow(page, 'edit-tab');
	const box = await boxOf(frame);
	expect(box.height).toBeLessThanOrEqual(500);
	expect(box.y).toBeGreaterThanOrEqual(0);
	const body = frame.locator('.in-page-window__body');
	expect(await body.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
	await body.evaluate((element) => element.scrollTo(0, 400));
	await expect(frame.getByRole('heading', { name: 'Edit Terminal Tab' })).toBeInViewport();
});

test('a window appears without animation when reduced motion is preferred', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await openHarness(page);
	await openWindow(page, 'settings');
	await expect(page.locator('.in-page-window-layer')).toHaveCSS('animation-name', 'none');
});
