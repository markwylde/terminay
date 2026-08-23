import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('sidebar panel stack previews locally, overlays following titles, and commits once', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-sidebar-stack-'));
	const bundle = join(directory, 'harness.js');
	const css = await readFile('src/components/sidebar/sidebar.css', 'utf8');
	await build({
		stdin: {
			contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {SidebarPanelStack} from './src/components/sidebar/SidebarPanelStack.tsx';
			const items=['explorer','agents','git'].map((id,index)=>({id,title:id,collapsed:false,height:[180,140,100][index],onToggleCollapsed(){window.toggles.push(id)},children:<div style={{height:600}}>${'x'}</div>}));
			window.commits=[]; window.toggles=[]; createRoot(document.getElementById('root')).render(<SidebarPanelStack items={items} onReorder={()=>{}} onHeightsCommit={(heights)=>window.commits.push(heights)}/>);`,
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
			viewport: { width: 320, height: 500 },
		});
		await page.setContent(
			`<style>html,body,#root{margin:0;width:100%;height:100%;}${css}</style><div id="root"></div>`,
		);
		await page.addScriptTag({ path: bundle });
		const stack = page.locator('[data-sidebar-panel-stack]');
		await stack.waitFor();
		const geometry = await page.evaluate(() => {
			const stack = document.querySelector('[data-sidebar-panel-stack]');
			const following = document.querySelector(
				'[data-sidebar-pane-id="agents"] [data-sidebar-pane-title]',
			);
			const collapse = following.querySelector('.sidebar-pane__header');
			const handle = document.querySelector(
				'[data-sidebar-resize-handle="agents"]',
			);
			const rect = (element) => element.getBoundingClientRect();
			const titleRect = rect(following);
			const titlePoint = document.elementFromPoint(
				titleRect.x + titleRect.width / 2,
				titleRect.y + 2,
			);
			const grabPoint = document.elementFromPoint(
				titleRect.x + titleRect.width / 2,
				titleRect.y - 4,
			);
			return {
				stack: rect(stack),
				title: titleRect,
				handle: rect(handle),
				handleStyle: {
					backgroundColor: getComputedStyle(handle).backgroundColor,
					borderRadius: getComputedStyle(handle).borderRadius,
					outlineStyle: getComputedStyle(handle).outlineStyle,
					outlineWidth: getComputedStyle(handle).outlineWidth,
				},
				railStyle: {
					backgroundColor: getComputedStyle(handle, '::before').backgroundColor,
					boxShadow: getComputedStyle(handle, '::before').boxShadow,
					height: getComputedStyle(handle, '::before').height,
				},
				titlePointIsCollapse:
					titlePoint?.closest('.sidebar-pane__header') === collapse,
				titlePointClassName: titlePoint?.className ?? '',
				grabPointIsHandle:
					grabPoint?.closest('[data-sidebar-resize-handle="agents"]') ===
					handle,
				scrollHeight: stack.scrollHeight,
				clientHeight: stack.clientHeight,
			};
		});
		assert.ok(
			Math.abs(geometry.handle.y + geometry.handle.height - geometry.title.y) <=
				1,
		);
		assert.equal(geometry.handle.width, geometry.stack.width);
		assert.equal(geometry.handle.height, 12);
		assert.equal(geometry.handleStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
		assert.equal(geometry.handleStyle.borderRadius, '0px');
		assert.equal(geometry.handleStyle.outlineStyle, 'none');
		assert.equal(geometry.handleStyle.outlineWidth, '0px');
		assert.equal(geometry.railStyle.backgroundColor, 'rgba(0, 0, 0, 0)');
		assert.equal(geometry.railStyle.boxShadow, 'none');
		assert.equal(geometry.railStyle.height, '1px');
		assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1);
		assert.equal(
			geometry.titlePointIsCollapse,
			true,
			geometry.titlePointClassName,
		);
		assert.equal(geometry.grabPointIsHandle, true);
		const handle = page.locator('[data-sidebar-resize-handle="agents"]');
		await handle.hover();
		await page.waitForTimeout(180);
		const hoveredRail = await handle.evaluate((element) => {
			const rail = getComputedStyle(element, '::before');
			return {
				backgroundColor: rail.backgroundColor,
				boxShadow: rail.boxShadow,
			};
		});
		assert.equal(hoveredRail.backgroundColor, 'rgb(87, 183, 255)');
		assert.equal(hoveredRail.boxShadow, 'none');
		await page.mouse.move(geometry.stack.x + 2, geometry.stack.bottom - 2);
		await handle.focus();
		await page.waitForTimeout(180);
		const focusedHandle = await handle.evaluate((element) => ({
			focusVisible: element.matches(':focus-visible'),
			outlineStyle: getComputedStyle(element).outlineStyle,
			outlineWidth: getComputedStyle(element).outlineWidth,
			railBackgroundColor: getComputedStyle(element, '::before')
				.backgroundColor,
			railBoxShadow: getComputedStyle(element, '::before').boxShadow,
		}));
		assert.equal(focusedHandle.focusVisible, true);
		assert.equal(focusedHandle.outlineStyle, 'none');
		assert.equal(focusedHandle.outlineWidth, '0px');
		assert.equal(focusedHandle.railBackgroundColor, 'rgb(87, 183, 255)');
		assert.equal(focusedHandle.railBoxShadow, 'none');
		await page.mouse.click(
			geometry.title.x + geometry.title.width / 2,
			geometry.title.y + 2,
		);
		await page.waitForFunction(() => window.toggles.includes('agents'));
		const box = await handle.boundingBox();
		assert.ok(box);
		const grabX = box.x + box.width / 2;
		const grabY = geometry.title.y - 4;
		assert.ok(grabY >= box.y && grabY <= box.y + box.height);
		await page.mouse.move(grabX, grabY);
		await page.mouse.down();
		await page.mouse.move(grabX, grabY + 40);
		assert.equal(await page.evaluate(() => window.commits.length), 0);
		await page.mouse.up();
		await page.waitForFunction(() => window.commits.length === 1);
		const aria = await handle.evaluate((element) => ({
			min: element.getAttribute('aria-valuemin'),
			max: element.getAttribute('aria-valuemax'),
			now: element.getAttribute('aria-valuenow'),
		}));
		assert.ok(aria.min && aria.max && aria.now);

		await page.setViewportSize({ width: 320, height: 80 });
		await page.waitForSelector('[data-sidebar-minimum-height-notice]');
		const unsupported = await page.evaluate(() => {
			const stack = document.querySelector('[data-sidebar-panel-stack]');
			const notice = document.querySelector(
				'[data-sidebar-minimum-height-notice]',
			);
			return {
				feasible: stack?.dataset.sidebarLayoutFeasible,
				requiredHeight: stack?.dataset.sidebarRequiredTitleHeight,
				noticeText: notice?.textContent,
				scrollHeight: stack?.scrollHeight,
				clientHeight: stack?.clientHeight,
			};
		});
		assert.equal(unsupported.feasible, 'false');
		assert.ok(Number(unsupported.requiredHeight) > 80);
		assert.match(unsupported.noticeText ?? '', /Increase the window height/u);
		assert.ok(unsupported.scrollHeight <= unsupported.clientHeight + 1);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
});
