// Does Chromium raise one native paste on a focused, non-editable canvas when
// the paste shortcut's keydown is stopped (not cancelled) before the canvas?
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
await page.setContent(`
<div id="layer"><canvas id="c" tabindex="-1" width="200" height="100"></canvas></div>
<input id="src" value="café ✓ from host">
<script>
  window.log = [];
  const layer = document.getElementById('layer'), c = document.getElementById('c');
  layer.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.code === 'KeyV') || (e.shiftKey && e.code === 'Insert')) e.stopPropagation();
  }, { capture: true });
  // Stand-in for noVNC: cancels every key it sees.
  c.addEventListener('keydown', (e) => { window.log.push('novnc:' + e.code); e.preventDefault(); });
  layer.addEventListener('paste', (e) => {
    window.log.push('paste:' + e.clipboardData.getData('text/plain'));
    e.preventDefault();
  }, { capture: true });
</script>`);
await page.focus('#src');
await page.keyboard.press('Control+A');
await page.keyboard.press('Control+C');
for (const chord of ['Control+V', 'Control+Shift+V', 'Shift+Insert', 'Control+B']) {
	await page.focus('#c');
	await page.keyboard.press(chord);
	await page.waitForTimeout(100);
	console.log(chord, JSON.stringify(await page.evaluate(() => window.log.splice(0))));
}
await browser.close();
