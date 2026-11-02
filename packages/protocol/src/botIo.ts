export const BOT_IO_OPERATIONS = Object.freeze({
	filesOpen: 'bots.files.open',
	filesList: 'bots.files.list',
	filesStat: 'bots.files.stat',
	filesMkdir: 'bots.files.mkdir',
	filesRename: 'bots.files.rename',
	filesDelete: 'bots.files.delete',
	filesRead: 'bots.files.read',
	filesWrite: 'bots.files.write',
	filesWatch: 'bots.files.watch',
	desktopOpen: 'bots.desktop.open',
	shellOpen: 'bots.shell.open',
	shellResize: 'bots.shell.resize',
	read: 'bots.io.read',
	write: 'bots.io.write',
	finish: 'bots.io.finish',
	close: 'bots.io.close',
});
export interface BotFileEntry {
	readonly name: string;
	readonly kind: 'file' | 'dir' | 'link' | 'credential-link' | 'other';
	readonly size: number;
	readonly mtime: number;
}
export interface BotFileListing {
	readonly entries: readonly BotFileEntry[];
	readonly truncated: boolean;
}
export interface BotIoHandle {
	readonly streamId: string;
	readonly botId: string;
	readonly generation: number;
}
export const BOT_CREDENTIAL_OPERATIONS = Object.freeze({
	options: 'bots.credentials.options',
	save: 'bots.credentials.save',
	copy: 'bots.credentials.copy',
	remove: 'bots.credentials.remove',
	deviceSignOut: 'bots.credentials.device-sign-out',
});
