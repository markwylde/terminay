import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Chromium component test; no Electron or privileged host APIs are involved.
test('keyboard menus skip disabled items and preserve the legacy opt-out', async () => {
	const bundle = await build({
		stdin: {
			contents: `
import { createRoot } from 'react-dom/client';
import { ContextMenu } from './src/components/ContextMenu';
const root = createRoot(document.getElementById('root'));
window.showMenu = (keyboard) => root.render(<ContextMenu x={0} y={0}
  label="Test actions" keyboard={keyboard ? { autoFocus: true } : undefined}
  onClose={() => root.render(null)} items={[
    { label: 'Unavailable first', disabled: true },
    { label: 'First' },
    { label: '', separator: true },
    { label: 'Unavailable middle', disabled: true },
    { label: 'Last' },
  ]} />);
window.showMenu(true);`,
			resolveDir: process.cwd(),
			loader: 'tsx',
		},
		bundle: true,
		write: false,
		jsx: 'automatic',
		define: { 'process.env.NODE_ENV': '"production"' },
		logLevel: 'silent',
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent('<div id="root"></div>');
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const focused = (label) =>
			page.waitForFunction(
				(text) => document.activeElement?.textContent === text,
				label,
			);
		await focused('First');
		assert.equal(
			await page.getByRole('menu', { name: 'Test actions' }).count(),
			1,
		);
		assert.equal(await page.getByRole('separator').count(), 1);
		for (const [key, label] of [
			['ArrowDown', 'Last'],
			['ArrowDown', 'First'],
			['ArrowUp', 'Last'],
			['ArrowUp', 'First'],
			['End', 'Last'],
			['Home', 'First'],
		]) {
			await page.keyboard.press(key);
			await focused(label);
		}
		await page.keyboard.press('Escape');
		await page.locator('.context-menu').waitFor({ state: 'detached' });
		await page.evaluate(() => window.showMenu(false));
		await page.locator('.context-menu').waitFor();
		assert.equal(await page.getByRole('menu').count(), 0);
		assert.equal(await page.getByRole('menuitem').count(), 0);
		assert.equal(await page.getByRole('separator').count(), 0);
		await page.getByRole('button', { name: 'First', exact: true }).focus();
		await page.keyboard.press('ArrowDown');
		await focused('First');
	} finally {
		await browser.close();
	}
});
