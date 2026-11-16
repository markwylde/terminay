/** One device clipboard, one owning document. No clipboard text is persisted. */
import type { TerminayHostClipboardSnapshot as ClipboardSyncSnapshot } from '@terminay/protocol';
export type { TerminayHostClipboardSnapshot as ClipboardSyncSnapshot } from '@terminay/protocol';
export interface ClipboardSyncSource {
	read(): Promise<string | undefined>;
	write(text: string): Promise<void>;
	schedule(callback: () => void, ms: number): () => void;
}
const bytes = new TextEncoder();
const canonical = (text: string) => text.replace(/\r\n|\r/g, '\n');
const fits = (text: string) =>
	text.length < 1024 * 1024 &&
	bytes.encode(text.replace(/\r\n|\r|\n/g, '\r\n')).length + 1 <= 1024 * 1024;
function hasDisallowedControl(text: string): boolean {
	for (const character of text) {
		const code = character.charCodeAt(0);
		if (
			(code < 32 && code !== 9 && code !== 10 && code !== 13) ||
			(code >= 127 && code <= 159)
		)
			return true;
	}
	return false;
}
type Sharing = {
	owner: object;
	token: string;
	revision: number;
	text?: string;
	tooLarge?: boolean;
	initialized: boolean;
	changed: (snapshot: ClipboardSyncSnapshot) => void;
	cancel?: () => void;
};
export class DesktopClipboardSync {
	private sharing?: Sharing;
	private queue: Promise<unknown> = Promise.resolve();
	private source: ClipboardSyncSource;
	constructor(source: ClipboardSyncSource) {
		this.source = source;
	}
	private serial<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.catch(() => undefined);
		return result;
	}
	private snapshot(s: Sharing): ClipboardSyncSnapshot {
		if (this.sharing !== s)
			return { token: s.token, revision: s.revision, active: false };
		return {
			token: s.token,
			revision: s.revision,
			active: true,
			...(s.text === undefined ? {} : { text: s.text }),
			...(s.tooLarge ? { tooLarge: true } : {}),
		};
	}
	private current(owner: object, token: string): Sharing {
		const s = this.sharing;
		if (!s || s.owner !== owner || s.token !== token)
			throw new Error('Clipboard sharing session has ended.');
		return s;
	}
	stop(owner: object, token?: string): void {
		const s = this.sharing;
		if (!s || s.owner !== owner || (token !== undefined && s.token !== token))
			return;
		this.sharing = undefined;
		s.cancel?.();
		s.changed(this.snapshot(s));
	}
	async start(
		owner: object,
		token: string,
		changed: Sharing['changed'],
	): Promise<ClipboardSyncSnapshot> {
		if (!/^[a-zA-Z0-9_-]{16,128}$/.test(token))
			throw new Error('Invalid clipboard session.');
		if (this.sharing) this.stop(this.sharing.owner);
		const s: Sharing = {
			owner,
			token,
			revision: 0,
			initialized: false,
			changed,
		};
		this.sharing = s;
		return this.serial(async () => {
			try {
				await this.read(s);
			} catch {
				if (this.sharing === s) this.stop(owner, token);
				throw new Error('Clipboard sharing could not start.');
			}
			this.schedule(s);
			return this.snapshot(s);
		});
	}
	private async read(s: Sharing): Promise<void> {
		if (this.sharing !== s) return;
		const raw = await this.source.read();
		if (this.sharing !== s) return;
		const tooLarge = raw !== undefined && !fits(raw);
		const text = raw && !tooLarge ? canonical(raw) : undefined;
		if (s.initialized && text === s.text && tooLarge === Boolean(s.tooLarge))
			return;
		s.initialized = true;
		s.text = text;
		s.tooLarge = tooLarge;
		s.revision++;
		s.changed(this.snapshot(s));
	}
	private schedule(s: Sharing): void {
		if (this.sharing !== s) return;
		// ADR-0028: Mark approved this 500 ms, active-session-only monitor on
		// 2026-11-16 in openspec/changes/archive/2026-11-16-bot-desktop-clipboard-sync/design.md.
		// Electron's main clipboard API has no background change notification.
		s.cancel = this.source.schedule(() => {
			s.cancel = undefined;
			void this.serial(() => this.read(s))
				.catch(() => undefined)
				.finally(() => this.schedule(s));
		}, 500);
	}
	write(
		owner: object,
		token: string,
		revision: number,
		raw: string,
	): Promise<ClipboardSyncSnapshot> {
		const s = this.current(owner, token);
		if (
			!Number.isSafeInteger(revision) ||
			revision < 0 ||
			typeof raw !== 'string' ||
			!raw ||
			raw.length > 1024 * 1024 ||
			bytes.encode(raw).length > 1024 * 1024 ||
			hasDisallowedControl(raw)
		)
			throw new Error('Invalid clipboard update.');
		return this.serial(async () => {
			this.current(owner, token);
			if (!s.initialized || revision !== s.revision) return this.snapshot(s);
			const text = canonical(raw);
			if (text === s.text) return this.snapshot(s);
			await this.source.write(text);
			if (this.sharing !== s) return this.snapshot(s);
			s.text = text;
			s.tooLarge = false;
			s.revision++;
			// No echo event: this caller already has the bot's text. The next read
			// compares against this value and emits only an actual host change.
			return this.snapshot(s);
		});
	}
}
