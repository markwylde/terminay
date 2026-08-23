import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('a controlled sidebar keeps the preview position after pointer-up', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-sidebar-commit-'));
	const bundle = join(directory, 'harness.js');
	const css = await readFile('src/components/sidebar/sidebar.css', 'utf8');
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { SidebarPanelStack } from './src/components/sidebar/SidebarPanelStack.tsx';
				const initial = ['explorer', 'agents', 'git'].map((id, index) => ({
					id, title: id, collapsed: false, height: [320, 200, 240][index],
					onToggleCollapsed() {}, children: <div style={{ height: 600 }}>body</div>,
				}));
				function Harness() {
					const [items, setItems] = useState(initial);
					return <SidebarPanelStack items={items} onReorder={() => {}}
						onHeightsCommit={(heights) => {
							window.commits.push(heights);
							setItems((current) => current.map((item) =>
								heights[item.id] === undefined ? item : { ...item, height: heights[item.id] },
							));
							return Promise.resolve();
						}}
					/>;
				}
				window.commits = [];
				createRoot(document.getElementById('root')).render(<Harness />);`,
			loader: 'tsx',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: { '.css': 'text' },
		outfile: bundle,
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 320, height: 800 },
		});
		await page.setContent(
			`<style>html,body,#root{margin:0;width:100%;height:100%;}${css}</style><div id="root"></div>`,
		);
		await page.addScriptTag({ path: bundle });
		const handle = page.locator('[data-sidebar-resize-handle="agents"]');
		await handle.waitFor();
		const box = await handle.boundingBox();
		assert.ok(box);
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 100);
		const previewTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		await page.mouse.up();
		await page.waitForFunction(() => window.commits.length === 1);
		const committedTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		assert.ok(
			Math.abs(committedTop - previewTop) <= 1,
			`pointer-up moved the boundary from ${previewTop} to ${committedTop}`,
		);
		const commits = await page.evaluate(() => window.commits);
		assert.deepEqual(Object.keys(commits[0]).sort(), [
			'agents',
			'explorer',
			'git',
		]);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test('a delayed authoritative sidebar update keeps its pointer-up preview through unrelated renders', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-sidebar-delayed-'));
	const bundle = join(directory, 'harness.js');
	const css = await readFile('src/components/sidebar/sidebar.css', 'utf8');
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { SidebarPanelStack } from './src/components/sidebar/SidebarPanelStack.tsx';
				const initial = ['explorer', 'agents', 'git'].map((id, index) => ({
					id, title: id, collapsed: false, height: [320, 200, 240][index],
					onToggleCollapsed() {}, children: <div style={{ height: 600 }}>body</div>,
				}));
				function Harness() {
					const [items, setItems] = useState(initial);
					const [unrelatedRender, setUnrelatedRender] = useState(0);
					return <><output data-unrelated-render>{unrelatedRender}</output><SidebarPanelStack items={items} onReorder={() => {}}
						onHeightsCommit={(heights) => new Promise((resolve) => {
							window.commits.push(heights);
							setUnrelatedRender((current) => current + 1);
							setTimeout(() => {
								setItems((current) => current.map((item) =>
									heights[item.id] === undefined ? item : { ...item, height: heights[item.id] },
								));
								resolve();
							}, 120);
						})}
					/></>;
				}
				window.commits = [];
				createRoot(document.getElementById('root')).render(<Harness />);`,
			loader: 'tsx',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: { '.css': 'text' },
		outfile: bundle,
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 320, height: 800 },
		});
		await page.setContent(
			`<style>html,body,#root{margin:0;width:100%;height:100%;}${css}</style><div id="root"></div>`,
		);
		await page.addScriptTag({ path: bundle });
		const handle = page.locator('[data-sidebar-resize-handle="agents"]');
		await handle.waitFor();
		const box = await handle.boundingBox();
		assert.ok(box);
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 100);
		const previewTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		await page.mouse.up();
		await page.waitForFunction(() => window.commits.length === 1);
		await page.waitForFunction(
			() =>
				document.querySelector('[data-unrelated-render]')?.textContent === '1',
		);
		await page.waitForTimeout(50);
		const whilePendingTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		assert.ok(
			Math.abs(whilePendingTop - previewTop) <= 1,
			`unrelated render moved the boundary from ${previewTop} to ${whilePendingTop}`,
		);
		await page.waitForTimeout(100);
		const authoritativeTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		assert.ok(
			Math.abs(authoritativeTop - previewTop) <= 1,
			`authoritative update moved the boundary from ${previewTop} to ${authoritativeTop}`,
		);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
});

test('lostpointercapture during a live drag does not discard the preview', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-sidebar-lostcap-'));
	const bundle = join(directory, 'harness.js');
	const css = await readFile('src/components/sidebar/sidebar.css', 'utf8');
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { SidebarPanelStack } from './src/components/sidebar/SidebarPanelStack.tsx';
				const initial = ['explorer', 'agents', 'git'].map((id, index) => ({
					id, title: id, collapsed: false, height: [320, 200, 240][index],
					onToggleCollapsed() {}, children: <div style={{ height: 600 }}>body</div>,
				}));
				function Harness() {
					const [items, setItems] = useState(initial);
					return <SidebarPanelStack items={items} onReorder={() => {}}
						onHeightsCommit={(heights) => {
							window.commits.push(heights);
							setItems((current) => current.map((item) =>
								heights[item.id] === undefined ? item : { ...item, height: heights[item.id] },
							));
							return Promise.resolve();
						}}
					/>;
				}
				window.commits = [];
				createRoot(document.getElementById('root')).render(<Harness />);`,
			loader: 'tsx',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: { '.css': 'text' },
		outfile: bundle,
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 320, height: 800 },
		});
		await page.setContent(
			`<style>html,body,#root{margin:0;width:100%;height:100%;}${css}</style><div id="root"></div>`,
		);
		await page.addScriptTag({ path: bundle });
		const handle = page.locator('[data-sidebar-resize-handle="agents"]');
		await handle.waitFor();
		const box = await handle.boundingBox();
		assert.ok(box);
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 80, { steps: 1 });
		const previewTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		await handle.evaluate((element) => {
			element.dispatchEvent(
				new PointerEvent('lostpointercapture', {
					bubbles: true,
					pointerId: 1,
				}),
			);
		});
		assert.equal(await page.evaluate(() => window.commits.length), 0);
		const afterLostCaptureTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		assert.ok(
			Math.abs(afterLostCaptureTop - previewTop) <= 1,
			`lostpointercapture reverted the preview from ${previewTop} to ${afterLostCaptureTop}`,
		);
		await page.mouse.up();
		await page.waitForFunction(() => window.commits.length === 1);
		const committedTop = await page
			.locator('[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]')
			.evaluate((element) => element.getBoundingClientRect().top);
		assert.ok(
			Math.abs(committedTop - previewTop) <= 1,
			`pointer-up after lostpointercapture moved the boundary from ${previewTop} to ${committedTop}`,
		);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
});
