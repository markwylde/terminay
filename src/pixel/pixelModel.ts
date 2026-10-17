import type { ChatAction, ChatMessage, ChatStatus } from '@markwylde/pet';
import type {
	AgentChatEntry,
	AgentChatProvider,
	AgentChatStatus,
	AgentChatView,
} from '@terminay/client-core';

/** Pixel as the server reports it. */
export type PixelServerState = Readonly<{
	enabled: boolean;
	provider: string;
	chatId?: string;
}>;

export const PIXEL_PROVIDER_UNSET = 'unset';

/** Approval buttons; their ids are the decisions the server accepts. */
export const PIXEL_APPROVAL_ACTIONS: readonly ChatAction[] = Object.freeze([
	{ id: 'once', label: 'Allow One Time', kind: 'primary' },
	{ id: 'session', label: 'Allow This Session' },
	{ id: 'decline', label: 'Decline', kind: 'danger' },
]);

const OUTCOMES: Readonly<Record<string, string>> = {
	'allowed-once': 'Allowed once',
	'allowed-session': 'Allowed for this session',
	declined: 'Declined',
	'allowed-by-policy': 'Allowed by your settings',
	'denied-by-policy': 'Refused by your settings',
	ended: 'No longer needed',
};

const ACTIVITY_MARK = { running: '…', completed: '✓', failed: '✗' } as const;

/** The balloon's messages for a chat as the server holds it. */
export function pixelMessages(chat: AgentChatView | undefined): ChatMessage[] {
	if (chat === undefined) return [];
	return chat.entries.flatMap((entry) => {
		const message = messageFor(entry);
		return message === undefined ? [] : [message];
	});
}

function messageFor(entry: AgentChatEntry): ChatMessage | undefined {
	const base = { id: entry.id, createdAt: entry.createdAt };
	switch (entry.kind) {
		case 'user':
			return { ...base, role: 'user', text: entry.text };
		case 'assistant': {
			const lines: string[] = [];
			let text = '';
			const flush = () => {
				if (text.trim().length > 0) lines.push(text.trim());
				text = '';
			};
			for (const part of entry.parts) {
				if (part.type === 'text') text += part.text;
				else {
					flush();
					lines.push(`${ACTIVITY_MARK[part.state]} ${part.text}`);
				}
			}
			flush();
			// A reply that has produced nothing yet stays as the typing dots.
			if (lines.length === 0) return undefined;
			return { ...base, role: 'assistant', text: lines.join('\n') };
		}
		case 'notice':
			return { ...base, role: 'assistant', text: entry.text };
		case 'approval': {
			const details = entry.details.map(
				(detail) => `${detail.label}: ${detail.value}`,
			);
			const outcome =
				entry.state === 'pending'
					? []
					: [`→ ${OUTCOMES[entry.state] ?? entry.state}`];
			return {
				...base,
				role: 'assistant',
				text: [entry.statement, ...details, ...outcome].join('\n'),
				...(entry.state === 'pending'
					? { actions: PIXEL_APPROVAL_ACTIONS.map((action) => ({ ...action })) }
					: {}),
			};
		}
	}
}

/** The balloon's status: the server's, except a turn that already shows text. */
export function pixelStatus(chat: AgentChatView | undefined): ChatStatus {
	const status: AgentChatStatus = chat?.status ?? 'idle';
	return status;
}

/** Whether Pixel is waiting on the user to approve something. */
export function pixelNeedsAttention(chat: AgentChatView | undefined): boolean {
	return (chat?.pendingApprovals ?? 0) > 0;
}

/** The onboarding chips: the agents this server can run. */
export function onboardingSuggestions(
	providers: readonly AgentChatProvider[],
): string[] {
	return providers
		.filter((provider) => provider.available)
		.map((provider) => provider.displayName);
}

/** The provider a chip names, matched the way the user would read it. */
export function providerForChoice(
	providers: readonly AgentChatProvider[],
	text: string,
): AgentChatProvider | undefined {
	const wanted = text.trim().toLowerCase();
	return providers.find(
		(provider) =>
			provider.available && provider.displayName.toLowerCase() === wanted,
	);
}

/** What the dock says about Pixel, for its label and tooltip. */
export function pixelDockLabel(
	state: 'idle' | 'working' | 'attention',
): string {
	switch (state) {
		case 'attention':
			return 'Pixel needs your answer. Open Pixel.';
		case 'working':
			return 'Pixel is working. Open Pixel.';
		default:
			return 'Open Pixel';
	}
}

const UNAVAILABLE: Readonly<Record<string, string>> = {
	not_installed: 'is not installed',
	not_signed_in: 'is not signed in',
	unsupported_platform: 'does not run here',
	disabled: 'is turned off in Extensions',
};

/** The first-click question, or why there is nothing to choose from. */
export function onboardingGreeting(
	providers: readonly AgentChatProvider[],
): string {
	if (providers.some((provider) => provider.available))
		return "Hi! I'm Pixel. Which agent should I use?";
	if (providers.length === 0)
		return "Hi! I'm Pixel. I'm still looking for agents on this server. Close me and try again in a moment.";
	const reasons = providers.map((provider) =>
		[
			`${provider.displayName} ${UNAVAILABLE[provider.reason ?? ''] ?? 'is unavailable'}.`,
			provider.detail,
		]
			.filter(Boolean)
			.join(' '),
	);
	return `Hi! I'm Pixel. I need Claude Code or Codex on this server. ${reasons.join(' ')}`;
}
