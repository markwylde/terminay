import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** Folders | content | navigation, as a project lays itself out. */
async function openHarness(viewport) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-workspace-folders-'),
	);
	const bundlePath = join(temporaryDirectory, 'workspace-folders-harness.js');
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';

				function Harness() {
					const [navigationWidth, setNavigationWidth] = useState(300);
					const [foldersWidth, setFoldersWidth] = useState(200);
					const [foldersVisible, setFoldersVisible] = useState(true);
					const [navigationVisible, setNavigationVisible] = useState(true);
					window.__harness = { setFoldersVisible, setNavigationVisible };
					window.__commits = window.__commits ?? { navigation: [], folders: [] };
					return (
						<WorkspaceSplitLayout
							navigationSide="trailing"
							navigation={<div data-testid="navigation">Explorer</div>}
							isNavigationVisible={navigationVisible}
							navigationWidth={navigationWidth}
							onNavigationWidthCommit={(width) => {
								window.__commits.navigation.push(width);
								setNavigationWidth(width);
							}}
							folders={<div data-testid="folders">Folders</div>}
							isFoldersVisible={foldersVisible}
							foldersWidth={foldersWidth}
							onFoldersWidthCommit={(width) => {
								window.__commits.folders.push(width);
								setFoldersWidth(width);
							}}
							content={<div data-testid="content">Dockview</div>}
						/>
					);
				}

				createRoot(document.getElementById('root')).render(<Harness />);
			`,
			loader: 'tsx',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: { '.css': 'text' },
		outfile: bundlePath,
	});
	const css = await readFile('src/shared/WorkspaceSplitLayout.css', 'utf8');
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({ viewport });
	await page.setContent(`
		<style>
			html, body, #root { width: 100%; height: 100%; margin: 0; }
			${css}
		</style>
		<div id="root"></div>
	`);
	await page.addScriptTag({ path: bundlePath });
	await page.locator('.workspace-split-layout__content').waitFor();
	return {
		page,
		close: async () => {
			await browser.close();
			await rm(temporaryDirectory, { recursive: true, force: true });
		},
	};
}

const geometry = (page) =>
	page.evaluate(() => {
		const rect = (selector) => {
			const element = document.querySelector(selector);
			if (element === null) return null;
			const box = element.getBoundingClientRect();
			return {
				left: box.left,
				right: box.right,
				width: box.width,
				shown: getComputedStyle(element).display !== 'none',
			};
		};
		return {
			folders: rect('.workspace-split-layout__folders'),
			foldersSeparator: rect('.workspace-split-layout__folders-separator'),
			content: rect('.workspace-split-layout__content'),
			navigation: rect('.workspace-split-layout__navigation'),
			separator: rect('.workspace-split-layout__separator'),
		};
	});

async function drag(page, selector, deltaX) {
	const box = await page.locator(selector).boundingBox();
	assert.ok(box, `${selector} should have a drag hit target`);
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + deltaX, y, { steps: 4 });
	await page.mouse.up();
}

test('folders lead, the panel area is in the middle, and the navigation trails', async () => {
	const { page, close } = await openHarness({ width: 1000, height: 500 });
	try {
		const layout = await geometry(page);
		assert.deepEqual(
			[layout.folders.left, layout.folders.width],
			[0, 200],
		);
		assert.deepEqual(
			[layout.content.left, layout.content.right],
			[200, 700],
		);
		assert.deepEqual(
			[layout.navigation.left, layout.navigation.right],
			[700, 1000],
		);
		// Each separator straddles the edge of its column that faces the content.
		assert.deepEqual(
			[layout.foldersSeparator.left, layout.foldersSeparator.right],
			[197, 203],
		);
		assert.deepEqual(
			[layout.separator.left, layout.separator.right],
			[697, 703],
		);
	} finally {
		await close();
	}
});

test('each separator resizes its own column and leaves the other alone', async () => {
	const { page, close } = await openHarness({ width: 1000, height: 500 });
	try {
		// The navigation trails, so dragging its separator left widens it.
		await drag(page, '.workspace-split-layout__separator', -50);
		await page.waitForFunction(() => window.__commits.navigation.length === 1);
		let layout = await geometry(page);
		assert.equal(layout.navigation.width, 350);
		assert.equal(layout.folders.width, 200);
		assert.deepEqual([layout.content.left, layout.content.right], [200, 650]);

		await drag(page, '.workspace-split-layout__folders-separator', 40);
		await page.waitForFunction(() => window.__commits.folders.length === 1);
		layout = await geometry(page);
		assert.equal(layout.folders.width, 240);
		assert.equal(layout.navigation.width, 350);
		assert.deepEqual([layout.content.left, layout.content.right], [240, 650]);
		assert.deepEqual(
			await page.evaluate(() => window.__commits),
			{ navigation: [350], folders: [240] },
		);
	} finally {
		await close();
	}
});

test('hiding either column gives its width to the panel area', async () => {
	const { page, close } = await openHarness({ width: 1000, height: 500 });
	try {
		await page.evaluate(() => window.__harness.setFoldersVisible(false));
		await page.waitForFunction(
			() => document.querySelector('.workspace-split-layout__folders') === null,
		);
		let layout = await geometry(page);
		assert.deepEqual([layout.content.left, layout.content.right], [0, 700]);
		assert.deepEqual(
			[layout.navigation.left, layout.navigation.right],
			[700, 1000],
		);

		await page.evaluate(() => {
			window.__harness.setFoldersVisible(true);
			window.__harness.setNavigationVisible(false);
		});
		await page.locator('.workspace-split-layout__folders').waitFor();
		layout = await geometry(page);
		assert.equal(layout.folders.width, 200);
		assert.deepEqual([layout.content.left, layout.content.right], [200, 1000]);
		assert.equal(layout.navigation.shown, false);
		assert.equal(layout.separator.shown, false);

		await page.evaluate(() => window.__harness.setFoldersVisible(false));
		await page.waitForFunction(
			() => document.querySelector('.workspace-split-layout__folders') === null,
		);
		layout = await geometry(page);
		assert.deepEqual([layout.content.left, layout.content.right], [0, 1000]);
	} finally {
		await close();
	}
});

test('below the narrow breakpoint there is no folders column and the navigation is still a drawer', async () => {
	const { page, close } = await openHarness({ width: 600, height: 500 });
	try {
		const layout = await geometry(page);
		assert.equal(layout.folders, null);
		assert.equal(layout.foldersSeparator, null);
		assert.deepEqual([layout.content.left, layout.content.right], [0, 600]);
		// The drawer covers the content rather than taking a column beside it.
		assert.deepEqual(
			[layout.navigation.left, layout.navigation.right],
			[0, 600],
		);
		assert.equal(layout.separator.shown, false);
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.getAttribute('data-navigation-drawer'),
			'true',
		);
	} finally {
		await close();
	}
});
