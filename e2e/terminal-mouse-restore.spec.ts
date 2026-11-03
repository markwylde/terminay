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

// Match Codex's alternate-screen pointer modes. Setup is emitted only once:
// returning to the window must preserve capture without help from the program.
test('Codex-style wheel capture survives window activation and terminal switching', async ({
	mainWindow,
	electronApp,
}) => {
	test.setTimeout(90_000);
	// Playwright emulates an always-focused page by default, masking real
	// window blur/focus events even when Electron hides the native window.
	const cdp = await mainWindow.context().newCDPSession(mainWindow);
	await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
	const sessionId = await activeTerminalSessionId(mainWindow);
	const panel = mainWindow.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
	const tabId = await mainWindow
		.locator('.terminal-tab-content--active:visible')
		.getAttribute('data-panel-id');
	expect(tabId).toBeTruthy();
	const source = `
process.stdin.setRawMode(true); process.stdin.resume();
for(let i=0;i<300;i++)process.stdout.write('shell-history-'+i+'\\r\\n');
process.stdout.write('\\x1b[?1049h\\x1b[?1007l\\x1b[?1000h\\x1b[?1002h\\x1b[?1003h\\x1b[?1006h\\x1b[?1004h');
let pending='', wheels=0, clicks=0;
function draw(){process.stdout.write('\\x1b[H\\x1b[2Jcapture-ready wheels='+wheels+' clicks='+clicks+'\\r\\n');}
draw();
process.stdin.on('data',chunk=>{
 pending+=chunk.toString();
 while(pending.length){
  if(pending[0]==='\\x03'){process.stdout.write('\\x1b[?1003l\\x1b[?1002l\\x1b[?1000l\\x1b[?1006l\\x1b[?1004l\\x1b[?1049l');process.exit(0);}
  const report=/^\\x1b\\[<(\\d+);\\d+;\\d+([Mm])/.exec(pending);
  if(report){const button=Number(report[1]);if(button===64||button===65)wheels++;if(button===0&&report[2]==='M')clicks++;pending=pending.slice(report[0].length);draw();continue;}
  const focus=/^\\x1b\\[[IO]/.exec(pending);
  if(focus){pending=pending.slice(focus[0].length);draw();continue;}
  if(pending[0]==='\\x1b')break;
  pending=pending.slice(1);
 }
});`;
	await submitTerminalCommand(mainWindow, `node -e ${quote(source)}`, panel);
	await expect(panel).toContainText('capture-ready wheels=0 clicks=0');
	let wheels = 0;
	let clicks = 0;
	const verifyCapture = async () => {
		await expect(panel).toBeVisible();
		await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0);
		const box = await panel.locator('.xterm-screen').boundingBox();
		if (!box) throw new Error('Terminal screen unavailable');
		await mainWindow.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await expect(panel).toContainText(`wheels=${wheels} clicks=${++clicks}`);
		await mainWindow.mouse.wheel(0, -100);
		await expect(panel).toContainText(`wheels=${++wheels} clicks=${clicks}`);
	};
	await verifyCapture();
	for (let cycle = 0; cycle < 3; cycle++) {
		// Exercise native Electron activation, not synthetic DOM focus events.
		await electronApp.evaluate(({ BrowserWindow }) => {
			BrowserWindow.getAllWindows()[0]!.hide();
		});
		await expect
			.poll(() => mainWindow.evaluate(() => document.hasFocus()))
			.toBe(false);
		await electronApp.evaluate(({ BrowserWindow }) => {
			const workspace = BrowserWindow.getAllWindows()[0]!;
			workspace.show();
			workspace.focus();
		});
		await expect
			.poll(() => mainWindow.evaluate(() => document.hasFocus()))
			.toBe(true);
		await verifyCapture();
		await createTerminal(mainWindow);
		await mainWindow
			.locator(`.terminal-tab-content[data-panel-id="${tabId}"]:visible`)
			.click();
		await verifyCapture();
	}
	// A renderer replacement also tests restoring modes from the checkpoint.
	await mainWindow.reload();
	await mainWindow.waitForLoadState('domcontentloaded');
	await expect(panel).toBeVisible({ timeout: 30_000 });
	await verifyCapture();
	await panel.locator('.xterm-helper-textarea').focus();
	await mainWindow.keyboard.press('Control+c');
});
