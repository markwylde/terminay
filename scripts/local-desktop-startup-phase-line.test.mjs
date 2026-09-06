/** Renders the real loading document in a browser and applies the real reveal
 * rules to it, so this asserts what the user actually sees rather than what the
 * source happens to say. A source-shape assertion previously passed while every
 * phase label was stacked on top of every other one. */

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const loaded = await importBundled('../electron/startupLoadingDocument.ts');
const { desktopStartupLoadingDocument, startupPhaseVisibilityCss } = loaded;

const timeline = await importBundled(
	'../electron/diagnostics/startupTimeline.ts',
);
const { STARTUP_PHASE_IDS, startupPhaseLabel } = timeline;

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

/** Visible phase lines, as the browser's own cascade resolves them. */
async function visibleLines(page) {
	return page.$$eval('.phase', (nodes) =>
		nodes
			.filter((node) => getComputedStyle(node).display !== 'none')
			.map((node) => node.textContent),
	);
}

const describe = chromium === undefined ? test.skip : test;

describe('exactly one phase line is visible however rules accumulate', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-phase-line-'));
	const browser = await chromium.launch();
	try {
		const file = join(directory, 'loading.html');
		await writeFile(
			file,
			decode(desktopStartupLoadingDocument('electron-ready')),
			'utf8',
		);
		const page = await browser.newPage();
		await page.goto(`file://${file}`);

		assert.deepEqual(
			await visibleLines(page),
			[startupPhaseLabel('electron-ready')],
			'the initial document shows one line',
		);

		// Apply every phase rule in order, never removing any, which is the worst
		// case the serialized remove is allowed to fall behind into.
		for (const id of STARTUP_PHASE_IDS) {
			await page.addStyleTag({ content: startupPhaseVisibilityCss(id) });
			assert.deepEqual(
				await visibleLines(page),
				[startupPhaseLabel(id)],
				`after revealing ${id} exactly its own line is visible`,
			);
		}

		// The lines must also not stack geometrically: one row, one baseline.
		const boxes = await page.$$eval('.phase', (nodes) =>
			nodes
				.filter((node) => getComputedStyle(node).display !== 'none')
				.map((node) => node.getBoundingClientRect().top),
		);
		assert.equal(boxes.length, 1);
	} finally {
		await browser.close();
		await rm(directory, { force: true, recursive: true });
	}
});

describe('the phase line never overlaps the dots or the mark', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-phase-layout-'));
	const browser = await chromium.launch();
	try {
		const file = join(directory, 'loading.html');
		await writeFile(
			file,
			decode(desktopStartupLoadingDocument('project-environments-load')),
			'utf8',
		);
		const page = await browser.newPage({
			viewport: { width: 1000, height: 700 },
		});
		await page.goto(`file://${file}`);

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
		assert.ok(
			layout.dots.bottom <= layout.phase.top,
			'the phase line sits below the dots, never over them',
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
