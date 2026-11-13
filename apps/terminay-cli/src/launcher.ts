import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

import type { InstallLayout } from './layout.js';

/**
 * The `terminay` command an install leaves on the machine.
 *
 * After install, every later command — `qr-code`, `doctor`, `upgrade` — should
 * work as `terminay …` or `sudo terminay …`, with no `npx` and no dependence on
 * which Node.js, if any, is on the caller's `PATH`. The launcher hands off to
 * the CLI shipped inside the active release, which runs on that release's own
 * runtime.
 *
 * It carries a marker line, so the installer only ever replaces or removes a
 * file it wrote itself.
 */

export const LAUNCHER_MARKER = '# Written by `terminay daemon install`.';

/** `/usr/local/bin/terminay` for system scope, `~/.local/bin/terminay` for user. */
export function launcherPath(layout: InstallLayout): string {
	// The prefix is `<root>/opt/terminay` or `~/.local/share/terminay`.
	const base = dirname(dirname(layout.prefix));
	return layout.scope === 'system'
		? join(base, 'usr', 'local', 'bin', 'terminay')
		: join(base, 'bin', 'terminay');
}

export function renderLauncher(layout: InstallLayout): string {
	return `#!/bin/sh\n${LAUNCHER_MARKER}\nexec ${join(layout.currentLink, 'bin', 'terminay')} "$@"\n`;
}

async function ours(path: string): Promise<boolean | undefined> {
	try {
		return (await readFile(path, 'utf8')).includes(LAUNCHER_MARKER);
	} catch {
		return undefined;
	}
}

export async function installLauncher(options: {
	readonly layout: InstallLayout;
	readonly write: (line: string) => void;
	readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<boolean> {
	const path = launcherPath(options.layout);
	if ((await ours(path)) === false) {
		options.write(
			`Left ${path} alone: it was not written by this installer, so the \`terminay\` command there is not this server's.`,
		);
		return false;
	}
	await mkdir(dirname(path), { recursive: true, mode: 0o755 });
	await writeFile(path, renderLauncher(options.layout), { mode: 0o755 });
	// Set outright: a root umask of 077 would leave it runnable by root only.
	await chmod(path, 0o755);
	if (options.layout.scope === 'user') {
		const onPath = (options.env?.PATH ?? process.env.PATH ?? '')
			.split(delimiter)
			.includes(dirname(path));
		if (!onPath)
			options.write(
				`${dirname(path)} is not on your PATH, so add it to run \`terminay\` by name.`,
			);
	}
	return true;
}

export async function removeLauncher(layout: InstallLayout): Promise<void> {
	const path = launcherPath(layout);
	if ((await ours(path)) === true) await rm(path, { force: true });
}
