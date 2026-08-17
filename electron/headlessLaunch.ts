import { execFileSync } from 'node:child_process';

export function darwinHasAquaSession(
	uid = typeof process.getuid === 'function' ? process.getuid() : undefined,
	probe: (uid: number) => void = printGuiDomain,
): boolean {
	if (uid === undefined || !Number.isInteger(uid) || uid < 0) return false;
	try {
		probe(uid);
		return true;
	} catch {
		return false;
	}
}

export function shouldUseHeadlessChromium(
	platform: NodeJS.Platform,
	aquaSessionAvailable: boolean,
): boolean {
	return platform === 'darwin' && !aquaSessionAvailable;
}

export function applyHeadlessChromiumSwitches(app: {
	disableHardwareAcceleration(): void;
	commandLine: { appendSwitch(name: string): void };
}): void {
	app.disableHardwareAcceleration();
	app.commandLine.appendSwitch('headless');
	app.commandLine.appendSwitch('disable-gpu');
}

function printGuiDomain(uid: number): void {
	execFileSync('/bin/launchctl', ['print', `gui/${uid}`], {
		stdio: 'ignore',
		timeout: 2_000,
	});
}
