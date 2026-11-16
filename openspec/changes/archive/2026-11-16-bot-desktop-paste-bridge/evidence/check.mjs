// Drives the real attachDesktopClipboard inside Electron: the host clipboard is
// set in the main process, text is left selected elsewhere, the canvas is
// clicked, and Ctrl+V is pressed. "native" = paste-event path only (#625);
// "bridge" = the Desktop bridge read.
import { _electron as electron } from 'playwright';

const app = await electron.launch({
	executablePath: '/workspace/node_modules/electron/dist/electron',
	args: ['--no-sandbox', '/p/main.cjs'],
});
const page = await app.firstWindow();
await page.waitForFunction(() => typeof window.attach === 'function');
for (const bridge of [true, false, true]) {
	await app.evaluate(({ clipboard }) => clipboard.writeText('from host ✓ café'));
	console.log('main reads:', JSON.stringify(await app.evaluate(({ clipboard }) => clipboard.readText())));
	const detach = await page.evaluateHandle((b) => window.attach(b), bridge);
	await page.evaluate(() => {
		const r = document.createRange();
		r.selectNodeContents(document.getElementById('text'));
		getSelection().removeAllRanges();
		getSelection().addRange(r);
	});
	const box = await page.locator('#c').boundingBox();
	await page.mouse.click(box.x + 20, box.y + 20);
	await page.keyboard.press('Control+V');
	await page.waitForTimeout(300);
	const focus = await page.evaluate(() => document.activeElement.id || document.activeElement.nodeName);
	console.log(bridge ? 'bridge:' : 'native:', JSON.stringify(await page.evaluate(() => sent.splice(0))), 'focus', focus);
	await page.evaluate((d) => d(), detach);
}
await app.close();
