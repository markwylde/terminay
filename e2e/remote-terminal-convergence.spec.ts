import { createServer } from 'node:net';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { sendAppCommand } from './support/app';

// The Docker image may download Electron on its first launch. Keep that
// one-time fixture setup inside the scenario's budget instead of relying on a
// retry to warm the container cache.
test.describe.configure({ timeout: 180_000 });

async function reserveLoopbackPort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	if (address === null || typeof address === 'string') {
		throw new Error('Unable to reserve a loopback port.');
	}
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
	return address.port;
}

async function exposeDesktopOnLan(mainWindow: Page): Promise<string> {
	const port = await reserveLoopbackPort();
	return mainWindow.evaluate(async (selectedPort) => {
		const settings =
			await window.terminayTerminalSettingsCompatibilityHost.getTerminalSettings();
		await window.terminayTerminalSettingsCompatibilityHost.updateTerminalSettings(
			{
				...settings,
				remoteAccess: {
					...settings.remoteAccess,
					bindAddress: '127.0.0.1',
					origin: `http://localhost:${selectedPort}`,
					pairingMode: 'lan',
				},
			},
		);
		await window.terminayRemotePairingPinHost.setRemoteAccessPairingPin(
			'123456',
		);
		const status = await window.terminayRemoteAccessStatusHost.toggleServer();
		if (!status.lanPairingUrl) {
			throw new Error('Direct exposure did not publish a pairing URL.');
		}
		return status.lanPairingUrl;
	}, port);
}

async function connectBrowser(page: Page, pairingUrl: string): Promise<void> {
	await page.setViewportSize({ width: 640, height: 900 });
	await page.goto(pairingUrl);
	await expect(
		page.getByRole('dialog', { name: 'Enroll browser device' }),
	).toBeVisible();
	await page.getByLabel('Device name').fill('Terminal convergence browser');
	await page.getByLabel('Pairing PIN').fill('123456');
	await page.getByRole('button', { name: 'Pair and connect' }).click();
	await expect(page.locator('.connected-web-renderer-workspace')).toBeVisible({
		timeout: 20_000,
	});
}

async function readTerminalColumns(page: Page, panel: Locator, marker: string): Promise<number> {
	const input = panel.locator('.xterm-helper-textarea');
	await input.focus();
	await page.keyboard.type(`printf '${marker}%s__\\n' "$(tput cols)"`);
	await page.keyboard.press('Enter');
	const outputPattern = new RegExp(`${marker}(\\d+)__`, 'gu');
	let text = '';
	await expect.poll(async () => {
		text = await panel.locator('.xterm-rows').innerText();
		outputPattern.lastIndex = 0;
		return outputPattern.test(text);
	}).toBe(true);
	outputPattern.lastIndex = 0;
	const matches = [...text.matchAll(outputPattern)];
	const value = Number(matches.at(-1)?.[1]);
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Unable to read terminal columns for ${marker}`);
	return value;
}

async function expectMatchingLogicalGrid(first: Locator, second: Locator): Promise<void> {
	const [firstWidth, secondWidth] = await Promise.all([
		first.locator('.xterm-screen').evaluate((element) => (element as HTMLElement).offsetWidth),
		second.locator('.xterm-screen').evaluate((element) => (element as HTMLElement).offsetWidth),
	]);
	expect(Math.abs(firstWidth - secondWidth)).toBeLessThanOrEqual(2);
}

async function stopExposure(mainWindow: Page): Promise<void> {
	await mainWindow.evaluate(async () => {
		const status = await window.terminayRemoteAccessStatusHost.getStatus();
		if (status.isRunning) {
			await window.terminayRemoteAccessStatusHost.toggleServer();
		}
	});
}

function terminalTabs(page: Page) {
	return page.locator('.terminal-tab-content');
}

function terminalPanel(page: Page, sessionId: string) {
	return page.locator(
		`.terminal-panel[data-terminay-terminal-session-id="${sessionId}"]`,
	);
}

async function expectControlBarLayout(panel: Locator): Promise<void> {
	const geometry = await panel.evaluate((element) => {
		const bar = element.querySelector<HTMLElement>('.terminal-presentation-control');
		const root = element.querySelector<HTMLElement>('.terminal-panel-root');
		const viewport = element.querySelector<HTMLElement>('.xterm-viewport');
		if (bar === null || root === null || viewport === null) throw new Error('Terminal control layout is incomplete');
		const panelRect = element.getBoundingClientRect();
		const barRect = bar.getBoundingClientRect();
		const rootRect = root.getBoundingClientRect();
		const backgroundColor = getComputedStyle(bar).backgroundColor;
		const alphaMatch = backgroundColor.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/u);
		return {
			barLeft: barRect.left,
			barRight: barRect.right,
			panelLeft: panelRect.left,
			panelRight: panelRect.right,
			barBottom: barRect.bottom,
			rootTop: rootRect.top,
			backgroundColor,
			backgroundAlpha: alphaMatch === null ? 1 : Number(alphaMatch[1]),
			terminalBackgroundColor: getComputedStyle(viewport).backgroundColor,
		};
	});
	expect(Math.abs(geometry.barLeft - geometry.panelLeft)).toBeLessThanOrEqual(1);
	expect(Math.abs(geometry.barRight - geometry.panelRight)).toBeLessThanOrEqual(1);
	expect(geometry.rootTop).toBeGreaterThanOrEqual(geometry.barBottom);
	expect(geometry.backgroundAlpha).toBe(1);
	expect(geometry.backgroundColor).not.toBe(geometry.terminalBackgroundColor);
}

test('Desktop and browser converge on terminal tabs and one shared PTY output stream', async ({
	mainWindow,
	page,
}) => {
	const pairingUrl = await exposeDesktopOnLan(mainWindow);

	try {
		await connectBrowser(page, pairingUrl);
		await page.evaluate(() => {
			const state = window as Window & { __terminayConnectModalFlashed?: boolean };
			state.__terminayConnectModalFlashed = false;
			const observe = () => {
				const dialog = document.querySelector('[role="dialog"][aria-labelledby="connect-server-heading"]');
				if (dialog !== null) state.__terminayConnectModalFlashed = true;
			};
			new MutationObserver(observe).observe(document.body, { childList: true, subtree: true });
			observe();
		});
		await expect(terminalTabs(mainWindow)).toHaveCount(1);
		await expect(terminalTabs(page)).toHaveCount(1);

		await sendAppCommand(mainWindow, 'new-terminal');
		await expect(terminalTabs(mainWindow)).toHaveCount(2);
		await expect(terminalTabs(page)).toHaveCount(2);

		const desktopSessionId = await mainWindow
			.locator('.terminal-panel:visible')
			.getAttribute('data-terminay-terminal-session-id');
		if (!desktopSessionId) {
			throw new Error('Desktop active terminal has no server session id.');
		}
		await expect(terminalPanel(page, desktopSessionId)).toHaveCount(1);
		const desktopPanel = terminalPanel(mainWindow, desktopSessionId);
		const browserPanel = terminalPanel(page, desktopSessionId);
		await expect(desktopPanel.locator('.terminal-presentation-control')).toHaveCount(0);
		const desktopGeometry = await desktopPanel.evaluate((panel) => ({
			panelWidth: panel.getBoundingClientRect().width,
			screenWidth: panel.querySelector('.xterm-screen')?.getBoundingClientRect().width ?? 0,
		}));
		expect(desktopGeometry.screenWidth).toBeGreaterThan(desktopGeometry.panelWidth * 0.9);
		const desktopColumnsBeforeTakeover = await readTerminalColumns(
			mainWindow,
			desktopPanel,
			'__TD0__',
		);
		await expect(
			browserPanel.getByText('Another device is controlling this terminal.', { exact: true }),
		).toBeVisible();
		await expectControlBarLayout(browserPanel);

		const proof = '__TERMINAY_SHARED_PTY_OUTPUT__';
		const desktopInput = desktopPanel.locator('.xterm-helper-textarea');
		await desktopInput.focus();
		const environmentProof = '__TERMINAY_ENV__xterm-256color|truecolor';
		await mainWindow.keyboard.type(
			`printf '__TERMINAY_ENV__%s|%s\\n' "$TERM" "$COLORTERM"`,
		);
		await mainWindow.keyboard.press('Enter');
		await expect(desktopPanel).toContainText(environmentProof);
		await expect(browserPanel).toContainText(environmentProof);
		await mainWindow.keyboard.type(`printf '${proof}\\n'`);
		await mainWindow.keyboard.press('Enter');
		await expect(terminalPanel(mainWindow, desktopSessionId)).toContainText(
			proof,
		);
		await expect(terminalPanel(page, desktopSessionId)).toContainText(proof);
		await sendAppCommand(mainWindow, 'clear-terminal');
		await page.waitForTimeout(6_000);
		await expect(browserPanel.getByText('unknown terminal event type')).toHaveCount(0);
		await expect(browserPanel.locator('.terminal-panel-connection-error')).toHaveCount(0);
		await expect(
			browserPanel.getByText('Another device is controlling this terminal.', { exact: true }),
		).toBeVisible();
		const postRenewalProof = '__TERMINAY_INPUT_AFTER_PRESENTATION_RENEWAL__';
		await desktopInput.focus();
		await mainWindow.keyboard.type(`printf '${postRenewalProof}\\n'`);
		await mainWindow.keyboard.press('Enter');
		await expect(desktopPanel).toContainText(postRenewalProof);
		await expect(browserPanel).toContainText(postRenewalProof);

		// Run the query inside the PTY and count replies at the byte source. A
		// second attached renderer must not send another automatic OSC response.
		const queryReplyProof = '__TERMINAY_OSC_REPLY_COUNT__1';
		const colorQuery =
			`node -e 'let b="";process.stdin.setRawMode(true);` +
			`process.stdin.on("data",d=>b+=d);` +
			`process.stdout.write("\\x1b]10;?\\x07");` +
			`setTimeout(()=>{process.stdin.setRawMode(false);` +
			`console.log("__TERMINAY_OSC_REPLY_COUNT__"+(b.match(/rgb:/g)||[]).length);` +
			`process.exit()},500)'`;
		await desktopInput.focus();
		await mainWindow.keyboard.type(colorQuery);
		await mainWindow.keyboard.press('Enter');
		await expect(terminalPanel(mainWindow, desktopSessionId)).toContainText(
			queryReplyProof,
		);
		await expect(terminalPanel(page, desktopSessionId)).toContainText(
			queryReplyProof,
		);

		const rejectedInput = '__TERMINAY_READ_ONLY_INPUT_REJECTED__';
		await browserPanel.locator('.xterm-helper-textarea').focus();
		await page.keyboard.type(rejectedInput);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(500);
		await expect(desktopPanel).not.toContainText(rejectedInput);

		await browserPanel
			.getByRole('button', { name: 'Take back control of terminal' })
			.click();
		await expect(browserPanel.locator('.terminal-presentation-control')).toHaveCount(0);
		await expect(browserPanel).not.toHaveClass(/terminal-panel--remote-size-override/u);
		await expect(desktopPanel).toHaveClass(/terminal-panel--remote-size-override/u);
		await expect(
			desktopPanel.getByText('Another device is controlling this terminal.', { exact: true }),
		).toBeVisible();
		await expectControlBarLayout(desktopPanel);
		const browserColumns = await readTerminalColumns(page, browserPanel, '__TB1__');
		expect(browserColumns).toBeLessThan(desktopColumnsBeforeTakeover);
		await expectMatchingLogicalGrid(browserPanel, desktopPanel);

		const takeoverProof = '__TERMINAY_BROWSER_TAKEOVER_INPUT__';
		await browserPanel.locator('.xterm-helper-textarea').focus();
		await page.keyboard.type(`printf '${takeoverProof}\\n'`);
		await page.keyboard.press('Enter');
		await expect(browserPanel).toContainText(takeoverProof);
		await expect(desktopPanel).toContainText(takeoverProof);

		await desktopPanel
			.getByRole('button', { name: 'Take back control of terminal' })
			.click();
		await expect(desktopPanel.locator('.terminal-presentation-control')).toHaveCount(0);
		await expect(desktopPanel).not.toHaveClass(/terminal-panel--remote-size-override/u);
		await expect(browserPanel).toHaveClass(/terminal-panel--remote-size-override/u);
		const desktopColumnsAfterTakeback = await readTerminalColumns(
			mainWindow,
			desktopPanel,
			'__TD2__',
		);
		expect(desktopColumnsAfterTakeback).toBeGreaterThan(browserColumns);
		await expectMatchingLogicalGrid(desktopPanel, browserPanel);

		const remoteConnections = await mainWindow.evaluate(() =>
			window.terminayTest.listRemoteProtocolConnections(),
		);
		expect(remoteConnections).toHaveLength(1);
		const failedConnectionId = remoteConnections[0];
		const resumeProof = '__TERMINAY_RESUMED_WITHOUT_DUPLICATION__';
		const encodedResumeProof = Buffer.from(`${resumeProof}\n`, 'utf8').toString(
			'base64',
		);
		await mainWindow.evaluate(
			async ({ connectionId, encoded, sessionId }) => {
				await window.terminayTest.failRemoteProtocolConnection(connectionId);
				await window.terminayTest.writeServerTerminal(
					sessionId,
					`printf '%s' '${encoded}' | base64 -d\n`,
				);
			},
			{
				connectionId: failedConnectionId,
				encoded: encodedResumeProof,
				sessionId: desktopSessionId,
			},
		);
		await expect(mainWindow.locator('.project-tabbar')).toBeVisible();
		await expect(desktopPanel).toContainText(resumeProof);
		await expect
			.poll(() =>
				mainWindow.evaluate(() =>
					window.terminayTest.listRemoteProtocolConnections(),
				),
			)
			.toEqual([expect.not.stringMatching(failedConnectionId)]);
		await expect(terminalPanel(page, desktopSessionId)).toContainText(
			resumeProof,
			{
				timeout: 30_000,
			},
		);
		const resumedText = await terminalPanel(page, desktopSessionId)
			.locator('.xterm-rows')
			.innerText();
		expect(resumedText.split(resumeProof)).toHaveLength(2);
		expect(
			await page.evaluate(
				() => (window as Window & { __terminayConnectModalFlashed?: boolean }).__terminayConnectModalFlashed,
			),
		).toBe(false);

		await page.getByLabel('New terminal tab').last().click();
		await expect(terminalTabs(page)).toHaveCount(3);
		await expect(terminalTabs(mainWindow)).toHaveCount(3);

		const browserSessionId = await page
			.locator('.terminal-panel:visible')
			.getAttribute('data-terminay-terminal-session-id');
		if (!browserSessionId) {
			throw new Error('Browser-created terminal has no server session id.');
		}
		await expect(terminalPanel(mainWindow, browserSessionId)).toHaveCount(1);

		await page
			.locator('.terminal-tab-content--active')
			.getByLabel('Close terminal')
			.click();
		await expect(terminalTabs(page)).toHaveCount(2);
		await expect(terminalTabs(mainWindow)).toHaveCount(2);
		await expect(terminalPanel(page, browserSessionId)).toHaveCount(0);
		await expect(terminalPanel(mainWindow, browserSessionId)).toHaveCount(0);
	} finally {
		await stopExposure(mainWindow);
	}
});
