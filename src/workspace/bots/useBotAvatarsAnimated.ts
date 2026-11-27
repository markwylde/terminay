/**
 * Whether Critter bot avatars animate, from the `animateBotAvatars` setting.
 *
 * Many avatars are on screen at once, so they share one subscription per
 * settings client instead of each fetching settings.
 */

import { useCallback, useSyncExternalStore } from 'react';
import {
	type TerminalSettingsClient,
	useOptionalTerminalSettingsClient,
} from '../../hooks/useTerminalSettings';
import { defaultTerminalSettings } from '../../terminalSettings';

type Store = {
	value: boolean;
	listeners: Set<() => void>;
	stop?: () => void;
};

const stores = new WeakMap<TerminalSettingsClient, Store>();

function readSetting(settings: unknown): boolean {
	const value = (settings as { animateBotAvatars?: unknown } | null)
		?.animateBotAvatars;
	return typeof value === 'boolean'
		? value
		: defaultTerminalSettings.animateBotAvatars;
}

function storeFor(client: TerminalSettingsClient): Store {
	let store = stores.get(client);
	if (store === undefined) {
		store = {
			value: defaultTerminalSettings.animateBotAvatars,
			listeners: new Set(),
		};
		stores.set(client, store);
	}
	return store;
}

function publish(store: Store, value: boolean): void {
	if (store.value === value) return;
	store.value = value;
	for (const listener of store.listeners) listener();
}

function subscribe(client: TerminalSettingsClient, listener: () => void) {
	const store = storeFor(client);
	store.listeners.add(listener);
	if (store.stop === undefined) {
		let live = true;
		const unsubscribe = client.onChanged((settings) =>
			publish(store, readSetting(settings)),
		);
		store.stop = () => {
			live = false;
			unsubscribe();
		};
		void client
			.get()
			.then((settings) => {
				if (live) publish(store, readSetting(settings));
			})
			.catch(() => undefined);
	}
	return () => {
		store.listeners.delete(listener);
		if (store.listeners.size === 0) {
			store.stop?.();
			store.stop = undefined;
		}
	};
}

export function useBotAvatarsAnimated(): boolean {
	const client = useOptionalTerminalSettingsClient();
	const subscribeToClient = useCallback(
		(listener: () => void) =>
			client === undefined ? () => undefined : subscribe(client, listener),
		[client],
	);
	return useSyncExternalStore(subscribeToClient, () =>
		client === undefined
			? defaultTerminalSettings.animateBotAvatars
			: storeFor(client).value,
	);
}
