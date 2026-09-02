import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const css = await readFile('src/shared/WorkspaceSplitLayout.css', 'utf8');
const sidebarCss = await readFile('src/components/sidebar/sidebar.css', 'utf8');
const splitSource = await readFile(
	'src/shared/WorkspaceSplitLayout.tsx',
	'utf8',
);

const phoneViewport = { width: 390, height: 844 };
const shortNarrowViewport = { width: 320, height: 80 };
const wideViewport = { width: 1000, height: 500 };

const documentStyles = `
	html, body, #root { width: 100%; height: 100%; margin: 0; }
	.file-explorer-sidebar {
		box-sizing: border-box;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
`;

function layoutMarkup({ visible = true } = {}) {
	return `
		<div class="workspace-split-layout" data-navigation-visible="${visible ? 'true' : 'false'}" style="--workspace-navigation-width: 352px; width: 100%; height: 100%;">
			<aside class="workspace-split-layout__navigation">
				<div class="file-explorer-sidebar"></div>
			</aside>
			<button type="button" class="workspace-split-layout__scrim" aria-label="Dismiss workspace navigation" tabindex="-1"></button>
			<hr class="workspace-split-layout__separator">
			<section class="workspace-split-layout__content"></section>
		</div>
	`;
}

async function measureGeometry(page) {
	return page.evaluate(() => {
		const layout = document.querySelector('.workspace-split-layout');
		const navigation = document.querySelector(
			'.workspace-split-layout__navigation',
		);
		const content = document.querySelector('.workspace-split-layout__content');
		const separator = document.querySelector(
			'.workspace-split-layout__separator',
		);
		const scrim = document.querySelector('.workspace-split-layout__scrim');
		const sidebar = document.querySelector('.file-explorer-sidebar');
		const navigationStyle = getComputedStyle(navigation);
		const contentStyle = getComputedStyle(content);
		const separatorStyle = getComputedStyle(separator);
		const scrimStyle = getComputedStyle(scrim);
		const layoutRect = layout.getBoundingClientRect();
		const navigationRect = navigation.getBoundingClientRect();
		const contentRect = content.getBoundingClientRect();
		return {
			layoutHeight: layoutRect.height,
			layoutWidth: layoutRect.width,
			navigationTop: navigationRect.top,
			navigationBottom: navigationRect.bottom,
			navigationHeight: navigationRect.height,
			navigationWidth: navigationRect.width,
			navigationPosition: navigationStyle.position,
			navigationOverflowY: navigationStyle.overflowY,
			navigationMaxBlockSize: navigationStyle.maxBlockSize,
			contentTop: contentRect.top,
			contentBottom: contentRect.bottom,
			contentHeight: contentRect.height,
			contentWidth: contentRect.width,
			contentGridColumn: contentStyle.gridColumnStart,
			separatorDisplay: separatorStyle.display,
			scrimDisplay: scrimStyle.display,
			sidebarHeight: sidebar?.getBoundingClientRect().height ?? 0,
			sidebarScrollTop: sidebar?.scrollTop ?? 0,
			navigationScrollHeight: navigation.scrollHeight,
			navigationClientHeight: navigation.clientHeight,
		};
	});
}

async function withPage(viewport, run) {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({ viewport });
		await run(page, browser);
	} finally {
		await browser.close();
	}
}

async function buildHarness({
	directoryName,
	contents,
	cssLoader = { '.css': 'text' },
}) {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), directoryName));
	const bundlePath = join(temporaryDirectory, 'harness.js');
	await build({
		stdin: {
			contents,
			loader: 'tsx',
			resolveDir: process.cwd(),
		},
		bundle: true,
		format: 'iife',
		jsx: 'automatic',
		loader: cssLoader,
		outfile: bundlePath,
	});
	return { temporaryDirectory, bundlePath };
}

const drawerHarness = await buildHarness({
	directoryName: 'terminay-narrow-drawer-',
	contents: `
		import React, { useState } from 'react';
		import { createRoot } from 'react-dom/client';
		import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';

		function Harness() {
			const [visible, setVisible] = useState(false);
			const [width, setWidth] = useState(352);
			window.__drawerControl = {
				open: () => setVisible(true),
				close: () => setVisible(false),
				setWidth: (nextWidth) => setWidth(nextWidth),
			};
			return (
				<>
					<button
						type="button"
						data-testid="nav-control"
						onClick={() => setVisible((current) => !current)}
					>
						Toggle navigation
					</button>
					<WorkspaceSplitLayout
						isNavigationVisible={visible}
						navigationWidth={width}
						onNavigationWidthCommit={(nextWidth) => setWidth(nextWidth)}
						onNavigationDismiss={() => setVisible(false)}
						navigation={
							<div className="file-explorer-sidebar">
								<button type="button" data-testid="inside-nav">Files</button>
								<button type="button" data-testid="inside-nav-2">Git</button>
							</div>
						}
						content={
							<div data-testid="content-panel" style={{ height: '100%' }}>
								<button type="button" data-testid="inside-content">Terminal</button>
							</div>
						}
					/>
				</>
			);
		}

		createRoot(document.getElementById('root')).render(<Harness />);
	`,
});

const stackHarness = await buildHarness({
	directoryName: 'terminay-narrow-drawer-stack-',
	contents: `
		import React, { useState } from 'react';
		import { createRoot } from 'react-dom/client';
		import { WorkspaceSplitLayout } from './src/shared/WorkspaceSplitLayout.tsx';
		import { SidebarPanelStack } from './src/components/sidebar/SidebarPanelStack.tsx';

		const items = ['explorer', 'agents', 'git'].map((id, index) => ({
			id,
			title: id,
			collapsed: false,
			height: [180, 140, 100][index],
			onToggleCollapsed() {},
			children: <div data-testid={\`pane-body-\${id}\`} style={{ height: 600 }}>${'x'.repeat(80)}</div>,
		}));

		function Harness() {
			const [visible, setVisible] = useState(true);
			window.__drawerControl = {
				open: () => setVisible(true),
				close: () => setVisible(false),
			};
			return (
				<WorkspaceSplitLayout
					isNavigationVisible={visible}
					navigationWidth={352}
					onNavigationDismiss={() => setVisible(false)}
					navigation={
						<div className="file-explorer-sidebar">
							<SidebarPanelStack items={items} onReorder={() => {}} />
						</div>
					}
					content={<div data-testid="content-panel" style={{ height: '100%' }}>Terminal</div>}
				/>
			);
		}

		createRoot(document.getElementById('root')).render(<Harness />);
	`,
});

test.after(() =>
	Promise.all([
		rm(drawerHarness.temporaryDirectory, { recursive: true, force: true }),
		rm(stackHarness.temporaryDirectory, { recursive: true, force: true }),
	]),
);

test('narrow breakpoint is observed from the existing media query rather than a second width check', () => {
	assert.match(css, /@media \(max-width: 720px\)/u);
	assert.match(
		splitSource,
		/NARROW_LAYOUT_MEDIA_QUERY = '\(max-width: 720px\)'/u,
	);
	assert.match(splitSource, /window\.matchMedia\(NARROW_LAYOUT_MEDIA_QUERY\)/u);
	assert.doesNotMatch(splitSource, /rootWidth\s*<\s*720/u);
	assert.doesNotMatch(css, /40dvh|24rem/u);
});

test('narrow navigation overlays the full workspace height instead of a 24rem cap', async () => {
	await withPage(phoneViewport, async (page) => {
		await page.setContent(`
			<style>
				${documentStyles}
				${css}
			</style>
			${layoutMarkup()}
		`);
		const geometry = await measureGeometry(page);
		assert.equal(geometry.layoutHeight, phoneViewport.height);
		assert.equal(geometry.navigationWidth, phoneViewport.width);
		assert.equal(geometry.navigationWidth, geometry.layoutWidth);
		assert.notEqual(geometry.navigationWidth, 352);
		assert.notEqual(geometry.navigationHeight, 384);
		assert.equal(geometry.navigationHeight, phoneViewport.height);
		assert.equal(geometry.navigationTop, geometry.contentTop);
		assert.equal(geometry.navigationBottom, geometry.contentBottom);
		assert.equal(geometry.navigationPosition, 'absolute');
		assert.equal(geometry.scrimDisplay, 'block');
		assert.equal(geometry.separatorDisplay, 'none');
		assert.equal(geometry.navigationOverflowY, 'hidden');
		assert.notEqual(geometry.navigationMaxBlockSize, '384px');
		assert.ok(
			geometry.navigationScrollHeight <= geometry.navigationClientHeight + 1,
		);
	});
});

test('narrow content keeps the same full height whether navigation is open or closed', async () => {
	await withPage(phoneViewport, async (page) => {
		await page.setContent(`
			<style>
				${documentStyles}
				${css}
			</style>
			${layoutMarkup({ visible: true })}
		`);
		const openGeometry = await measureGeometry(page);
		await page.setContent(`
			<style>
				${documentStyles}
				${css}
			</style>
			${layoutMarkup({ visible: false })}
		`);
		const closedGeometry = await measureGeometry(page);
		assert.equal(openGeometry.contentHeight, phoneViewport.height);
		assert.equal(closedGeometry.contentHeight, phoneViewport.height);
		assert.equal(openGeometry.contentHeight, closedGeometry.contentHeight);
		assert.equal(closedGeometry.scrimDisplay, 'none');
	});
});

test('wide layout keeps two columns, the separator, and persisted navigation width', async () => {
	await withPage(wideViewport, async (page) => {
		await page.setContent(`
			<style>
				${documentStyles}
				${css}
			</style>
			${layoutMarkup()}
		`);
		const geometry = await measureGeometry(page);
		assert.equal(geometry.navigationWidth, 352);
		assert.equal(geometry.navigationHeight, wideViewport.height);
		assert.equal(geometry.contentHeight, wideViewport.height);
		assert.equal(geometry.navigationPosition, 'static');
		assert.equal(geometry.separatorDisplay, 'block');
		assert.equal(geometry.scrimDisplay, 'none');
		assert.equal(geometry.contentTop, geometry.navigationTop);
		assert.equal(Math.round(geometry.contentWidth), wideViewport.width - 352);
	});
});

async function mountDrawerHarness(page) {
	await page.setContent(`
		<style>
			${documentStyles}
			${css}
			.workspace-split-layout { width: 100%; height: calc(100% - 32px); }
			[data-testid="nav-control"] { height: 32px; }
		</style>
		<div id="root"></div>
	`);
	await page.addScriptTag({ path: drawerHarness.bundlePath });
	await page.locator('.workspace-split-layout').waitFor();
}

test('narrow drawer closes from the navigation control, Escape, and the scrim', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountDrawerHarness(page);
		const control = page.getByTestId('nav-control');
		await control.click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		await control.click();
		await page.waitForSelector('[data-navigation-drawer="false"]');

		await control.click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		await page.keyboard.press('Escape');
		await page.waitForSelector('[data-navigation-drawer="false"]');

		await control.click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		await page
			.locator('.workspace-split-layout__scrim')
			.evaluate((element) => {
				element.click();
			});
		await page.waitForSelector('[data-navigation-drawer="false"]');
	});
});

test('narrow drawer moves focus in on open and returns it to the opening control', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountDrawerHarness(page);
		const control = page.getByTestId('nav-control');
		await control.focus();
		assert.equal(
			await page.evaluate(() => document.activeElement?.dataset.testid),
			'nav-control',
		);
		await control.click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		await page.waitForFunction(
			() => document.activeElement?.dataset.testid === 'inside-nav',
		);
		await page.keyboard.press('Escape');
		await page.waitForSelector('[data-navigation-drawer="false"]');
		await page.waitForFunction(
			() => document.activeElement?.dataset.testid === 'nav-control',
		);
	});
});

test('keyboard focus stays inside the open drawer and never reaches content behind it', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountDrawerHarness(page);
		await page.getByTestId('nav-control').click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		const focused = [];
		for (let index = 0; index < 6; index += 1) {
			await page.keyboard.press('Tab');
			focused.push(
				await page.evaluate(
					() =>
						document.activeElement?.dataset.testid ??
						document.activeElement?.className,
				),
			);
		}
		assert.ok(focused.every((id) => id !== 'inside-content'));
		assert.ok(focused.every((id) => id !== 'nav-control'));
		assert.ok(focused.includes('inside-nav'));
		assert.ok(focused.includes('inside-nav-2'));
	});
});

test('workspace content is inert while the drawer is open and restored on close', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountDrawerHarness(page);
		const content = page.locator('.workspace-split-layout__content');
		assert.equal(await content.evaluate((element) => element.inert), false);
		await page.getByTestId('nav-control').click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		assert.equal(await content.evaluate((element) => element.inert), true);
		await page.keyboard.press('Escape');
		await page.waitForSelector('[data-navigation-drawer="false"]');
		assert.equal(await content.evaluate((element) => element.inert), false);
	});
});

test('closing the drawer does not change content panel geometry', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountDrawerHarness(page);
		const measure = () =>
			page.locator('[data-testid="content-panel"]').evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return {
					width: rect.width,
					height: rect.height,
					top: rect.top,
					left: rect.left,
				};
			});
		const before = await measure();
		await page.getByTestId('nav-control').click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		const openContent = await page
			.locator('.workspace-split-layout__content')
			.evaluate((element) => element.getBoundingClientRect().height);
		assert.equal(openContent, before.height);
		await page.keyboard.press('Escape');
		await page.waitForSelector('[data-navigation-drawer="false"]');
		assert.deepEqual(await measure(), before);
	});
});

test('presentation and drawer behaviour switch at the same 720px media query', async () => {
	await withPage({ width: 720, height: 800 }, async (page) => {
		await mountDrawerHarness(page);
		await page.getByTestId('nav-control').click();
		await page.waitForSelector('[data-navigation-drawer="true"]');
		assert.equal(
			await page.evaluate(
				() => window.matchMedia('(max-width: 720px)').matches,
			),
			true,
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.getAttribute('data-narrow-layout'),
			'true',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout__navigation')
				.evaluate((element) => getComputedStyle(element).position),
			'absolute',
		);

		await page.setViewportSize({ width: 721, height: 800 });
		await page.waitForSelector('[data-narrow-layout="false"]');
		assert.equal(
			await page.evaluate(
				() => window.matchMedia('(max-width: 720px)').matches,
			),
			false,
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.getAttribute('data-navigation-drawer'),
			'false',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout__navigation')
				.evaluate((element) => getComputedStyle(element).position),
			'static',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.getAttribute('data-navigation-visible'),
			'true',
		);
	});
});

test('crossing the breakpoint preserves navigation visibility and width', async () => {
	await withPage(wideViewport, async (page) => {
		await mountDrawerHarness(page);
		await page.evaluate(() => {
			window.__drawerControl.setWidth(280);
			window.__drawerControl.open();
		});
		await page.waitForSelector('[data-navigation-visible="true"]');
		await page.waitForFunction(
			() =>
				document
					.querySelector('.workspace-split-layout__navigation')
					?.getBoundingClientRect().width === 280,
		);

		await page.setViewportSize(phoneViewport);
		await page.waitForSelector('[data-navigation-drawer="true"]');
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.getAttribute('data-navigation-visible'),
			'true',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout')
				.evaluate((element) =>
					getComputedStyle(element)
						.getPropertyValue('--workspace-navigation-width')
						.trim(),
				),
			'280px',
		);
		assert.equal(
			await page
				.locator('.workspace-split-layout__navigation')
				.evaluate((element) => element.getBoundingClientRect().width),
			phoneViewport.width,
		);

		await page.setViewportSize(wideViewport);
		await page.waitForSelector('[data-navigation-drawer="false"]');
		await page.waitForSelector('[data-navigation-visible="true"]');
		const geometry = await measureGeometry(page);
		assert.equal(geometry.navigationWidth, 280);
		assert.equal(geometry.navigationPosition, 'static');
		assert.equal(geometry.separatorDisplay, 'block');
		assert.equal(Math.round(geometry.contentWidth), wideViewport.width - 280);
	});
});

async function mountStackHarness(page, extraCss = '') {
	await page.setContent(`
		<style>
			${documentStyles}
			${css}
			${sidebarCss}
			${extraCss}
			.workspace-split-layout { width: 100%; height: 100%; }
		</style>
		<div id="root"></div>
	`);
	await page.addScriptTag({ path: stackHarness.bundlePath });
	await page.locator('.workspace-split-layout').waitFor();
}

test('short narrow viewport shows the non-scrolling minimum-height status', async () => {
	await withPage(shortNarrowViewport, async (page) => {
		await mountStackHarness(page);
		await page.waitForSelector('[data-sidebar-minimum-height-notice]');
		const unsupported = await page.evaluate(() => {
			const stack = document.querySelector('[data-sidebar-panel-stack]');
			const notice = document.querySelector(
				'[data-sidebar-minimum-height-notice]',
			);
			const navigation = document.querySelector(
				'.workspace-split-layout__navigation',
			);
			return {
				feasible: stack?.dataset.sidebarLayoutFeasible,
				noticeText: notice?.textContent,
				stackScrollHeight: stack?.scrollHeight,
				stackClientHeight: stack?.clientHeight,
				navigationOverflowY: getComputedStyle(navigation).overflowY,
			};
		});
		assert.equal(unsupported.feasible, 'false');
		assert.match(unsupported.noticeText ?? '', /Increase the window height/u);
		assert.ok(
			unsupported.stackScrollHeight <= unsupported.stackClientHeight + 1,
		);
		assert.equal(unsupported.navigationOverflowY, 'hidden');
	});
});

test('overflowing pane content scrolls inside the drawer while the sidebar does not', async () => {
	await withPage(phoneViewport, async (page) => {
		await mountStackHarness(page);
		await page.waitForSelector('[data-sidebar-panel-stack]');
		await page.waitForFunction(
			() =>
				document.querySelector('[data-sidebar-layout-feasible]')?.dataset
					.sidebarLayoutFeasible === 'true',
		);
		const scrolling = await page.evaluate(() => {
			const navigation = document.querySelector(
				'.workspace-split-layout__navigation',
			);
			const sidebar = document.querySelector('.file-explorer-sidebar');
			const stack = document.querySelector('[data-sidebar-panel-stack]');
			const body = document.querySelector(
				'[data-sidebar-pane-id="explorer"] .sidebar-pane__body',
			);
			body.scrollTop = 64;
			return {
				bodyScrollTop: body.scrollTop,
				bodyCanScroll: body.scrollHeight > body.clientHeight,
				navigationScrollTop: navigation.scrollTop,
				sidebarScrollTop: sidebar.scrollTop,
				stackScrollTop: stack.scrollTop,
				navigationOverflowY: getComputedStyle(navigation).overflowY,
				sidebarOverflowY: getComputedStyle(sidebar).overflowY,
			};
		});
		assert.equal(scrolling.bodyCanScroll, true);
		assert.ok(scrolling.bodyScrollTop > 0);
		assert.equal(scrolling.navigationScrollTop, 0);
		assert.equal(scrolling.sidebarScrollTop, 0);
		assert.equal(scrolling.stackScrollTop, 0);
		assert.equal(scrolling.navigationOverflowY, 'hidden');
	});
});
