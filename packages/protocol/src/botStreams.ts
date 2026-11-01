/** Every stream is bound by the server to the authenticated connection. */
export type BotDesktopMode = 'view-only' | 'control';
export interface BotStreamBinding {
	readonly connectionId: string;
	readonly clientId: string;
	readonly botId: string;
	readonly generation: number;
	readonly mode: BotDesktopMode;
	readonly slot: 'desktop' | 'thumbnail' | 'shell';
}
export const BOT_STREAM_INPUT_BYTES = 4 * 1024 * 1024;
export const BOT_DESKTOP_CLIPBOARD_BYTES = 1024 * 1024;
export function botStreamGeneration(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		throw new TypeError('invalid bot stream generation');
	return value as number;
}
