export interface BotMessageAttachment {
	readonly id: string;
	readonly name: string;
	readonly mime: string;
	readonly size: number;
}
/** A staged user image; `token` is consumed by the post that references it. */
export interface BotMessageUpload {
	readonly token: string;
	readonly attachment: Omit<BotMessageAttachment, 'id'>;
}
export const BOT_MESSAGE_UPLOAD_LIMITS = Object.freeze({
	bytes: 2 * 1024 * 1024,
	perMessage: 4,
	mimes: Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
});
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
