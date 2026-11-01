import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createStartedProject } from './support/project-start';
import { submitTerminalCommand } from './support/terminal';
import {
	activeTerminalSessionId,
	createTerminal,
} from './support/terminal-session';

function quote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function mouseProgram(sgr: boolean): string {
	// No real agent or saved transcript: this program shows exactly which
	// bytes reached the PTY, and recognizes fragmented/coalesced mouse input.
	const source = `
process.stdin.setRawMode(true); process.stdin.resume();
process.stdout.write("\\x1b[?1000h" + ${sgr ? '"\\x1b[?1006h"' : '"\\x1b[?1006l"'});
for(let i=0;i<300;i++) process.stdout.write("history-row-"+i+"\\r\\n");
process.stdout.write("mouse-"+"ready\\r\\n");
let pending=Buffer.alloc(0), count=0;
process.stdin.on("data",chunk=>{
 pending=Buffer.concat([pending,chunk]);
 while(pending.length){
  if(pending[0]===27){
   let size=0;
   if(pending.length<3) return;
   if(pending[2]===77){ if(pending.length<6) return; size=6; }
   else { const match=/^\\x1b\\[<\\d+;\\d+;\\d+[Mm]/.exec(pending.toString("ascii")); if(!match) return; size=match[0].length; }
   process.stdout.write("\\r\\nreport-"+(++count)+":"+pending.subarray(0,size).toString("hex")+"\\r\\n");
   pending=pending.subarray(size);
  } else {
   const key=pending[0]; pending=pending.subarray(1);
   if(key===3){ process.stdout.write("\\x1b[?1000l\\x1b[?1006l"); process.exit(0); }
   if(key===29){
    process.stdout.write("\\x1b[?1000l\\x1b[?1006l");
    for(let i=0;i<100;i++)process.stdout.write("selection-history-"+i+"\\r\\n");
    process.stdout.write("mouse-"+"disabled\\r\\n");
   } else process.stdout.write("\\r\\nkey-"+key+"\\r\\n");
  }
 }
});`;
	return `node -e ${quote(source)}`;
}

async function screenPoint(page: Page, panel: Locator) {
	const root = panel.locator('.terminal-panel-root');
	const cols = Number(await root.getAttribute('data-terminal-cols'));
	const rows = Number(await root.getAttribute('data-terminal-rows'));
	const box = await panel.locator('.xterm-screen').boundingBox();
	if (!box || !cols || !rows) throw new Error('Terminal grid is unavailable');
	const col = 110;
	const row = 4;
	expect(cols).toBeGreaterThan(col + 1);
	const point = {
		x: box.x + ((col + 0.5) * box.width) / cols,
		y: box.y + ((row + 0.5) * box.height) / rows,
	};
	await page.mouse.move(point.x, point.y);
	return { ...point, col, row };
}

for (const sgr of [true, false]) {
	test(`mouse input survives long-session tab return and checkpoint restore (${sgr ? 'SGR' : 'binary'})`, async ({
		mainWindow,
		electronApp,
	}) => {
		test.setTimeout(90_000);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const window = BrowserWindow.getAllWindows()[0];
			if (!window) throw new Error('Workspace window unavailable');
			window.setBounds({ width: 1800, height: 1000 });
		});
		const sessionId = await activeTerminalSessionId(mainWindow);
		const panel = mainWindow.locator(
			`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
		);
		const project = mainWindow.locator('.project-tab[aria-selected="true"]');
		const projectId = await project.getAttribute('data-project-id');
		const tabId = await mainWindow
			.locator('.terminal-tab-content--active:visible')
			.getAttribute('data-panel-id');
		if (!tabId) throw new Error('Original terminal panel identity unavailable');
		await submitTerminalCommand(mainWindow, mouseProgram(sgr), panel);
		await expect(panel).toContainText('mouse-ready');
		let count = 0;
		const verifyMouse = async () => {
			await expect(panel).toBeVisible();
			await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0);
			const { col, row } = await screenPoint(mainWindow, panel);
			const report = (button: number, release = false) =>
				sgr
					? Buffer.from(
							`\x1b[<${button};${col + 1};${row + 1}${release ? 'm' : 'M'}`,
						).toString('hex')
					: Buffer.from([
							27,
							91,
							77,
							(release ? 3 : button) + 32,
							col + 33,
							row + 33,
						]).toString('hex');
			await mainWindow.mouse.down();
			await expect(panel).toContainText(`report-${++count}:${report(0)}`);
			await mainWindow.mouse.up();
			await expect(panel).toContainText(`report-${++count}:${report(0, true)}`);
			await mainWindow.mouse.wheel(0, -100);
			await expect(panel).toContainText(`report-${++count}:${report(64)}`);
			await panel.locator('.xterm-helper-textarea').focus();
			const key = 97 + count;
			await mainWindow.keyboard.type(String.fromCharCode(key));
			await expect(panel).toContainText(`key-${key}`);
		};
		await verifyMouse();
		await createTerminal(mainWindow);
		await mainWindow
			.locator(`.terminal-tab-content[data-panel-id="${tabId}"]:visible`)
			.click();
		await expect(panel).toBeVisible();
		await verifyMouse();
		await createStartedProject(mainWindow);
		if (!projectId) throw new Error('Original project identity unavailable');
		await mainWindow
			.locator(`.project-tab[data-project-id="${projectId}"]`)
			.click();
		await verifyMouse();
		// Destroy only the renderer. The running test program will not emit its
		// mouse setup again, so input now proves checkpoint mode restoration.
		await mainWindow.reload();
		await mainWindow.waitForLoadState('domcontentloaded');
		await expect(panel).toBeVisible({ timeout: 30_000 });
		await verifyMouse();
		const streamCount = () =>
			electronApp.evaluate((_electron, id) => {
				const handoff = (
					globalThis as typeof globalThis & {
						__terminayTestTerminalHandoff: { streams(id: string): number };
					}
				).__terminayTestTerminalHandoff;
				return handoff.streams(id);
			}, sessionId);
		const streamsBefore = await streamCount();
		const ended = await electronApp.evaluate((_electron, id) => {
			return (
				globalThis as typeof globalThis & {
					__terminayTestTerminalHandoff: { congest(id: string): number };
				}
			).__terminayTestTerminalHandoff.congest(id);
		}, sessionId);
		expect(ended).toBeGreaterThan(0);
		await expect.poll(streamCount).toBe(streamsBefore + 1);
		await verifyMouse();
		await mainWindow.keyboard.press('Control+BracketRight');
		await expect(panel).toContainText('mouse-disabled');
		const point = await screenPoint(mainWindow, panel);
		await mainWindow.mouse.down();
		await mainWindow.mouse.move(point.x + 100, point.y + 20, { steps: 8 });
		await mainWindow.mouse.up();
		await expect
			.poll(() => panel.locator('.xterm-selection > div').count())
			.toBeGreaterThan(0);
		const before = await panel.locator('.xterm-rows').textContent();
		await mainWindow.mouse.wheel(0, -1000);
		await expect
			.poll(() => panel.locator('.xterm-rows').textContent())
			.not.toBe(before);
		await panel.locator('.xterm-helper-textarea').focus();
		await mainWindow.keyboard.press('Control+c');
	});
}
