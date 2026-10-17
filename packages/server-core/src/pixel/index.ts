import { type JsonValue, protocolError } from '@terminay/protocol';
import {
	AgentChatError,
	type AgentChatService,
	type AgentChatSummary,
	PIXEL_CHAT_KEY,
} from '../agentChat/service.js';
import { assertAutomationAuthority } from '../automationService/protocol.js';
import type {
	CommandRequest,
	OperationRegistries,
	QueryRequest,
	RequestContext,
} from '../types.js';

/**
 * Pixel: one server-wide agent chat with whole-server MCP reach, behind the
 * Enable Pixel switch. The server alone decides its provider and reach; a
 * client only asks for it.
 */

export const PIXEL_OPERATIONS = Object.freeze({
	state: 'pixel.state',
	open: 'pixel.open',
} as const);

export const PIXEL_EVENTS = Object.freeze({
	/** `{ enabled, provider }`: Pixel was switched or its agent changed. */
	changed: 'pixel.changed',
} as const);

export const PIXEL_PROVIDER_UNSET = 'unset';

/** What every Pixel session is told before the user's first message. */
export const PIXEL_INSTRUCTION = [
	"You are Pixel, Terminay's assistant: a small CRT terminal with a face, living in the status bar.",
	'You see and control the user’s terminals, tabs and automations only through the `terminay_chat` tools.',
	'Read a terminal before you type into it, and say what you are about to do before you change anything.',
	'You see the window the user is talking to you from: call get_layout to see which project, folder, and tabs are on screen and how the panes are arranged.',
	'split_terminal opens one new terminal per call; arrange_tabs makes grids, columns, and rows; move_tab and resize_pane adjust them.',
	'After changing anything, check the layout the tool returns. Never say you did something that a tool result does not show, and if a result says placed: false or fails, tell the user what did not happen.',
	'Keep replies short and friendly. Plain text, no headings.',
].join(' ');

export interface PixelSettings {
	readonly enabled: boolean;
	readonly provider: string;
}

export interface PixelState extends PixelSettings {
	/** The Pixel chat, while one exists. */
	readonly chatId?: string;
}

export interface PixelServiceOptions {
	readonly chats: AgentChatService;
	readonly settings: () => PixelSettings;
	readonly onChanged?: (state: PixelState) => void;
}

export class PixelError extends Error {
	constructor(
		readonly code: 'disabled' | 'provider_unset',
		message: string,
	) {
		super(message);
		this.name = 'PixelError';
	}
}

export class PixelService {
	private current: PixelSettings;

	constructor(private readonly options: PixelServiceOptions) {
		this.current = options.settings();
	}

	state(): PixelState {
		const chat = this.options.chats.findByKey(PIXEL_CHAT_KEY);
		return {
			...this.current,
			...(chat === undefined ? {} : { chatId: chat.id }),
		};
	}

	/** The Pixel chat, created on first use with the configured agent. */
	open(): AgentChatSummary {
		const { enabled, provider } = this.current;
		if (!enabled) throw new PixelError('disabled', 'Pixel is turned off.');
		if (provider === PIXEL_PROVIDER_UNSET)
			throw new PixelError(
				'provider_unset',
				'Choose an agent for Pixel first.',
			);
		return this.options.chats.open({
			key: PIXEL_CHAT_KEY,
			allowReservedKey: true,
			providerId: provider,
			title: 'Pixel',
			reach: { kind: 'workspace' },
			instruction: PIXEL_INSTRUCTION,
		});
	}

	/**
	 * Apply new settings. Turning Pixel off, or choosing another agent,
	 * closes the Pixel chat, which ends its agent, its capability, and its
	 * pending approvals.
	 */
	async apply(next: PixelSettings): Promise<void> {
		const previous = this.current;
		this.current = next;
		if (
			previous.enabled === next.enabled &&
			previous.provider === next.provider
		)
			return;
		if (!next.enabled || previous.provider !== next.provider)
			await this.options.chats.closeByKey(PIXEL_CHAT_KEY);
		this.options.onChanged?.(this.state());
	}

	operations(): OperationRegistries {
		const policy = { scope: 'write' } as const;
		return {
			queries: {
				[PIXEL_OPERATIONS.state]: (request: QueryRequest) => {
					authorize(request.context);
					return this.state() as unknown as JsonValue;
				},
			},
			commands: {
				[PIXEL_OPERATIONS.open]: (request: CommandRequest) => {
					authorize(request.context);
					try {
						// Wrapped: the summary's own `revision` would otherwise be
						// read as a result envelope.
						return { result: this.open() } as unknown as JsonValue;
					} catch (error) {
						if (error instanceof PixelError)
							throw protocolError('unavailable', error.message, {
								details: { reason: error.code },
							});
						if (error instanceof AgentChatError)
							throw protocolError('unavailable', error.message, {
								details: { reason: error.code },
							});
						throw error;
					}
				},
			},
			policies: {
				[PIXEL_OPERATIONS.state]: policy,
				[PIXEL_OPERATIONS.open]: policy,
			},
		};
	}
}

/** Read Pixel's settings from the server settings object. */
export function pixelSettingsFrom(settings: unknown): PixelSettings {
	const pixel =
		typeof settings === 'object' && settings !== null
			? (settings as { pixel?: unknown }).pixel
			: undefined;
	const value =
		typeof pixel === 'object' && pixel !== null
			? (pixel as Record<string, unknown>)
			: {};
	return {
		enabled: value.enabled === true,
		provider:
			typeof value.provider === 'string' && value.provider.length > 0
				? value.provider
				: PIXEL_PROVIDER_UNSET,
	};
}

function authorize(context: RequestContext): void {
	try {
		assertAutomationAuthority(context);
	} catch {
		throw protocolError(
			'forbidden',
			'Pixel requires authority to create terminals on this server',
		);
	}
}
