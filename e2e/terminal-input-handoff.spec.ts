import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures';
import {
	activeTerminalSessionId,
	terminalPanelForSession,
} from './support/terminal-session';

/*
 * A terminal replaces its attachment while it stays on screen: congestion
 * recovery, a refused resume, a rebind onto a replacement connection. The user
 * does not stop typing for it. These tests hold the handoff open with the
 * embedded server's E2E seam (electron/testTerminalHandoff.ts) instead of
 * racing it: the first key's write is held at the server, so every later key
 * is still queued in the panel when the server ends the stream as congested.
 */

type TestTerminalHandoff = {
	holdInput(sessionId: string): void;
	heldInputs(sessionId: string): number;
	releaseInput(sessionId: string): void;
	input(sessionId: string): string;
	streams(sessionId: string): number;
	congest(sessionId: string): number;
};

type WithTestTerminalHandoff = typeof globalThis & {
	__terminayTestTerminalHandoff: TestTerminalHandoff;
};

function server(electronApp: ElectronApplication) {
	const call = <K extends keyof TestTerminalHandoff>(
		method: K,
		sessionId: string,
	) =>
		electronApp.evaluate(
			(_electron, [name, id]) =>
				(globalThis as WithTestTerminalHandoff).__terminayTestTerminalHandoff[
					name as keyof TestTerminalHandoff
				](id as string),
			[method, sessionId] as const,
		) as Promise<ReturnType<TestTerminalHandoff[K]>>;
	return {
		holdInput: (sessionId: string) => call('holdInput', sessionId),
		heldInputs: (sessionId: string) => call('heldInputs', sessionId),
		releaseInput: (sessionId: string) => call('releaseInput', sessionId),
		input: (sessionId: string) => call('input', sessionId),
		streams: (sessionId: string) => call('streams', sessionId),
		congest: (sessionId: string) => call('congest', sessionId),
	};
}

test('keys typed while a terminal hands its attachment over all reach the shell, once and in order', async ({
	electronApp,
	mainWindow,
}) => {
	const handoff = server(electronApp);
	const sessionId = await activeTerminalSessionId(mainWindow);
	const panel = terminalPanelForSession(mainWindow, sessionId);
	const input = panel.locator('.xterm-helper-textarea');
	await expect(panel.locator('.terminal-panel-loading')).toHaveCount(0);
	await expect(panel.locator('.terminal-presentation-control')).toHaveCount(0);
	const streamsBefore = await handoff.streams(sessionId);
	expect(streamsBefore).toBeGreaterThan(0);
	await input.focus();
	await expect(input).toBeFocused();

	// The first key's write waits at the server; the rest queue behind it.
	await handoff.holdInput(sessionId);
	await input.pressSequentially('echo handed');
	await expect.poll(() => handoff.heldInputs(sessionId)).toBe(1);

	// The server ends the stream as congested, and the panel starts replacing
	// its attachment with those keys still queued. The user keeps typing.
	expect(await handoff.congest(sessionId)).toBeGreaterThan(0);
	await input.pressSequentially('-over');
	await expect
		.poll(() => handoff.streams(sessionId))
		.toBe(streamsBefore + 1);
	await input.pressSequentially('-ok');

	await handoff.releaseInput(sessionId);
	await input.press('Enter');

	// Every key, once each, in the order typed. Anything the emulator itself
	// answered before the test began may come first.
	await expect
		.poll(() => handoff.input(sessionId))
		.toMatch(/(?:^|\W)echo handed-over-ok\r$/u);
	await expect(panel.locator('.xterm-rows')).toContainText('handed-over-ok');
});
