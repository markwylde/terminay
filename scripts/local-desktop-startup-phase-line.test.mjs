/** Layout checks for the loading document, in a real browser.
 *
 * This deliberately does NOT assert the reveal cascade. A Playwright
 * `addStyleTag` appends an ordinary <style> element, while Electron's
 * `insertCSS` installs an *injected author* stylesheet that Blink orders
 * BEFORE the document's own <style>. Modelling it with addStyleTag gave a
 * passing test while the shipped splash was stuck on one phase. The cascade is
 * asserted against real Electron in e2e/startup-phase-line.spec.ts. */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { desktopStartupLoadingDocument } = await importBundled(
	'../electron/startupLoadingDocument.ts',
);

let chromium;
try {
	({ chromium } = await import('playwright'));
} catch {
	chromium = undefined;
}

function decode(document) {
	return decodeURIComponent(
		document.slice('data:text/html;charset=UTF-8,'.length),
	);
}

const describe = chromium === undefined ? test.skip : test;

describe('the phase line never overlaps the dots or the mark', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-phase-layout-'));
	const browser = await chromium.launch();
	try {
		const file = join(directory, 'loading.html');
		await writeFile(file, decode(desktopStartupLoadingDocument()), 'utf8');
		const page = await browser.newPage({
			viewport: { width: 1000, height: 700 },
		});
		await page.goto(`file://${file}`);

		// Reveal one line the way Electron will, then measure the layout.
		await page.addStyleTag({
			content: '.phase[data-phase="project-environments-load"]{display:block}',
		});

		const layout = await page.evaluate(() => {
			const rect = (selector) => {
				const node = document.querySelector(selector);
				const box = node.getBoundingClientRect();
				return { top: box.top, bottom: box.bottom, left: box.left };
			};
			const visible = [...document.querySelectorAll('.phase')].filter(
				(node) => getComputedStyle(node).display !== 'none',
			)[0];
			const box = visible.getBoundingClientRect();
			return {
				logo: rect('.logo'),
				dots: rect('.dots'),
				phase: { top: box.top, bottom: box.bottom, left: box.left },
			};
		});

		assert.ok(layout.logo.bottom <= layout.dots.top, 'mark sits above dots');
		// The line is pinned near the bottom of the window, well clear of the
		// indicator rather than crowding it.
		assert.ok(
			layout.phase.top - layout.dots.bottom > 120,
			`the phase line crowds the dots (gap ${layout.phase.top - layout.dots.bottom}px)`,
		);
		assert.ok(
			layout.phase.bottom < 700,
			'the phase line stays inside the viewport',
		);
	} finally {
		await browser.close();
		await rm(directory, { force: true, recursive: true });
	}
});

async function importBundled(relativePath) {
	const temporaryDirectory = await mkdtemp(
		join(tmpdir(), 'terminay-phase-line-bundle-'),
	);
	const outputPath = join(temporaryDirectory, 'module.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [new URL(relativePath, import.meta.url).pathname],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
}
