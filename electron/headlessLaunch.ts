import { execFileSync } from 'node:child_process';

export const HEADLESS_CHROMIUM_SWITCHES = [
	'headless',
	'disable-gpu',
	'use-mock-keychain',
] as const;

export function darwinHasAquaSession(
	probe: () => string = printManagerName,
): boolean {
	try {
		return probe().trim() === 'Aqua';
	} catch {
		return false;
	}
}

export function shouldUseHeadlessChromium(
	platform: NodeJS.Platform,
	aquaSessionAvailable: boolean,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (platform !== 'darwin') return false;
	if (env.TERMINAY_ELECTRON_HEADLESS === '1') return true;
	if (env.TERMINAY_ELECTRON_HEADLESS === '0') return false;
	return !aquaSessionAvailable;
}

export function applyHeadlessChromiumSwitches(app: {
	disableHardwareAcceleration(): void;
	commandLine: { appendSwitch(name: string): void };
}): void {
	app.disableHardwareAcceleration();
	for (const name of HEADLESS_CHROMIUM_SWITCHES) {
		app.commandLine.appendSwitch(name);
	}
}

export function headlessChromiumArgv(): string[] {
	return HEADLESS_CHROMIUM_SWITCHES.map((name) => `--${name}`);
}

function printManagerName(): string {
	return execFileSync('/bin/launchctl', ['managername'], {
		encoding: 'utf8',
		timeout: 2_000,
	});
}
