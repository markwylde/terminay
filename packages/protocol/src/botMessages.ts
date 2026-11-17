export interface BotMessageAttachment {
	readonly id: string;
	readonly name: string;
	readonly mime: string;
	readonly size: number;
}
/** A staged user file; `token` is consumed by the post that references it. */
export interface BotMessageUpload {
	readonly token: string;
	readonly attachment: Omit<BotMessageAttachment, 'id'>;
}
/** The type of every attachment whose content is not a raster image. */
export const BOT_OPAQUE_ATTACHMENT_MIME = 'application/octet-stream';
export const BOT_MESSAGE_UPLOAD_LIMITS = Object.freeze({
	/** Raster images: they are also sent to the model as native input. */
	imageBytes: 2 * 1024 * 1024,
	/** Any other file, stored and delivered as opaque bytes. */
	fileBytes: 5 * 1024 * 1024,
	perMessage: 4,
	imageMimes: Object.freeze([
		'image/png',
		'image/jpeg',
		'image/gif',
		'image/webp',
	] as const),
});
/** Raster type from magic bytes, or the opaque type. Never trusts names. */
export function botAttachmentType(head: Uint8Array): string {
	const at = (i: number) => head[i] ?? -1;
	const ascii = (from: number, to: number) =>
		String.fromCharCode(...head.subarray(from, to));
	if (
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
			(b, i) => at(i) === b,
		)
	)
		return 'image/png';
	if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
	if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'image/gif';
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
	return BOT_OPAQUE_ATTACHMENT_MIME;
}
export function isBotImageMime(mime: string): boolean {
	return (BOT_MESSAGE_UPLOAD_LIMITS.imageMimes as readonly string[]).includes(
		mime,
	);
}
/** The size limit for content of this type. */
export function botAttachmentLimit(mime: string): number {
	return isBotImageMime(mime)
		? BOT_MESSAGE_UPLOAD_LIMITS.imageBytes
		: BOT_MESSAGE_UPLOAD_LIMITS.fileBytes;
}
export interface BotMessage {
	readonly id: string;
	readonly botId: string;
	readonly sequence: number;
	readonly revision: number;
	readonly author: 'user' | 'bot';
	readonly executionId: string | null;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly dispatch?: {
		readonly state: 'pending' | 'started' | 'failed';
		readonly executionId: string | null;
		readonly error?: string;
		/** Start attempt number; absent means the first attempt. */
		readonly attempt?: number;
		/** The user dismissed this start failure's warning. */
		readonly dismissed?: boolean;
	};
	readonly text: string;
	readonly attachments: readonly BotMessageAttachment[];
	/** The thread's root, for a reply; absent for a top-level message. */
	readonly threadId?: string;
	/** Derived for a root with replies; never stored. */
	readonly thread?: BotThreadSummary;
}
/** A root's replies, as derived when the root is read. */
export interface BotThreadSummary {
	readonly replyCount: number;
	readonly lastReplyAt: number;
	readonly lastReplySequence: number;
	/** The latest bot reply's sequence; null when only the user replied. */
	readonly lastBotReplySequence: number | null;
	/** Who has replied, most recent first, each once. */
	readonly authors: readonly ('user' | 'bot')[];
}
export interface BotMessageSummary
	extends Omit<BotMessage, 'text' | 'attachments'> {
	readonly excerpt: string;
	readonly textBytes: number;
	readonly attachmentCount: number;
}
export interface BotMessagePage {
	readonly items: readonly BotMessageSummary[];
	readonly nextCursor: string | null;
	readonly eventsCursor: string;
	readonly total: number;
	readonly truncated: boolean;
}
export interface BotMessageDetail {
	readonly message: Omit<BotMessage, 'text'>;
	readonly text: string;
	readonly nextCursor: string | null;
	readonly truncated: boolean;
}
export interface BotRuntimeEvent {
	readonly sequence: number;
	readonly type: string;
	readonly subjectId: string;
	readonly revision: number;
	readonly at: number;
}
export interface BotRuntimeEventPage {
	readonly items: readonly BotRuntimeEvent[];
	readonly nextCursor: string;
	readonly hasMore: boolean;
	readonly gap: boolean;
}
export const BOT_MESSAGE_OPERATIONS = Object.freeze({
	list: 'bots.messages.list',
	get: 'bots.messages.get',
	post: 'bots.messages.post',
	edit: 'bots.messages.edit',
	remove: 'bots.messages.remove',
	clear: 'bots.messages.clear',
	acknowledge: 'bots.messages.acknowledge',
	events: 'bots.messages.events',
	attachment: 'bots.messages.attachment',
	upload: 'bots.messages.upload',
	retry: 'bots.messages.retry',
	dismiss: 'bots.messages.dismiss',
});
