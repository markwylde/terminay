import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';

for (const { sgr, legacy } of [
	{ sgr: true, legacy: false },
	{ sgr: false, legacy: false },
	{ sgr: true, legacy: true },
]) {
	test(`touch activates a mock TUI button once (${sgr ? 'SGR' : 'binary'}, ${legacy ? 'legacy touch' : 'pointer'})`, async ({
		mainWindow,
	}) => {
		const cdp = await mainWindow.context().newCDPSession(mainWindow);
		await cdp.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 1,
		});
		if (legacy)
			await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
				source: 'delete window.PointerEvent;',
			});
		await mainWindow.reload();
		await mainWindow.waitForLoadState('domcontentloaded');
		const panel = mainWindow.locator('.terminal-panel:visible').first();
		const source = `
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.write('\\x1b[?1000h\\x1b[?1006${sgr ? 'h' : 'l'}');
let pending=Buffer.alloc(0),clicks=0,releases=0,wheels=0;
const draw=()=>process.stdout.write('\\x1b[H\\x1b[2J[ Scroll to bottom ]\\r\\nclicks='+clicks+' releases='+releases+' wheels='+wheels+'\\r\\nhttps://example.com/tui-touch');
draw();
process.stdin.on('data',chunk=>{pending=Buffer.concat([pending,chunk]);while(pending.length){
if(pending[0]===3){process.stdout.write('\\x1b[?1000l\\x1b[?1006l');process.exit();}
let button,release=false,size=0;
if(pending.length<3)return;
if(pending[2]===77){if(pending.length<6)return;size=6;button=pending[3]-32;release=button===3;}
else {const m=/^\\x1b\\[<(\\d+);\\d+;\\d+([Mm])/.exec(pending.toString());if(!m)return;size=m[0].length;button=Number(m[1]);release=m[2]==='m';}
if(release)releases++;else if(button===0)clicks++;else if(button===64||button===65)wheels++;
pending=pending.subarray(size);draw();}});`;
		await submitTerminalCommand(
			mainWindow,
			`node -e '${source.replaceAll("'", `'"'"'`)}'`,
			panel,
		);
		await expect(panel).toContainText('clicks=0 releases=0 wheels=0');
		const box = await panel.locator('.xterm-screen').boundingBox();
		if (!box) throw new Error('No terminal screen');
		const point = { x: box.x + 40, y: box.y + 8 };
		await mainWindow.mouse.click(point.x, point.y);
		await expect(panel).toContainText('clicks=1 releases=1 wheels=0');
		const touch = (
			type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
			p?: { x: number; y: number },
		) =>
			cdp.send('Input.dispatchTouchEvent', {
				type,
				touchPoints: p ? [{ ...p, id: 1 }] : [],
			});
		await touch('touchStart', point);
		await touch('touchEnd');
		await expect(panel).toContainText('clicks=2 releases=2 wheels=0');
		// A pan still reaches xterm as wheel reports, never as a button click.
		await touch('touchStart', { ...point, y: point.y + 100 });
		for (let i = 1; i <= 8; i++)
			await touch('touchMove', { ...point, y: point.y + 100 + i * 10 });
		await touch('touchEnd');
		await expect(panel).toContainText('clicks=2 releases=2');
		await expect(panel).not.toContainText('wheels=0');
		// Cancellation cannot become a click.
		await touch('touchStart', point);
		await touch('touchCancel');
		await expect(panel).toContainText('clicks=2 releases=2');
		// A URL inside the TUI keeps the existing link menu priority.
		const link = panel
			.locator('.xterm-rows')
			.getByText('https://example.com/tui-touch', { exact: true });
		const linkBox = await link.boundingBox();
		if (!linkBox) throw new Error('No terminal link');
		await touch('touchStart', {
			x: linkBox.x + 40,
			y: linkBox.y + linkBox.height / 2,
		});
		await touch('touchEnd');
		await expect(
			mainWindow.getByRole('button', { name: 'Copy Link', exact: true }),
		).toBeVisible();
		await expect(panel).toContainText('clicks=2 releases=2');
		await mainWindow.keyboard.press('Escape');
		await cdp.detach();
		await mainWindow.keyboard.press('Control+c');
	});
}

test('plain terminal touch still scrolls, focuses, and selects', async ({
	mainWindow,
}) => {
	const cdp = await mainWindow.context().newCDPSession(mainWindow);
	await cdp.send('Emulation.setTouchEmulationEnabled', {
		enabled: true,
		maxTouchPoints: 1,
	});
	await mainWindow.reload();
	await mainWindow.waitForLoadState('domcontentloaded');
	const panel = mainWindow.locator('.terminal-panel:visible').first();
	await submitTerminalCommand(
		mainWindow,
		'seq 1 150 | while read n; do printf \'touch-history-%s\\n\' "$n"; done',
		panel,
	);
	const rows = panel.locator('.xterm-rows');
	await expect(rows).toContainText('touch-history-150');
	const box = await panel.locator('.xterm-screen').boundingBox();
	if (!box) throw new Error('No terminal screen');
	const point = { x: box.x + 50, y: box.y + box.height / 2 };
	const touch = (
		type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
		p?: { x: number; y: number },
	) =>
		cdp.send('Input.dispatchTouchEvent', {
			type,
			touchPoints: p ? [{ ...p, id: 1 }] : [],
		});
	const before = await rows.locator('div').first().innerText();
	await touch('touchStart', point);
	for (let i = 1; i <= 8; i++)
		await touch('touchMove', { x: point.x, y: point.y + i * 10 });
	await touch('touchEnd');
	await expect
		.poll(() => rows.locator('div').first().innerText())
		.not.toBe(before);
	await touch('touchStart', point);
	await touch('touchEnd');
	await expect(panel.locator('.xterm-helper-textarea')).toBeFocused();
	// Holding still continues to select a word without raising a link menu.
	await touch('touchStart', point);
	await expect(panel.locator('.xterm-selection div').first()).toBeVisible();
	await touch('touchEnd');
	await expect(
		panel.getByRole('button', { name: 'Copy', exact: true }),
	).toBeVisible();
	await cdp.detach();
});
