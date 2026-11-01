/**
 * Requests to bring a mode or a session forward in a bot's tab.
 *
 * Opening a bot from a card or a Needs you entry may ask its tab to show Chat,
 * Configure, or one session. The tab may not exist yet when the request is
 * made, so the latest request per bot waits here until the tab takes it.
 */

import type { BotTabTarget } from './botTabHost';

type Listener = (target: BotTabTarget) => void;

const pending = new Map<string, BotTabTarget>();
const listeners = new Map<string, Set<Listener>>();

const key = (serverId: string, botId: string) => `${serverId}\u0000${botId}`;

export function requestBotFocus(target: BotTabTarget): void {
	const k = key(target.serverId, target.botId);
	const subscribed = listeners.get(k);
	if (subscribed !== undefined && subscribed.size > 0) {
		for (const listener of subscribed) listener(target);
		return;
	}
	pending.set(k, target);
}

/** Receive focus requests for one bot; a waiting request is delivered now. */
export function subscribeBotFocus(
	serverId: string,
	botId: string,
	listener: Listener,
): () => void {
	const k = key(serverId, botId);
	let set = listeners.get(k);
	if (set === undefined) {
		set = new Set();
		listeners.set(k, set);
	}
	set.add(listener);
	const waiting = pending.get(k);
	if (waiting !== undefined) {
		pending.delete(k);
		listener(waiting);
	}
	return () => {
		set.delete(listener);
		if (set.size === 0) listeners.delete(k);
	};
}

/** The sidebar's + asks the Bots section to open its New bot dialog. The
 * section may mount after the request, so one request waits for it. */
let newBotPending = false;
const newBotListeners = new Set<() => void>();

export function requestNewBot(): void {
	if (newBotListeners.size === 0) {
		newBotPending = true;
		return;
	}
	for (const listener of newBotListeners) listener();
}

export function subscribeNewBot(listener: () => void): () => void {
	newBotListeners.add(listener);
	if (newBotPending) {
		newBotPending = false;
		listener();
	}
	return () => {
		newBotListeners.delete(listener);
	};
}
