import { readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { submitTerminalCommand } from './support/terminal';
import { activeTerminalPanel, createTerminal } from './support/terminal-session';
import { activateDockTab } from './support/ui';

/**
 * App windows end to end (terminal-app-windows). A stub script in a real
 * terminal sends MCP requests on that terminal's own control socket and
 * capability, framed exactly as the stdio adapter frames them, so a window
 * is opened by the same path an agent uses.
 */

const MCP_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile] = process.argv.slice(2);
const params = paramsFile ? JSON.parse(readFileSync(paramsFile, 'utf8')) : {};
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'mcp-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	const result = response.ok ? response.result : undefined;
	const detail = !response.ok
		? response.error.code
		: result.window
			? result.window
			: result.windows
				? 'windows=' + result.windows.length
				: result.tools
					? 'tools=' + result.tools.map((tool) => tool.name).join(',')
					: result.content
						? 'content=' + result.content.map((item) => item.text).join('|').slice(0, 200)
						: 'ok';
	console.log(['RESULT', op, detail].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`;

const HELLO = '<h1 id="greeting">Hello world</h1><p>From the agent.</p>';

const FORM = `
<label>Region <input id="region" value="eu-west-1"></label>
<button id="go">Deploy</button>
<output id="sent"></output>
<script>
	document.getElementById('go').addEventListener('click', () => {
		window.terminay
			.sendMessage('echo deploy-to-' + document.getElementById('region').value)
			.then(() => 'sent', (error) => 'refused: ' + error.message)
			.then((outcome) => { document.getElementById('sent').textContent = outcome; });
	});
</script>`;

// A view that tries everything it must not be able to do, and reports what happened.
const HOSTILE = `
<pre id="report">running</pre>
<script>
// First of all, before anyone could have touched this view: type into the terminal.
parent.postMessage({ jsonrpc: '2.0', id: 'm1', method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'typed-by-the-hostile-view' } } }, '*');
// And the same with a file attached, naming where it would like the file to go.
parent.postMessage({ jsonrpc: '2.0', id: 'm2', method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'file-from-the-hostile-view' }, attachments: [{ id: 'f1', name: '../../hostile-view-attachment.txt', size: 4 }] } }, '*');
// And answers to requests for parts of a file that nobody made.
parent.postMessage({ jsonrpc: '2.0', id: 'host-1', result: { bytes: new ArrayBuffer(4) } }, '*');
(async () => {
	const report = { origin: self.origin, hostBridge: typeof window.terminayHost };
	try { report.parentDom = String(parent.parent.document.title); } catch (error) { report.parentDom = 'denied'; }
	try { report.storage = typeof localStorage.length; } catch (error) { report.storage = 'denied'; }
	try { top.location = 'https://example.com/'; report.topNavigation = 'allowed'; } catch (error) { report.topNavigation = 'denied'; }
	try { report.popup = window.open('https://example.com/') === null ? 'blocked' : 'opened'; } catch (error) { report.popup = 'denied'; }
	parent.postMessage({ jsonrpc: '2.0', id: 'x1', method: 'workspace/run-command', params: { command: 'touch /tmp/pwned' } }, '*');
	parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/sandbox-resource-ready', params: { html: '<p id="swapped">swapped</p>' } }, '*');
	parent.postMessage({ type: 'server-ui-host:request-action', action: 'quit' }, '*');
	// Save a file to the user's disk.
	const download = document.createElement('a');
	download.href = 'data:text/plain,pwned';
	download.download = 'pwned.txt';
	document.body.append(download);
	download.click();
	// Forged view-mirror traffic: a recording nobody asked for, and the controls only the workspace sends.
	parent.postMessage({ terminayMirror: { type: 'batch', epoch: 1, seq: 0, kind: 'snapshot', data: '[{"type":4,"data":{"href":"javascript:alert(1)"}}]' } }, '*');
	parent.postMessage({ terminayMirror: { type: 'load', code: 'top.location = "https://example.com/"' } }, '*');
	parent.postMessage({ terminayMirror: { type: 'apply', kind: 'snapshot', data: '[]' } }, '*');
	await new Promise((resolve) => setTimeout(resolve, 300));
	document.getElementById('report').textContent = JSON.stringify(report);
	// Last, because it would end this document if it worked: leave for another page.
	await new Promise((resolve) => setTimeout(resolve, 4000));
	location.href = 'https://example.com/?left-the-sandbox';
})();
</script>`;

const PHONE = { x: 40, y: 40, width: 390, height: 740 } as const;
/** The npm package of a real MCP Apps server to exercise, when asked to. */
const REAL_MCP_APP_PACKAGE = process.env.TERMINAY_E2E_REAL_MCP_APP ?? '';

const windows = (page: Page): Locator => page.locator('.app-window:not([data-hidden])');
const windowTitled = (page: Page, title: string): Locator =>
	page.locator('.app-window', { has: page.locator('.app-window__title', { hasText: title }) });
const view = (card: Locator): FrameLocator =>
	card.frameLocator('.app-window__frame').frameLocator('iframe');
const rows = (page: Page): Locator =>
	page.locator('.project-workspace--active .terminal-panel:visible .xterm-rows');
const terminalRoot = (page: Page): Locator =>
	page.locator('.project-workspace--active .terminal-panel:visible .terminal-panel-root');

async function boxOf(locator: Locator) {
	const box = await locator.boundingBox();
	if (box === null) throw new Error('element has no box');
	return box;
}

/** Wait until a window has stopped moving and resizing. */
async function settled(card: Locator): Promise<void> {
	let previous = '';
	await expect
		.poll(async () => {
			const box = await boxOf(card);
			const current = [box.x, box.y, box.width, box.height].map(Math.round).join(',');
			const same = current === previous;
			previous = current;
			return same;
		}, { intervals: [120] })
		.toBe(true);
}

test('an agent shows its own HTML in a window that minimises to an edge tab', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(180_000);
	const script = path.join(userDataDir, 'app-window-e2e.mjs');
	await writeFile(script, MCP_SCRIPT);
	let sequence = 0;
	const call = async (op: string, params?: Record<string, unknown>, prefix = '') => {
		let file = '';
		if (params !== undefined) {
			file = path.join(userDataDir, `app-window-params-${++sequence}.json`);
			await writeFile(file, JSON.stringify(params));
		}
		await submitTerminalCommand(
			mainWindow,
			`${prefix}'${process.execPath}' '${script}' ${op} ${file === '' ? '' : `'${file}'`}`,
			activeTerminalPanel(mainWindow),
		);
	};

	// --- hello world -------------------------------------------------------
	await call('show_window', { title: 'Hello', html: HELLO });
	await expect(rows(mainWindow)).toContainText('RESULT show_window win_');
	const hello = windowTitled(mainWindow, 'Hello');
	await expect(hello).toHaveAttribute('data-placement', 'window');
	await expect(view(hello).locator('#greeting')).toHaveText('Hello world');

	// Bottom-left of the pane, at most 440 wide, sized to its content.
	const pane = await boxOf(activeTerminalPanel(mainWindow));
	await expect
		.poll(async () => (await boxOf(hello)).height)
		.toBeLessThan(pane.height * 0.6);
	const open = await boxOf(hello);
	expect(Math.round(open.x - pane.x)).toBe(12);
	expect(open.width).toBeLessThanOrEqual(440);
	expect(Math.round(pane.y + pane.height - (open.y + open.height))).toBe(12);
	// A static document sizes the window to its content, not to a default.
	expect(open.height).toBeGreaterThan(60);
	expect(open.height).toBeLessThan(200);

	// The terminal tab is badged; the status bar says nothing about windows.
	await expect(mainWindow.getByRole('img', { name: '1 app window' }).first()).toBeVisible();
	await expect(mainWindow.locator('.workspace-status-bar .app-window-badge')).toHaveCount(0);

	// --- minimise: an edge tab in a rail, and the terminal ends above it ---
	const before = await boxOf(terminalRoot(mainWindow));
	await hello.getByRole('button', { name: 'Minimise window' }).click();
	await expect(hello).toHaveAttribute('data-placement', 'tab');
	await expect
		.poll(async () => Math.round(before.height - (await boxOf(terminalRoot(mainWindow))).height))
		.toBe(33);
	// The window animates into its tab; wait for it to settle on the edge.
	const paneNow = await boxOf(activeTerminalPanel(mainWindow));
	await expect
		.poll(async () => {
			const box = await boxOf(hello);
			return [Math.round(box.height), Math.round(box.y + box.height)];
		})
		.toEqual([28, Math.round(paneNow.y + paneNow.height)]);
	const tab = await boxOf(hello);
	const terminalNow = await boxOf(terminalRoot(mainWindow));
	expect(terminalNow.y + terminalNow.height).toBeLessThanOrEqual(tab.y + 1);

	// A tab slides along the edge and never leaves it.
	const header = hello.locator('.app-window__header');
	await header.hover();
	await mainWindow.mouse.down();
	await mainWindow.mouse.move(tab.x + 260, tab.y - 200, { steps: 8 });
	await mainWindow.mouse.up();
	await expect.poll(async () => (await boxOf(hello)).x).toBeGreaterThan(tab.x + 100);
	const moved = await boxOf(hello);
	expect(Math.round(moved.y)).toBe(Math.round(tab.y));
	await expect(hello).toHaveAttribute('data-placement', 'tab');

	// Restoring removes the rail and gives the terminal its rows back.
	await header.click();
	await expect(hello).toHaveAttribute('data-placement', 'window');
	await expect
		.poll(async () => Math.round((await boxOf(terminalRoot(mainWindow))).height))
		.toBe(Math.round(before.height));
	// The view was not reloaded by minimise and restore.
	await expect(view(hello).locator('#greeting')).toHaveText('Hello world');

	// --- one open window per terminal; a window talks back ------------------
	await call('show_window', { title: 'Deploy', html: FORM });
	const deploy = windowTitled(mainWindow, 'Deploy');
	await expect(deploy).toHaveAttribute('data-placement', 'window');
	await expect(hello).toHaveAttribute('data-placement', 'tab');
	await expect(mainWindow.getByRole('img', { name: '2 app windows' }).first()).toBeVisible();

	// The window animates to its content's height; a click aimed at a moving
	// frame would miss, so wait for it to come to rest.
	await settled(deploy);
	await view(deploy).locator('#region').fill('us-east-1');
	await view(deploy).locator('#go').click();
	// The view is told the outcome of its request.
	await expect(view(deploy).locator('#sent')).toHaveText('sent');
	// The message is typed into this terminal and submitted; the shell echoes it.
	await expect(rows(mainWindow)).toContainText('deploy-to-us-east-1');
	await expect(deploy).toHaveAttribute('data-placement', 'tab');

	// --- windows belong to their terminal and survive a switch --------------
	await deploy.locator('.app-window__header').click();
	await expect(deploy).toHaveAttribute('data-placement', 'window');
	await settled(deploy);
	// Something only the live view knows: typed, not sent anywhere.
	await view(deploy).locator('#region').fill('ap-south-1');
	await createTerminal(mainWindow);
	await expect(windows(mainWindow)).toHaveCount(0);
	await call('list_windows');
	await expect(rows(mainWindow)).toContainText('RESULT list_windows windows=0');

	// --- a window that arrives in a terminal you are not looking at ----------
	await call('show_window', { title: 'Other terminal', html: HELLO }, 'sleep 4; ');
	await activateDockTab(mainWindow, 'Terminal 1');
	// Back in Terminal 1 the view is exactly as it was left: it never reloaded.
	await expect(deploy).toHaveAttribute('data-placement', 'window');
	await expect(view(deploy).locator('#region')).toHaveValue('ap-south-1');
	// Terminal 2's badge pulses until it is shown, and so does the project's.
	await expect(
		mainWindow.getByRole('img', { name: '1 app window, new', exact: true }),
	).toBeVisible({ timeout: 20_000 });
	// (A project tab's children are presentational, so its badge is read
	// by its label rather than by role.)
	await expect(
		mainWindow.locator('.project-tab .app-window-badge--unseen').first(),
	).toHaveAttribute('aria-label', '3 app windows, new');
	await activateDockTab(mainWindow, 'Terminal 2');
	await expect(mainWindow.locator('.app-window-badge--unseen')).toHaveCount(0);
	await expect(mainWindow.getByRole('img', { name: '1 app window', exact: true })).toBeVisible();

	// --- fill the pane, then close ------------------------------------------
	const other = windowTitled(mainWindow, 'Other terminal');
	await expect(view(other).locator('#greeting')).toHaveText('Hello world');
	await other.getByRole('button', { name: 'Fill the pane' }).click();
	await expect(other).toHaveAttribute('data-placement', 'fullscreen');
	const fillPane = await boxOf(activeTerminalPanel(mainWindow));
	await expect
		.poll(async () => {
			const box = await boxOf(other);
			return [Math.round(box.width), Math.round(box.height)];
		})
		.toEqual([Math.round(fillPane.width), Math.round(fillPane.height)]);
	await other.getByRole('button', { name: 'Restore window size' }).click();
	await expect(other).toHaveAttribute('data-placement', 'window');
	await other.getByRole('button', { name: 'Close window' }).click();
	await expect(other).toHaveCount(0);
	// The last window is gone, so the terminal's badge is too.
	await expect(mainWindow.getByRole('img', { name: '1 app window', exact: true })).toHaveCount(0);

	// --- the agent updates a window in place and closes it ------------------
	await activateDockTab(mainWindow, 'Terminal 1');
	await call('list_windows');
	await expect(rows(mainWindow)).toContainText('RESULT list_windows windows=2');
	await call('show_window', { title: 'Replaced', html: '<p id="next">second version</p>', window: 'not-a-real-handle' });
	await expect(rows(mainWindow)).toContainText('RESULT show_window not_found');
	await expect(windowTitled(mainWindow, 'Replaced')).toHaveCount(0);
});

// A view that sends a picture with its answer. The text ends in a backslash so
// the shell reads the attachment line as part of the same echo.
const ATTACH = `
<p id="can"></p>
<button id="go">Send</button>
<output id="sent"></output>
<script>
	document.getElementById('can').textContent = String(window.terminay.attachments);
	document.getElementById('go').addEventListener('click', () => {
		const bytes = new Uint8Array(3 * 1024 * 1024);
		for (let index = 0; index < bytes.length; index += 1024) bytes[index] = (index / 1024) % 251;
		window.terminay
			.sendMessage('echo got-the-file \\\\', { files: [new File([bytes], 'screen shot.png', { type: 'image/png' })] })
			.then((result) => 'sent ' + JSON.stringify(result), (error) => 'refused: ' + error.message)
			.then((outcome) => { document.getElementById('sent').textContent = outcome; });
	});
</script>`;

test('a file attached to a window message is saved by the server and its path typed into the terminal', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'app-window-attach.mjs');
	const params = path.join(userDataDir, 'app-window-attach.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ title: 'Attach', html: ATTACH }));
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' show_window '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	const attach = windowTitled(mainWindow, 'Attach');
	await expect(view(attach).locator('#can')).toHaveText('true');
	await settled(attach);
	await view(attach).locator('#go').click();
	// The view is told it was delivered, and nothing about where the file went.
	await expect(view(attach).locator('#sent')).toHaveText('sent {}');
	await expect(attach).toHaveAttribute('data-placement', 'tab');
	// The terminal was given the text and the path, as one submission.
	const attached = /got-the-file\s+Attached: (\/[^\s]*?terminay-attachments\/[0-9a-f]{16}-screen_shot\.png)/u;
	await expect(rows(mainWindow)).toContainText(attached);
	const [, file] = attached.exec((await rows(mainWindow).textContent()) ?? '') ?? [];
	const written = await readFile(file as string);
	expect(written.byteLength).toBe(3 * 1024 * 1024);
	for (const index of [0, 1024, 250 * 1024, 251 * 1024, 3 * 1024 * 1024 - 1024])
		expect(written[index]).toBe((index / 1024) % 251);
	expect(written[1]).toBe(0);
});

test('a window that arrives while another project is in front stays with its own project', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'app-window-project.mjs');
	const params = path.join(userDataDir, 'app-window-project.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ title: 'Asked here', html: HELLO }));

	await mainWindow.getByLabel('Create project').click();
	const projects = mainWindow.locator('.project-tab');
	await expect(projects).toHaveCount(2);
	await expect(mainWindow.locator('[data-pending-project-id]')).toHaveCount(0);
	const asking = projects.first();
	const other = projects.last();

	// A terminal in the first project asks for a window, and the user moves to
	// the other project before it arrives.
	await asking.click();
	await expect(asking).toHaveClass(/project-tab--active/);
	await submitTerminalCommand(
		mainWindow,
		`sleep 4; '${process.execPath}' '${script}' show_window '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	await other.click();
	await expect(other).toHaveClass(/project-tab--active/);

	// The window has arrived: its project's tab is badged.
	await expect(asking.locator('.app-window-badge')).toHaveAttribute(
		'aria-label',
		/^1 app window/,
		{ timeout: 20_000 },
	);
	// It is not drawn over the project in front, and its own project says it is new.
	const card = windowTitled(mainWindow, 'Asked here');
	await expect(card).toBeHidden();
	await expect(windows(mainWindow)).toHaveCount(0);
	await expect(asking.locator('.app-window-badge')).toHaveAttribute(
		'aria-label',
		'1 app window, new',
	);

	// Back in the project that asked, it is over the terminal that asked.
	await asking.click();
	await expect(card).toHaveAttribute('data-placement', 'window');
	await expect(card).toBeVisible();
	await expect(view(card).locator('#greeting')).toHaveText('Hello world');
	const pane = await boxOf(activeTerminalPanel(mainWindow));
	const open = await boxOf(card);
	expect(Math.round(open.x - pane.x)).toBe(12);
	await expect(asking.locator('.app-window-badge')).toHaveAttribute(
		'aria-label',
		'1 app window',
	);

	// Leaving the project takes its window out of the way: what is now in
	// front is clicked where the window was.
	await other.click();
	await expect(other).toHaveClass(/project-tab--active/);
	await expect(windows(mainWindow)).toHaveCount(0);
	await mainWindow.mouse.click(open.x + open.width / 2, open.y + open.height / 2);
	await expect(
		mainWindow.locator('.project-workspace--active .xterm-helper-textarea').first(),
	).toBeFocused();

	// A window of this project's own is the only one shown here.
	await writeFile(params, JSON.stringify({ title: 'Asked there', html: HELLO }));
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' show_window '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	const second = windowTitled(mainWindow, 'Asked there');
	await expect(second).toHaveAttribute('data-placement', 'window');
	await expect(windows(mainWindow)).toHaveCount(1);
	await expect(card).toBeHidden();

	// And the same from the other side, with neither view reloaded or lost.
	await asking.click();
	await expect(card).toBeVisible();
	await expect(second).toBeHidden();
	await expect(windows(mainWindow)).toHaveCount(1);
	await expect(view(card).locator('#greeting')).toHaveText('Hello world');
});

test('a hostile view cannot reach the workspace, navigate it, or issue host commands', async ({
	mainWindow,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'app-window-hostile.mjs');
	const params = path.join(userDataDir, 'app-window-hostile.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ title: 'Hostile', html: HOSTILE }));
	const url = mainWindow.url();
	let downloads = 0;
	mainWindow.on('download', () => {
		downloads += 1;
	});
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' show_window '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	const hostile = windowTitled(mainWindow, 'Hostile');
	const report = view(hostile).locator('#report');
	await expect(report).toContainText('"origin"');
	expect(JSON.parse((await report.textContent()) ?? '{}')).toEqual({
		origin: 'null',
		hostBridge: 'undefined',
		parentDom: 'denied',
		storage: 'denied',
		topNavigation: 'denied',
		popup: 'blocked',
	});
	// The forged proxy message did not replace the document, the workspace did
	// not navigate, and the app is still here.
	await expect(view(hostile).locator('#swapped')).toHaveCount(0);
	expect(mainWindow.url()).toBe(url);
	await expect(activeTerminalPanel(mainWindow)).toBeVisible();
	// Nothing was typed into the terminal, and nothing was downloaded.
	await expect(rows(mainWindow)).not.toContainText('typed-by-the-hostile-view');
	await expect(rows(mainWindow)).not.toContainText('file-from-the-hostile-view');
	await expect(hostile.locator('.app-window__send')).toHaveCount(0);
	const scratch = await readdir(path.join(os.tmpdir(), 'terminay-attachments')).catch(() => [] as string[]);
	expect(scratch.filter((name) => name.includes('hostile-view-attachment'))).toEqual([]);
	expect(downloads).toBe(0);
	// The proxy itself has an opaque origin and no host bridge either.
	const proxy = hostile.frameLocator('.app-window__frame');
	expect(await proxy.locator('body').evaluate(() => self.origin)).toBe('null');
	expect(
		await proxy.locator('body').evaluate(() => typeof (window as unknown as { terminayHost?: unknown }).terminayHost),
	).toBe('undefined');
	// Last, the view tries to navigate itself to another site. Its frame is
	// taken away, the window says why, and no frame ever holds that page.
	await expect(hostile).toContainText('This window stopped because its page tried to leave or replace itself.', { timeout: 15_000 });
	expect(mainWindow.frames().filter((frame) => frame.url().includes('example.com'))).toEqual([]);
	expect(mainWindow.url()).toBe(url);
});

test('a policy changed in Settings governs the next request, and the rail resizes the terminal once', async ({
	mainWindow,
	appHarness,
	userDataDir,
}) => {
	test.setTimeout(180_000);
	const script = path.join(userDataDir, 'app-window-policy.mjs');
	const params = path.join(userDataDir, 'app-window-policy.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ title: 'Policy', html: HELLO }));
	const show = () =>
		submitTerminalCommand(
			mainWindow,
			`'${process.execPath}' '${script}' show_window '${params}'`,
			activeTerminalPanel(mainWindow),
		);
	const strip = mainWindow.locator('.project-workspace--active .terminal-mcp-approval:visible');
	/** The size the shell itself reports, tagged so the echo of the command is not matched. */
	const size = async (tag: string) => {
		await submitTerminalCommand(
			mainWindow,
			`echo ${tag}-$(stty size | tr ' ' x)-END`,
			activeTerminalPanel(mainWindow),
		);
		const pattern = new RegExp(`${tag}-(\\d+)x(\\d+)-END`);
		await expect(rows(mainWindow)).toContainText(pattern);
		const match = pattern.exec((await rows(mainWindow).textContent()) ?? '');
		if (match === null) throw new Error('no size');
		return { rows: Number(match[1]), cols: Number(match[2]) };
	};

	// Always Allow by default: the window opens and nothing asks.
	await show();
	const card = windowTitled(mainWindow, 'Policy');
	await expect(card).toHaveAttribute('data-placement', 'window');
	await expect(strip).toHaveCount(0);

	// --- the rail takes rows from the terminal, as the shell sees it --------
	const open = await size('OPENED');
	await card.getByRole('button', { name: 'Minimise window' }).click();
	await expect(card).toHaveAttribute('data-placement', 'tab');
	await settled(card);
	const railed = await size('RAILED');
	expect(railed.cols).toBe(open.cols);
	expect(open.rows - railed.rows).toBeGreaterThanOrEqual(1);
	expect(open.rows - railed.rows).toBeLessThanOrEqual(3);
	// The size is stable: asking again gives the same grid.
	expect(await size('AGAIN')).toEqual(railed);
	await card.locator('.app-window__header').click();
	await expect(card).toHaveAttribute('data-placement', 'window');
	await expect.poll(async () => (await size(`BACK${Date.now()}`)).rows).toBe(open.rows);
	await card.getByRole('button', { name: 'Close window' }).click();
	await expect(card).toHaveCount(0);

	// --- Ask Permission, set in the Settings window, applies in this one ----
	const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'terminay-mcp' });
	const policy = settings.locator('.settings-row', { hasText: 'App Windows' }).first().locator('select');
	await expect(policy).toHaveValue('allow');
	await policy.selectOption('ask');
	await expect(settings.getByText('Saved', { exact: true })).toBeVisible();
	await expect(policy).toHaveValue('ask');
	await mainWindow.bringToFront();
	await show();
	await expect(strip).toContainText('App Windows');
	await expect(card).toHaveCount(0);
	await strip.getByRole('button', { name: 'Decline' }).click();
	await expect(rows(mainWindow)).toContainText('RESULT show_window permission_declined');
	await expect(card).toHaveCount(0);
	await show();
	await strip.getByRole('button', { name: 'Allow One Time' }).click();
	await expect(card).toHaveAttribute('data-placement', 'window');
	await expect(strip).toHaveCount(0);
	await card.getByRole('button', { name: 'Close window' }).click();

	// --- Never Allow refuses without asking ---------------------------------
	await policy.selectOption('deny');
	await mainWindow.bringToFront();
	await show();
	await expect(rows(mainWindow)).toContainText('RESULT show_window permission_denied');
	await expect(strip).toHaveCount(0);
	await expect(card).toHaveCount(0);
});

test('at phone width an open window is a sheet across the bottom', async ({
	mainWindow,
	electronApp,
	userDataDir,
}) => {
	test.setTimeout(120_000);
	const script = path.join(userDataDir, 'app-window-phone.mjs');
	const params = path.join(userDataDir, 'app-window-phone.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ title: 'Sheet', html: HELLO }));
	const nativeWindow = await electronApp.browserWindow(mainWindow);
	await nativeWindow.evaluate((window, next) => {
		window.setBounds(next);
	}, PHONE);
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' show_window '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	const sheet = windowTitled(mainWindow, 'Sheet');
	await expect(sheet).toHaveAttribute('data-placement', 'sheet');
	await expect(view(sheet).locator('#greeting')).toHaveText('Hello world');
	const pane = await boxOf(activeTerminalPanel(mainWindow));
	await expect
		.poll(async () => {
			const box = await boxOf(sheet);
			return [Math.round(box.x), Math.round(box.width), Math.round(box.y + box.height)];
		})
		.toEqual([Math.round(pane.x), Math.round(pane.width), Math.round(pane.y + pane.height)]);
	// Touch-sized controls.
	const minimise = await boxOf(sheet.getByRole('button', { name: 'Minimise window' }));
	expect(minimise.height).toBeGreaterThanOrEqual(30);
	await sheet.getByRole('button', { name: 'Minimise window' }).click();
	await expect(sheet).toHaveAttribute('data-placement', 'tab');
	await expect.poll(async () => Math.round((await boxOf(sheet)).height)).toBe(34);
});

test('a connected server’s tool shows its MCP App in the calling terminal', async ({
	mainWindow,
	appHarness,
	userDataDir,
}) => {
	test.setTimeout(180_000);
	const script = path.join(userDataDir, 'app-window-gateway.mjs');
	await writeFile(script, MCP_SCRIPT);
	let sequence = 0;
	const call = async (op: string, params?: Record<string, unknown>) => {
		let file = '';
		if (params !== undefined) {
			file = path.join(userDataDir, `gateway-params-${++sequence}.json`);
			await writeFile(file, JSON.stringify(params));
		}
		await submitTerminalCommand(
			mainWindow,
			`'${process.execPath}' '${script}' ${op} ${file === '' ? '' : `'${file}'`}`,
			activeTerminalPanel(mainWindow),
		);
	};
	const fixture = path.resolve('apps/terminay-server/test/fixtures/upstream-apps-server.mjs');

	// Before anything is connected the agent is offered no extra tools.
	await call('list_connected_tools');
	await expect(rows(mainWindow)).toContainText('RESULT list_connected_tools tools=');

	// --- connect a server in Settings > AI ---------------------------------
	const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'terminay-mcp' });
	const servers = settings.locator('.connected-servers');
	await expect(servers).toContainText('No servers are connected.');
	// The three new permission policies are listed and default to Always Allow.
	for (const label of ['App Windows', 'Connected Server Tools', 'Window Messages'])
		await expect(settings.locator('.settings-row', { hasText: label }).first()).toBeVisible();

	await servers.getByRole('button', { name: 'Add server' }).click();
	const form = servers.locator('.connected-servers-form');
	await form.getByPlaceholder('diagrams').fill('Not Valid');
	await form.getByPlaceholder('npx').fill(process.execPath);
	await form.getByRole('button', { name: 'Connect server' }).click();
	await expect(form.getByRole('alert')).toContainText('lowercase');
	await form.getByPlaceholder('diagrams').fill('diagrams');
	await form.locator('textarea').fill(fixture);
	await form.getByRole('button', { name: 'Add variable' }).click();
	await form.getByPlaceholder('NAME').fill('FIXTURE_SECRET');
	await form.getByPlaceholder('Value').fill('s3cret-value');
	await form.getByRole('button', { name: 'Connect server' }).click();
	const item = servers.locator('.connected-servers-item', { hasText: 'diagrams' });
	await expect(item).toContainText('Starts when an agent first needs it');

	// A saved credential is write-only: its name comes back, its value does not.
	await item.getByRole('button', { name: 'Edit diagrams' }).click();
	const stored = servers.locator('.connected-servers-credential');
	await expect(stored.locator('input').first()).toHaveValue('FIXTURE_SECRET');
	await expect(stored.locator('input[type="password"]')).toHaveValue('');
	await expect(stored.locator('input[type="password"]')).toHaveAttribute('placeholder', 'Set. Type to replace.');
	expect(await settings.content()).not.toContain('s3cret-value');
	await servers.getByRole('button', { name: 'Cancel' }).click();

	// A server that cannot start says why and does not hide the others.
	await servers.getByRole('button', { name: 'Add server' }).click();
	await form.getByPlaceholder('diagrams').fill('broken');
	await form.getByPlaceholder('npx').fill('/nonexistent/terminay-e2e-command');
	await form.getByRole('button', { name: 'Connect server' }).click();
	await expect(servers.locator('.connected-servers-item')).toHaveCount(2);

	// --- the agent is offered the server's model-visible tools --------------
	await mainWindow.bringToFront();
	await call('list_connected_tools');
	await expect(rows(mainWindow)).toContainText('diagrams__draw');
	await expect(rows(mainWindow)).toContainText('diagrams__plain');
	// The app-only tool is hidden from the agent.
	await expect(rows(mainWindow)).not.toContainText('diagrams__poll');
	await expect(item).toContainText('Connected · 4 tools');
	await expect(servers.locator('.connected-servers-item', { hasText: 'broken' })).toContainText('Not connected:');

	// --- a tool with a UI opens its app in this terminal --------------------
	await call('call_connected_tool', { name: 'diagrams__draw', arguments: { shape: 'circle' } });
	await expect(rows(mainWindow)).toContainText('"Draw a diagram" is open as an interactive view');
	const app = windowTitled(mainWindow, 'Draw a diagram');
	await expect(app).toHaveAttribute('data-placement', 'window');
	await expect(app.locator('.app-window__source')).toHaveText('diagrams · draw');
	// The view received the call's arguments and result, reached its own
	// server's app-only tool through Terminay, and was refused a model-only one.
	const out = view(app).locator('#out');
	await expect(out).toContainText('"modelOnly"');
	await expect(out).toContainText('"csp"');
	expect(JSON.parse((await out.textContent()) ?? '{}')).toEqual({
		input: { shape: 'circle' },
		result: { shapes: 1 },
		polled: { polled: true },
		modelOnly: 'refused',
		// The view's policy admits the origin its resource declared and nothing else.
		csp: { declared: 'allowed', undeclared: 'blocked' },
	});

	// A tool without a UI just returns its result and opens nothing.
	await call('call_connected_tool', { name: 'diagrams__plain', arguments: {} });
	await expect(rows(mainWindow)).toContainText('content=plain result');
	await expect(windows(mainWindow)).toHaveCount(1);

	// --- disabling the server withdraws its tools ---------------------------
	await item.getByRole('button', { name: 'Disable' }).click();
	await expect(item).toContainText('Disabled');
	await call('call_connected_tool', { name: 'diagrams__plain', arguments: {} });
	await expect(rows(mainWindow)).toContainText('RESULT call_connected_tool not_found');
});

// A published third-party MCP Apps server, fetched from the network. Opt-in,
// because CI has no business depending on the npm registry.
test('a published MCP Apps example server renders its view through the gateway', async ({
	mainWindow,
	appHarness,
	userDataDir,
}) => {
	test.skip(REAL_MCP_APP_PACKAGE === '', 'set TERMINAY_E2E_REAL_MCP_APP to a package name');
	test.setTimeout(300_000);
	const script = path.join(userDataDir, 'app-window-real.mjs');
	const params = path.join(userDataDir, 'app-window-real.json');
	await writeFile(script, MCP_SCRIPT);
	await writeFile(params, JSON.stringify({ name: 'example__get-time', arguments: {} }));

	const settings = await appHarness.openSettingsWindow({ page: mainWindow, sectionId: 'terminay-mcp' });
	const servers = settings.locator('.connected-servers');
	await servers.getByRole('button', { name: 'Add server' }).click();
	const form = servers.locator('.connected-servers-form');
	await form.getByPlaceholder('diagrams').fill('example');
	await form.getByPlaceholder('npx').fill('npx');
	await form.locator('textarea').fill(`-y\n${REAL_MCP_APP_PACKAGE}\n--stdio`);
	await form.getByRole('button', { name: 'Connect server' }).click();
	const item = servers.locator('.connected-servers-item', { hasText: 'example' });
	await expect(item).toBeVisible();

	await mainWindow.bringToFront();
	await submitTerminalCommand(
		mainWindow,
		`'${process.execPath}' '${script}' call_connected_tool '${params}'`,
		activeTerminalPanel(mainWindow),
	);
	await expect(rows(mainWindow)).toContainText('is open as an interactive view', { timeout: 240_000 });
	const app = mainWindow.locator('.app-window[data-placement="window"]');
	await expect(app).toBeVisible();
	// The server's own view, built with the official SDK, shows the time its
	// tool returned.
	await expect(view(app).locator('body')).toContainText(/20\d\d-\d\d-\d\dT/, { timeout: 30_000 });
	await expect(item).toContainText('Connected · 1 tool');
});
