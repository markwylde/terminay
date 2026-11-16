// The real attachDesktopClipboard in Chromium. Before clicking into the desktop
// the user highlighted text in the UI; noVNC cancels mousedown, so that
// selection survives. "previous" = the shipped wiring (paste heard on the
// layer, no catcher); "fixed" = document listener + editable catcher.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const dc = readFileSync('/p/dc.js', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
await page.setContent(`<p id="text">Viewing. Your keyboard does not reach the bot.</p>
<div id="layer"><div><canvas id="c" tabindex="-1" width="300" height="150"></canvas></div></div>
<input id="src" value="from mac host ✓"><script>${dc}</script><script>
  window.sent = [];
  const layer = document.getElementById('layer'), c = document.getElementById('c');
  c.addEventListener('mousedown', (e) => { e.preventDefault(); c.focus(); });
  c.addEventListener('keydown', (e) => { sent.push('novnc:' + e.code); e.preventDefault(); });
  const rfb = new EventTarget();
  rfb.clipboardPasteFrom = (t) => sent.push('clip:' + t);
  rfb.sendKey = (k, code, down) => sent.push((down ? '+' : '-') + code);
  window.attach = (fixed) => {
    const catcher = document.createElement('textarea');
    catcher.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
    catcher.tabIndex = -1;
    layer.appendChild(catcher);
    return DC.attachDesktopClipboard(layer, rfb, {
      isMac: false,
      focusedInside: () => layer.contains(document.activeElement),
      documentFocused: () => true, visible: () => true,
      writeHostClipboard: async () => {}, onPasteTooLarge: () => sent.push('too-large'),
      pasteRoot: fixed ? document : layer,
      catcher: fixed
        ? { focus: () => catcher.focus({ preventScroll: true }), restore: () => { catcher.value = ''; if (document.activeElement === catcher) c.focus(); } }
        : { focus() {}, restore() {} },
    });
  };
</script>`);
await page.focus('#src');
await page.keyboard.press('Control+A');
await page.keyboard.press('Control+C');
for (const fixed of [false, true]) {
	const detach = await page.evaluateHandle((f) => window.attach(f), fixed);
	await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('text')); getSelection().removeAllRanges(); getSelection().addRange(r); });
	const box = await page.locator('#c').boundingBox();
	await page.mouse.click(box.x + 20, box.y + 20);
	const before = await page.evaluate(() => `${getSelection().type} selection, focus #${document.activeElement.id}`);
	await page.keyboard.press('Control+V');
	await page.waitForTimeout(100);
	const after = await page.evaluate(() => `focus #${document.activeElement.id || document.activeElement.nodeName}`);
	console.log(fixed ? 'fixed:   ' : 'previous:', before, JSON.stringify(await page.evaluate(() => sent.splice(0))), after);
	await page.evaluate((d) => d(), detach);
}
await browser.close();
