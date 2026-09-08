import { existsSync } from 'node:fs';

/**
 * The `daemon` commands drive systemd and install a Linux server archive, so
 * they refuse anywhere that combination cannot exist. The refusal names the
 * requirement rather than the failure, because an operator on macOS needs to
 * know the CLI is for the box they are deploying to, not the one they typed on.
 */

export const SYSTEMD_MARKER = '/run/systemd/system';

const SUPPORTED_ARCHITECTURES: readonly string[] = ['x64', 'arm64'];

export interface HostFacts {
	readonly platform: string;
	readonly arch: string;
	readonly hasSystemd: boolean;
}

export function readHostFacts(): HostFacts {
	return Object.freeze({
		platform: process.platform,
		arch: process.arch,
		hasSystemd: existsSync(SYSTEMD_MARKER),
	});
}

export class UnsupportedHostError extends Error {}

export function assertSupportedHost(facts: HostFacts = readHostFacts()): void {
	if (facts.platform !== 'linux') {
		throw new UnsupportedHostError(
			`terminay daemon runs on 64-bit Linux with systemd; this host is ${facts.platform}. Run it on the server you are deploying to.`,
		);
	}
	if (!SUPPORTED_ARCHITECTURES.includes(facts.arch)) {
		throw new UnsupportedHostError(
			`terminay daemon supports the x64 and arm64 architectures; this host is ${facts.arch}.`,
		);
	}
	if (!facts.hasSystemd) {
		throw new UnsupportedHostError(
			`terminay daemon requires systemd as the service manager; ${SYSTEMD_MARKER} is absent on this host.`,
		);
	}
}

export function hostArchitecture(
	facts: HostFacts = readHostFacts(),
): 'x64' | 'arm64' {
	assertSupportedHost(facts);
	return facts.arch as 'x64' | 'arm64';
}
