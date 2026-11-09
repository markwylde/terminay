import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FOLDER_LAUNCHES = 64;
export const MAX_FOLDER_PATH_LENGTH = 4096;
// Electron/Chromium switches that occur before the application's operands.
const RUNTIME_SWITCH =
	/^(?:--(?:no-sandbox|headless|use-mock-keychain|disable-gpu|disable-dev-shm-usage|enable-logging|inspect(?:-brk)?|remote-debugging-port|original-process-start-time|allow-file-access-from-files)(?:=.*)?|-psn_\d+_\d+)$/u;

export function folderLaunchOperands(
	argv: readonly string[],
	packaged: boolean,
): string[] {
	return argv.slice(packaged ? 1 : 2);
}

export function parseFolderLaunch(
	args: readonly string[],
	cwd: string,
): string[] {
	const folders: string[] = [];
	let literal = false;
	for (let i = 0; i < args.length; i += 1) {
		let operand = args[i]!;
		if (!literal && operand === '--') {
			literal = true;
			continue;
		}
		if (!literal && RUNTIME_SWITCH.test(operand)) continue;
		if (!literal && operand === '--working-directory') {
			operand = args[++i] ?? '';
			if (operand.startsWith('--'))
				throw new Error('--working-directory requires a folder path.');
		} else if (!literal && operand.startsWith('--working-directory=')) {
			operand = operand.slice('--working-directory='.length);
		} else if (!literal && operand.startsWith('-')) {
			throw new Error(
				`Unsupported Terminay argument: ${operand.slice(0, 100)}. Use -- before literal folder names beginning with a dash.`,
			);
		}
		if (
			!operand ||
			operand.length > MAX_FOLDER_PATH_LENGTH ||
			operand.includes('\0')
		) {
			throw new Error(
				'Folder paths must contain between 1 and 4096 characters and no NUL bytes.',
			);
		}
		if (!path.isAbsolute(operand) && /^[a-z][a-z\d+.-]*:/iu.test(operand)) {
			const url = new URL(operand);
			if (
				url.protocol !== 'file:' ||
				(url.hostname && url.hostname !== 'localhost') ||
				url.search ||
				url.hash
			) {
				throw new Error(
					'Only local file URLs without a query or fragment can open folders.',
				);
			}
			operand = fileURLToPath(url);
		}
		folders.push(path.resolve(cwd, operand));
		if (folders.length > MAX_FOLDER_LAUNCHES)
			throw new Error('Too many folder launch requests (maximum 64).');
	}
	return folders;
}

/** No process arguments are replayed on an internal restart. Electron's source
 * entry point is retained for development launches only. */
export function folderLaunchRelaunchArgs(
	argv: readonly string[],
	packaged: boolean,
): string[] {
	return packaged ? [] : argv.slice(1, 2);
}

export function forwardedFolderLaunch(
	data: unknown,
): { args: string[]; cwd: string } | undefined {
	if (typeof data !== 'object' || data === null) return undefined;
	const value = data as Record<string, unknown>;
	if (
		value.kind !== 'terminay-folder-launch' ||
		typeof value.cwd !== 'string' ||
		!path.isAbsolute(value.cwd) ||
		!Array.isArray(value.args) ||
		value.args.length > 256 ||
		!value.args.every(
			(arg) => typeof arg === 'string' && arg.length <= MAX_FOLDER_PATH_LENGTH,
		)
	)
		return undefined;
	return { args: value.args as string[], cwd: value.cwd };
}

/** Accepted requests survive individual failures. No renderer or protocol API
 * is given this queue; its only callers are main-process OS/argv adapters. */
export class FolderLaunchQueue {
	private readonly pending: string[] = [];
	private handler: ((folder: string) => Promise<void>) | undefined;
	private draining = false;
	private failed = false;
	constructor(private readonly report: (error: unknown) => void) {}
	submit(folders: readonly string[]): void {
		if (this.failed) {
			this.report(
				new Error('Terminay could not start; folder launch was not accepted.'),
			);
			return;
		}
		if (
			this.pending.length + Number(this.draining) + folders.length >
			MAX_FOLDER_LAUNCHES
		) {
			this.report(
				new Error(
					'Terminay has too many pending folder requests. Try again after startup.',
				),
			);
			return;
		}
		this.pending.push(...folders);
		void this.drain();
	}
	ready(handler: (folder: string) => Promise<void>): void {
		this.handler = handler;
		void this.drain();
	}
	fail(error: unknown): void {
		this.failed = true;
		if (this.pending.length) this.report(error);
		this.pending.length = 0;
	}
	private async drain(): Promise<void> {
		if (!this.handler || this.draining || this.failed) return;
		this.draining = true;
		try {
			while (this.pending.length && !this.failed) {
				const folder = this.pending.shift()!;
				try {
					await this.handler(folder);
				} catch (error) {
					this.report(error);
				}
			}
		} finally {
			this.draining = false;
		}
	}
}
