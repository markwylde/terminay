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
/**
 * What a recorded Terminay action created or addressed, by server ID. The
 * server resolves it; it never comes from the agent's own text.
 */
export type BotActionTarget =
	| { readonly kind: 'project'; readonly projectId: string }
	| {
			readonly kind: 'terminal' | 'workflow';
			readonly projectId: string;
			readonly sessionId: string;
	  }
	| { readonly kind: 'automation'; readonly automationId: string }
	| { readonly kind: 'workflowTemplate'; readonly templateId: string }
	| { readonly kind: 'trigger'; readonly triggerId: string }
	| { readonly kind: 'settings' };
export const BOT_ACTION_TARGET_KINDS = Object.freeze([
	'project',
	'terminal',
	'workflow',
	'automation',
	'workflowTemplate',
	'trigger',
	'settings',
] as const);
/** A server-recorded Terminay action of one execution (ADR-0134). */
export interface BotMessageActivity {
	/** The MCP or runtime trigger tool. */
	readonly tool: string;
	readonly outcome: 'done' | 'failed';
	/** Why a failed call failed, at most 200 bytes. */
	readonly reason?: string;
	readonly target?: BotActionTarget;
	/** Identical consecutive actions folded into this entry. */
	readonly count: number;
}
const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
/** A well-formed action target, or undefined. Every ID is opaque data. */
export function botActionTarget(value: unknown): BotActionTarget | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;
	const v = value as Record<string, unknown>;
	const ok = (field: unknown): field is string =>
		typeof field === 'string' && ACTION_ID.test(field);
	switch (v.kind) {
		case 'project':
			return ok(v.projectId)
				? { kind: 'project', projectId: v.projectId }
				: undefined;
		case 'terminal':
		case 'workflow':
			return ok(v.projectId) && ok(v.sessionId)
				? { kind: v.kind, projectId: v.projectId, sessionId: v.sessionId }
				: undefined;
		case 'automation':
			return ok(v.automationId)
				? { kind: 'automation', automationId: v.automationId }
				: undefined;
		case 'workflowTemplate':
			return ok(v.templateId)
				? { kind: 'workflowTemplate', templateId: v.templateId }
				: undefined;
		case 'trigger':
			return ok(v.triggerId)
				? { kind: 'trigger', triggerId: v.triggerId }
				: undefined;
		case 'settings':
			return { kind: 'settings' };
		default:
			return undefined;
	}
}
/** A well-formed activity, or undefined. */
export function botMessageActivity(
	value: unknown,
): BotMessageActivity | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;
	const v = value as Record<string, unknown>;
	if (
		typeof v.tool !== 'string' ||
		!/^[a-z][a-z0-9_]{0,63}$/.test(v.tool) ||
		(v.outcome !== 'done' && v.outcome !== 'failed') ||
		!Number.isSafeInteger(v.count) ||
		(v.count as number) < 1 ||
		(v.reason !== undefined &&
			(typeof v.reason !== 'string' || v.reason.length > 200))
	)
		return undefined;
	const target =
		v.target === undefined ? undefined : botActionTarget(v.target);
	if (v.target !== undefined && target === undefined) return undefined;
	return {
		tool: v.tool,
		outcome: v.outcome,
		...(typeof v.reason === 'string' ? { reason: v.reason } : {}),
		...(target ? { target } : {}),
		count: v.count as number,
	};
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
	/** Present on a recorded Terminay action, never on a post (ADR-0134). */
	readonly activity?: BotMessageActivity;
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
