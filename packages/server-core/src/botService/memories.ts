import { EventEmitter } from 'node:events';
import type { BotMemory, BotProfile } from '@terminay/protocol';
import { BotError, BotStore, memoryPath, text } from './store.js';

/** What every session is told about its machine. */
export const BOT_ENVIRONMENT_NOTE = `You run in your own Linux container as the user \`bot\` (home /home/bot).
You have a graphical desktop on DISPLAY=:1 that the user can watch live. To use a browser, start it on that desktop, for example \`chromium --no-first-run https://example.com &\`, then use \`xdotool\` and \`wmctrl\` to click, type and manage windows, and \`scrot /tmp/screen.png\` to take a screenshot you can look at.
Memories are Markdown notes in /home/bot/memories.
`;

/** Small seam for group 4.9's shared, confined helper. No host path access. */
export interface BotMemoryFiles {
	list(
		path: 'memories',
	): Promise<readonly { name: string; type: string; modifiedAt: number }[]>;
	readText(path: string, maxBytes: number): Promise<string>;
	writeText(path: string, contents: string): Promise<void>;
	remove(path: string): Promise<void>;
	watch(path: 'memories', changed: () => void): () => void;
	release(): void;
}
export interface BotMemoryHelper {
	acquire(botId: string): Promise<BotMemoryFiles>;
}
const truncate = (value: string, bytes: number) =>
	Buffer.from(value)
		.subarray(0, Math.max(0, bytes))
		.toString('utf8')
		.replace(/\uFFFD+$/, '');
export class BotMemories extends EventEmitter {
	constructor(
		private readonly helper: BotMemoryHelper,
		private readonly bots: BotStore,
	) {
		super();
	}
	private async use<T>(
		botId: string,
		fn: (files: BotMemoryFiles) => Promise<T>,
	): Promise<T> {
		this.bots.get(botId);
		const files = await this.helper.acquire(botId);
		try {
			return await fn(files);
		} finally {
			files.release();
		}
	}
	async list(botId: string, search = ''): Promise<BotMemory[]> {
		const bot = this.bots.get(botId);
		return this.use(botId, async (files) => {
			const entries = await files.list('memories');
			if (entries.length > 10000)
				throw new BotError('validation', 'too many memories');
			const memories: BotMemory[] = [];
			for (const entry of entries) {
				if (entry.type !== 'file' || !entry.name.endsWith('.md')) continue;
				let path: string;
				try {
					path = memoryPath(entry.name);
				} catch {
					continue;
				}
				const contents = await files.readText(`memories/${path}`, 1024 * 1024);
				const title =
					/^#\s+(.+)$/m.exec(contents)?.[1] ??
					path
						.slice(0, -3)
						.replace(/[-_]/g, ' ')
						.replace(/^./, (c) => c.toUpperCase());
				if (
					!search ||
					`${title}\n${contents}`
						.toLocaleLowerCase()
						.includes(search.toLocaleLowerCase())
				)
					memories.push({
						path,
						title: title.slice(0, 512),
						modifiedAt: entry.modifiedAt,
						pinned: bot.pinnedMemories.includes(path),
					});
			}
			return memories.sort(
				(a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path),
			);
		});
	}
	read(botId: string, path: string): Promise<string> {
		return this.use(botId, (f) =>
			f.readText(`memories/${memoryPath(path)}`, 1024 * 1024),
		);
	}
	async write(botId: string, path: string, contents: string): Promise<void> {
		text(contents, 1024 * 1024, 'memory', true);
		await this.use(botId, (f) =>
			f.writeText(`memories/${memoryPath(path)}`, contents),
		);
		this.emit('changed', { botId });
	}
	async remove(botId: string, path: string): Promise<void> {
		await this.use(botId, (f) => f.remove(`memories/${memoryPath(path)}`));
		this.pin(botId, path, false);
		this.emit('changed', { botId });
	}
	pin(botId: string, path: string, pinned: boolean): void {
		memoryPath(path);
		const bot = this.bots.get(botId);
		this.bots.save({
			...bot,
			pinnedMemories: [
				...bot.pinnedMemories.filter((p) => p !== path),
				...(pinned ? [path] : []),
			],
		});
	}
	async context(bot: BotProfile): Promise<string> {
		if (!bot.pinnedMemories.length)
			return `${bot.instructions}\n\n${BOT_ENVIRONMENT_NOTE}`;
		const listing = await this.list(bot.id);
		const pinned = listing.filter((m) => bot.pinnedMemories.includes(m.path));
		let block = '';
		// This limit is for pinned memories; instructions retain their own 32 KiB bound.
		for (const memory of pinned) {
			const remaining = 16 * 1024 - Buffer.byteLength(block);
			if (remaining <= 0) break;
			const heading = `\n## ${memory.path}\n`;
			const contents = await this.read(bot.id, memory.path);
			block += truncate(`${heading + contents}\n`, remaining);
		}
		return `${bot.instructions}\n\n${BOT_ENVIRONMENT_NOTE}${block}`;
	}
	async watch(botId: string, listener: () => void): Promise<() => void> {
		this.bots.get(botId);
		const files = await this.helper.acquire(botId);
		let closed = false;
		const unwatch = files.watch('memories', () => {
			if (!closed) {
				this.emit('changed', { botId });
				listener();
			}
		});
		return () => {
			if (closed) return;
			closed = true;
			unwatch();
			files.release();
		};
	}
}
