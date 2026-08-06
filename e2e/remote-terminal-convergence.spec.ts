import { createServer } from 'node:net';
import type { Page } from '@playwright/test';
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

test('Desktop and browser converge on terminal tabs and one shared PTY output stream', async ({
	mainWindow,
	page,
}) => {
	const pairingUrl = await exposeDesktopOnLan(mainWindow);

	try {
		await connectBrowser(page, pairingUrl);
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
		await expect(
			desktopPanel.getByText('Terminal read-only', { exact: true }),
		).toBeVisible();
		await expect(
			browserPanel.getByText('Terminal read-only', { exact: true }),
		).toBeVisible();
		await desktopPanel
			.getByRole('button', { name: 'Take control of terminal' })
			.click();
		await expect(
			desktopPanel.getByText('Terminal controller', { exact: true }),
		).toBeVisible();
		await expect(
			browserPanel.getByText('Terminal read-only', { exact: true }),
		).toBeVisible();

		const proof = '__TERMINAY_SHARED_PTY_OUTPUT__';
		const desktopInput = desktopPanel.locator('.xterm-helper-textarea');
		await desktopInput.focus();
		await mainWindow.keyboard.type(`printf '${proof}\\n'`);
		await mainWindow.keyboard.press('Enter');
		await expect(terminalPanel(mainWindow, desktopSessionId)).toContainText(
			proof,
		);
		await expect(terminalPanel(page, desktopSessionId)).toContainText(proof);

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
			.getByRole('button', { name: 'Take control of terminal' })
			.click();
		await expect(
			browserPanel.getByText('Terminal controller', { exact: true }),
		).toBeVisible();
		await expect(
			desktopPanel.getByText('Terminal read-only', { exact: true }),
		).toBeVisible();

		const takeoverProof = '__TERMINAY_BROWSER_TAKEOVER_INPUT__';
		await browserPanel.locator('.xterm-helper-textarea').focus();
		await page.keyboard.type(`printf '${takeoverProof}\\n'`);
		await page.keyboard.press('Enter');
		await expect(browserPanel).toContainText(takeoverProof);
		await expect(desktopPanel).toContainText(takeoverProof);

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
