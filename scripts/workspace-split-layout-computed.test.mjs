import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('workspace sidebar keeps one compact boundary at default and resized widths', async () => {
	const css = await readFile('src/shared/WorkspaceSplitLayout.css', 'utf8');
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 500 },
		});
		await page.setContent(`
			<style>
				html, body { width: 100%; height: 100%; margin: 0; }
				${css}
				.workspace-split-layout { width: 1000px; height: 500px; }
			</style>
			<div class="workspace-split-layout" data-navigation-visible="true">
				<aside class="workspace-split-layout__navigation">
					<div class="file-explorer-sidebar"></div>
				</aside>
				<hr class="workspace-split-layout__separator">
				<section class="workspace-split-layout__content"></section>
			</div>
		`);

		for (const width of [352, 280, 640]) {
			await page
				.locator('.workspace-split-layout')
				.evaluate(
					(element, value) =>
						element.style.setProperty(
							'--workspace-navigation-width',
							`${value}px`,
						),
					width,
				);
			const geometry = await page.evaluate(() => {
				const navigation = document
					.querySelector('.workspace-split-layout__navigation')
					.getBoundingClientRect();
				const separator = document
					.querySelector('.workspace-split-layout__separator')
					.getBoundingClientRect();
				const content = document
					.querySelector('.workspace-split-layout__content')
					.getBoundingClientRect();
				const sidebar = document
					.querySelector('.file-explorer-sidebar')
					.getBoundingClientRect();
				const separatorStyle = getComputedStyle(
					document.querySelector('.workspace-split-layout__separator'),
				);
				return {
					contentLeft: content.left,
					navigationRight: navigation.right,
					navigationWidth: navigation.width,
					sidebarRight: sidebar.right,
					sidebarWidth: sidebar.width,
					separatorLeft: separator.left,
					separatorRight: separator.right,
					separatorMarginLeft: separatorStyle.marginLeft,
					separatorMarginRight: separatorStyle.marginRight,
					separatorWidth: separator.width,
				};
			});
			assert.equal(geometry.navigationWidth, width);
			assert.equal(geometry.sidebarWidth, width);
			assert.equal(geometry.sidebarRight, geometry.navigationRight);
			assert.equal(geometry.contentLeft, geometry.navigationRight);
			assert.equal(geometry.separatorWidth, 6);
			assert.equal(geometry.separatorLeft, geometry.navigationRight - 3);
			assert.equal(geometry.separatorRight, geometry.navigationRight + 3);
			assert.equal(geometry.separatorMarginLeft, '0px');
			assert.equal(geometry.separatorMarginRight, '0px');
		}
	} finally {
		await browser.close();
	}
});

test('workspace sidebar separator drags and commits the controlled width', async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-workspace-split-'),
	);
	const bundlePath = join(temporaryDirectory, 'workspace-split-harness.js');
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';

				function Harness() {
					const [width, setWidth] = useState(280);
					const [renderVersion, setRenderVersion] = useState(0);
					window.__workspaceSplitCommitControl = {
						setCanonicalWidth: (nextWidth) => setWidth(nextWidth),
						renderUnrelated: () => setRenderVersion((current) => current + 1),
					};
					return (
						<WorkspaceSplitLayout
							navigation={<div data-render-version={renderVersion} data-testid="navigation">Explorer</div>}
							content={<div data-testid="content">Dockview</div>}
							navigationWidth={width}
							maximumNavigationWidth={640}
							onNavigationWidthChange={(nextWidth) => {
								window.__workspaceSplitWidth = nextWidth;
								setWidth(nextWidth);
							}}
							onNavigationWidthCommit={(nextWidth) => {
								window.__workspaceSplitCommittedWidth = nextWidth;
							}}
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
	try {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 500 },
		});
		await page.setContent(`
			<style>
				html, body, #root { width: 100%; height: 100%; margin: 0; }
				${css}
				.workspace-split-layout { width: 1000px; height: 500px; }
			</style>
			<div id="root"></div>
		`);
		await page.addScriptTag({ path: bundlePath });
		const separator = page.locator('.workspace-split-layout__separator');
		await separator.waitFor();
		const box = await separator.boundingBox();
		assert.ok(box, 'separator should have a drag hit target');

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
		await page.waitForFunction(() => {
			const navigation = document.querySelector(
				'.workspace-split-layout__navigation',
			);
			return navigation?.getBoundingClientRect().width === 400;
		});
		assert.equal(
			await page.evaluate(() => window.__workspaceSplitWidth),
			undefined,
			'drag previews should not push parent width state before commit',
		);
		await page.evaluate(() => {
			window.__workspaceSplitCommitControl.setCanonicalWidth(320);
			window.__workspaceSplitCommitControl.renderUnrelated();
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-render-version]')
					?.getAttribute('data-render-version') === '1',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout__navigation')
				.evaluate((element) => element.getBoundingClientRect().width),
			400,
			'controlled and unrelated parent renders must not replace an active preview',
		);
		await page.mouse.up();

		await assert.doesNotReject(async () => {
			await page.waitForFunction(() => window.__workspaceSplitWidth === 400);
			await page.waitForFunction(
				() => window.__workspaceSplitCommittedWidth === 400,
			);
		});
		const geometry = await page.evaluate(() => {
			const navigation = document
				.querySelector('.workspace-split-layout__navigation')
				.getBoundingClientRect();
			const content = document
				.querySelector('.workspace-split-layout__content')
				.getBoundingClientRect();
			return { navigationWidth: navigation.width, contentLeft: content.left };
		});
		assert.equal(geometry.navigationWidth, 400);
		assert.equal(geometry.contentLeft, 400);
	} finally {
		await browser.close();
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test('workspace sidebar width cancellation restores the local preview without a callback', async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-workspace-split-cancel-'),
	);
	const bundlePath = join(
		temporaryDirectory,
		'workspace-split-cancel-harness.js',
	);
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';

				function Harness() {
					const [width, setWidth] = useState(280);
					const [renderVersion, setRenderVersion] = useState(0);
					window.__workspaceSplitControl = {
						setCanonicalWidth: (nextWidth) => setWidth(nextWidth),
						renderUnrelated: () => setRenderVersion((current) => current + 1),
					};
					return (
						<WorkspaceSplitLayout
							navigation={<div data-render-version={renderVersion}>Explorer</div>}
							content={<div>Dockview</div>}
							navigationWidth={width}
							maximumNavigationWidth={640}
							onNavigationWidthChange={(nextWidth) => {
								window.__workspaceSplitChangedWidth = nextWidth;
							}}
							onNavigationWidthCommit={(nextWidth) => {
								window.__workspaceSplitCommittedWidth = nextWidth;
							}}
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
	try {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 500 },
		});
		await page.setContent(`
			<style>
				html, body, #root { width: 100%; height: 100%; margin: 0; }
				${css}
				.workspace-split-layout { width: 1000px; height: 500px; }
			</style>
			<div id="root"></div>
		`);
		await page.addScriptTag({ path: bundlePath });
		const separator = page.locator('.workspace-split-layout__separator');
		const box = await separator.boundingBox();
		assert.ok(box, 'separator should have a drag hit target');

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2);
		await page.waitForFunction(
			() =>
				document
					.querySelector('.workspace-split-layout__navigation')
					?.getBoundingClientRect().width === 400,
		);
		await page.evaluate(() => {
			window.__workspaceSplitControl.setCanonicalWidth(320);
			window.__workspaceSplitControl.renderUnrelated();
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-render-version]')
					?.getAttribute('data-render-version') === '1',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout__navigation')
				.evaluate((element) => element.getBoundingClientRect().width),
			400,
			'controlled and unrelated parent renders must not replace an active preview',
		);
		await page.evaluate(() => {
			window.dispatchEvent(
				new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }),
			);
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector('.workspace-split-layout__navigation')
					?.getBoundingClientRect().width === 320,
		);
		assert.equal(
			await page.evaluate(() => window.__workspaceSplitChangedWidth),
			undefined,
		);
		assert.equal(
			await page.evaluate(() => window.__workspaceSplitCommittedWidth),
			undefined,
		);
	} finally {
		await browser.close();
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});

test('workspace sidebar defaults to an eighty percent maximum width', async () => {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-workspace-split-'),
	);
	const bundlePath = join(
		temporaryDirectory,
		'workspace-split-default-harness.js',
	);
	await build({
		stdin: {
			contents: `
				import React, { useState } from 'react';
				import { createRoot } from 'react-dom/client';
				import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';

				function Harness() {
					const [width, setWidth] = useState(280);
					return (
						<WorkspaceSplitLayout
							navigation={<div data-testid="navigation">Explorer</div>}
							content={<div data-testid="content">Dockview</div>}
							navigationWidth={width}
							onNavigationWidthChange={(nextWidth) => {
								window.__workspaceSplitWidth = nextWidth;
								setWidth(nextWidth);
							}}
							onNavigationWidthCommit={(nextWidth) => {
								window.__workspaceSplitCommittedWidth = nextWidth;
							}}
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
	try {
		const page = await browser.newPage({
			viewport: { width: 1000, height: 500 },
		});
		await page.setContent(`
			<style>
				html, body, #root { width: 100%; height: 100%; margin: 0; }
				${css}
				.workspace-split-layout { width: 1000px; height: 500px; }
			</style>
			<div id="root"></div>
		`);
		await page.addScriptTag({ path: bundlePath });
		const separator = page.locator('.workspace-split-layout__separator');
		await separator.waitFor();
		const box = await separator.boundingBox();
		assert.ok(box, 'separator should have a drag hit target');

		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 700, box.y + box.height / 2);
		await page.waitForFunction(() => {
			const navigation = document.querySelector(
				'.workspace-split-layout__navigation',
			);
			return navigation?.getBoundingClientRect().width === 800;
		});
		await page.mouse.up();

		await assert.doesNotReject(async () => {
			await page.waitForFunction(() => window.__workspaceSplitWidth === 800);
			await page.waitForFunction(
				() => window.__workspaceSplitCommittedWidth === 800,
			);
		});
		const geometry = await page.evaluate(() => {
			const navigation = document
				.querySelector('.workspace-split-layout__navigation')
				.getBoundingClientRect();
			const content = document
				.querySelector('.workspace-split-layout__content')
				.getBoundingClientRect();
			return { navigationWidth: navigation.width, contentLeft: content.left };
		});
		assert.equal(geometry.navigationWidth, 800);
		assert.equal(geometry.contentLeft, 800);
	} finally {
		await browser.close();
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
});
