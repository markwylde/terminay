import {
	type ChatOptions,
	createPet,
	type PetInstance,
	Pixel as PixelCharacter,
} from '@markwylde/pet';
import { PetIcon } from '@markwylde/pet/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './pixel.css';
import {
	onboardingGreeting,
	onboardingSuggestions,
	PIXEL_PROVIDER_UNSET,
	pixelDockLabel,
	pixelMessages,
	pixelNeedsAttention,
	pixelStatus,
	providerForChoice,
} from './pixelModel';
import type { PixelServer } from './usePixelServer';

type PixelProps = Readonly<{
	serverId: string;
	server: PixelServer;
	/** The status bar's dock slot, or null while the status bar is hidden. */
	statusBarDock: HTMLElement | null;
}>;

/** Leaving Pixel out and idle with the balloon closed sends it home. */
const AUTO_HIDE_MS = 20_000;

/** The balloon's handlers read the latest server state through a ref. */
function chatHandlers(serverRef: { readonly current: PixelServer }) {
	return {
		onSend: (text: string) => {
			const live = serverRef.current;
			if (live.state?.provider === PIXEL_PROVIDER_UNSET) {
				// Onboarding: the chips name the agents; choosing one is a setting,
				// not a message.
				const provider = providerForChoice(live.providers, text);
				if (provider !== undefined) live.chooseProvider(provider.id);
				return;
			}
			live.send(text);
		},
		onStop: () => serverRef.current.stop(),
		onClear: () => serverRef.current.clear(),
	};
}

/**
 * Pixel: a dock in the status bar (or the corner when the bar is hidden) and
 * the animated pet that flies out of it with its chat balloon. Rendered only
 * while Pixel is on; unmounting removes the pet from the page.
 */
export function PixelCompanion({
	serverId,
	server,
	statusBarDock,
}: PixelProps) {
	const [pet, setPet] = useState<PetInstance | null>(null);
	const [fallbackDock, setFallbackDock] = useState<HTMLButtonElement | null>(
		null,
	);
	const [dockButton, setDockButton] = useState<HTMLButtonElement | null>(null);
	const serverRef = useRef(server);
	serverRef.current = server;
	const dockRef = useRef<HTMLElement | null>(null);
	dockRef.current = dockButton ?? fallbackDock;

	const { chat, state, providers, problem } = server;
	const onboarding = state?.provider === PIXEL_PROVIDER_UNSET;
	const attention = pixelNeedsAttention(chat);
	const working = chat !== undefined && chat.status !== 'idle';
	const dockState = attention ? 'attention' : working ? 'working' : 'idle';

	// One pet per window, for as long as Pixel is on.
	useEffect(() => {
		const instance = createPet({
			character: PixelCharacter,
			size: 0.6,
			hidden: true,
			dock: () => dockRef.current,
			autoHide: AUTO_HIDE_MS,
			label: 'Pixel',
			// Position and balloon size are this device's; the conversation
			// is the server's and is never kept here.
			persist: `terminay.pixel.${serverId}`,
			chat: chatHandlers(serverRef),
		});
		const offClose = instance.on('chat:close', () => {
			void instance.hide();
		});
		const offOpen = instance.on('chat:open', () => {
			serverRef.current.refreshProviders();
		});
		const offAction = instance.on('chat:action', ({ message, action }) => {
			const entry = serverRef.current.chat?.entries.find(
				(candidate) => candidate.id === message.id,
			);
			if (
				entry?.kind === 'approval' &&
				(action.id === 'once' ||
					action.id === 'session' ||
					action.id === 'decline')
			)
				serverRef.current.decide(entry.approvalId, action.id);
		});
		setPet(instance);
		return () => {
			offClose();
			offOpen();
			offAction();
			instance.destroy();
			setPet(null);
		};
	}, [serverId]);

	// What the balloon says before there is a conversation.
	const chatOptions = useMemo((): Partial<ChatOptions> => {
		if (onboarding) {
			const suggestions = onboardingSuggestions(providers);
			return {
				title: 'Pixel',
				greeting: onboardingGreeting(providers),
				suggestions,
				placeholder: 'Pick an agent below…',
			};
		}
		return {
			title: 'Pixel',
			...(chat === undefined ? {} : { subtitle: chat.providerName }),
			greeting:
				"Hi! I'm Pixel. Ask me what's going on in your terminals, or what to do in them.",
			suggestions: ["What's running right now?", 'Did anything fail?'],
			placeholder: 'Ask Pixel…',
		};
	}, [chat, onboarding, providers]);

	useEffect(() => {
		if (pet === null) return;
		pet.set({
			chat: {
				...chatHandlers(serverRef),
				...chatOptions,
			},
		});
	}, [chatOptions, pet]);

	// Stay clear of the status bar while it is shown.
	useEffect(() => {
		pet?.set({ insets: { bottom: statusBarDock === null ? 0 : 26 } });
	}, [pet, statusBarDock]);

	// The server's conversation, shown as it is.
	useEffect(() => {
		if (pet === null) return;
		const messages = pixelMessages(chat);
		if (problem !== undefined)
			messages.push({
				id: 'pixel-problem',
				role: 'assistant',
				text: problem,
				createdAt: Date.now(),
			});
		pet.chat.setMessages(messages);
		pet.chat.setStatus(pixelStatus(chat));
	}, [chat, pet, problem]);

	// Pixel comes out to ask when an approval arrives while it is docked.
	const askedRef = useRef(false);
	useEffect(() => {
		if (pet === null) return;
		if (!attention) {
			askedRef.current = false;
			return;
		}
		if (askedRef.current || document.visibilityState !== 'visible') return;
		askedRef.current = true;
		void pet.show().then(() => pet.chat.open());
	}, [attention, pet]);

	const openPixel = () => {
		if (pet === null) return;
		if (pet.chat.isOpen) {
			pet.chat.close();
			return;
		}
		void pet.show().then(() => pet.chat.open());
	};

	const label = pixelDockLabel(dockState);
	const dock = (
		ref: (element: HTMLButtonElement | null) => void,
		className: string,
	) => (
		<button
			aria-label={label}
			className={className}
			data-state={dockState}
			data-testid="pixel-dock"
			onClick={openPixel}
			onMouseDown={(event) => event.stopPropagation()}
			ref={ref}
			title={label}
			type="button"
		>
			<PetIcon character={PixelCharacter} className="pixel-dock__icon" />
			{dockState === 'idle' ? null : (
				<span aria-hidden="true" className="pixel-dock__badge" />
			)}
		</button>
	);

	return statusBarDock === null
		? dock(setFallbackDock, 'pixel-dock pixel-dock--corner')
		: createPortal(
				dock(setDockButton, 'pixel-dock pixel-dock--status-bar'),
				statusBarDock,
			);
}
