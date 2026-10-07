import { randomBytes } from 'node:crypto';

/**
 * Which window a remote connection belongs to.
 *
 * A server holds one live connection per client window of a device, so each
 * native window presents its own id when it authenticates. The id is random,
 * carries no authority, and is kept for as long as the window lives: a reload
 * or a reconnect of that window presents the same one and replaces only its
 * own previous connection.
 */
export class DesktopWindowIds {
	private readonly byWebContents = new Map<number, string>();

	/** A fresh id for a window that does not exist yet. */
	mint(): string {
		return `w${randomBytes(16).toString('base64url')}`;
	}

	/** The id of an existing window, minted on first use. */
	for(webContentsId: number): string {
		let id = this.byWebContents.get(webContentsId);
		if (id === undefined) {
			id = this.mint();
			this.byWebContents.set(webContentsId, id);
		}
		return id;
	}

	/** Bind an id minted before the window was created to that window. */
	adopt(webContentsId: number, id: string): void {
		this.byWebContents.set(webContentsId, id);
	}

	release(webContentsId: number): void {
		this.byWebContents.delete(webContentsId);
	}
}

/**
 * Open one connection at a time to a given server.
 *
 * A server cannot tell two handshakes of one device apart, and a newer join
 * retires an unfinished one. Two windows of this application connecting to
 * the same server together would cancel each other, so their attempts run in
 * turn. Attempts to different servers do not wait on each other, and a failed
 * attempt does not hold up the next.
 */
export function createProfileConnectQueue(): Readonly<{
	run<T>(profileId: string, task: () => Promise<T>): Promise<T>;
}> {
	const tails = new Map<string, Promise<unknown>>();
	return Object.freeze({
		run<T>(profileId: string, task: () => Promise<T>): Promise<T> {
			const previous = tails.get(profileId) ?? Promise.resolve();
			const next = previous.then(task, task);
			const settled = next.then(
				() => undefined,
				() => undefined,
			);
			tails.set(profileId, settled);
			void settled.then(() => {
				if (tails.get(profileId) === settled) tails.delete(profileId);
			});
			return next;
		},
	});
}
