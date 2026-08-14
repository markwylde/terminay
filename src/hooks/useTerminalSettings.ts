import type { SettingsClient } from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
} from '../terminalSettings';
import type { TerminalSettings } from '../types/settings';

export interface TerminalSettingsClient {
	get<T = JsonValue>(): Promise<T>;
	update<T = JsonValue>(settings: JsonValue): Promise<T>;
	reset<T = JsonValue>(): Promise<T>;
	onChanged(listener: (settings: JsonValue) => void): () => void;
}

const TerminalSettingsClientContext = createContext<TerminalSettingsClient | undefined>(undefined);

export function TerminalSettingsClientProvider({
	children,
	client,
}: Readonly<{ children: ReactNode; client: TerminalSettingsClient }>) {
	return createElement(TerminalSettingsClientContext.Provider, { value: client }, children);
}

export function useTerminalSettingsClient(): TerminalSettingsClient {
	const client = useContext(TerminalSettingsClientContext);
	if (client === undefined) {
		throw new Error('Terminal settings client is unavailable');
	}
	return client;
}

export function createServerTerminalSettingsClient(
	client: SettingsClient,
): TerminalSettingsClient {
	return {
		async get<T>() {
			return normalizeTerminalSettings(
				mergeSettings(defaultTerminalSettings, serverSettings(await client.get<JsonValue>())),
			) as T;
		},
		async update<T>(settings: JsonValue) {
			const current = serverSettings(await client.get<JsonValue>());
			const serverUpdate = selectServerSettings(settings, current);
			const state = serverSettings(await client.update<JsonValue>(serverUpdate));
			return normalizeTerminalSettings(mergeSettings(defaultTerminalSettings, state)) as T;
		},
		async reset<T>() {
			const state = serverSettings(await client.reset<JsonValue>());
			return normalizeTerminalSettings(mergeSettings(defaultTerminalSettings, state)) as T;
		},
		onChanged: (listener) => client.onChanged((state) => {
			listener(normalizeTerminalSettings(
				mergeSettings(defaultTerminalSettings, serverSettings(state)),
			) as unknown as JsonValue);
		}),
	};
}

function selectServerSettings(value: JsonValue, shape: JsonValue): JsonValue {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof shape !== 'object' ||
		shape === null ||
		Array.isArray(shape)
	)
		throw new TypeError('Settings must be objects.');
	return Object.fromEntries(
		Object.entries(shape).flatMap(([key, childShape]) => {
			const child = value[key];
			if (child === undefined) return [];
			if (
				typeof childShape === 'object' &&
				childShape !== null &&
				!Array.isArray(childShape) &&
				typeof child === 'object' &&
				child !== null &&
				!Array.isArray(child)
			)
				return [[key, selectServerSettings(child, childShape)]];
			return [[key, child]];
		}),
	) as JsonValue;
}

function serverSettings(value: JsonValue): JsonValue {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof value.settings !== 'object' ||
		value.settings === null ||
		Array.isArray(value.settings)
	)
		throw new TypeError('The server returned an invalid settings state.');
	return value.settings;
}

function mergeSettings(
	device: TerminalSettings,
	server: JsonValue,
): TerminalSettings {
	if (typeof server !== 'object' || server === null || Array.isArray(server)) {
		throw new TypeError('The server returned invalid settings.');
	}
	const merge = (base: unknown, patch: unknown): unknown => {
		if (
			typeof base !== 'object' ||
			base === null ||
			Array.isArray(base) ||
			typeof patch !== 'object' ||
			patch === null ||
			Array.isArray(patch)
		)
			return patch;
		const result = { ...(base as Record<string, unknown>) };
		for (const [key, value] of Object.entries(patch)) {
			result[key] = merge(result[key], value);
		}
		return result;
	};
	return normalizeTerminalSettings(merge(device, server));
}

export function useTerminalSettings(override?: TerminalSettingsClient) {
	const injectedClient = useContext(TerminalSettingsClientContext);
	const settingsClient = override ?? injectedClient;
	if (settingsClient === undefined) {
		throw new Error('Terminal settings client is unavailable');
	}
	const [settings, setSettings] = useState<TerminalSettings>(
		defaultTerminalSettings,
	);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		let isMounted = true;

		void settingsClient.get<TerminalSettings>().then((nextSettings) => {
			if (!isMounted) {
				return;
			}

			setSettings(nextSettings);
			setError(null);
			setIsLoading(false);
		}).catch((cause: unknown) => {
			if (!isMounted) return;
			setError(cause instanceof Error ? cause : new Error(String(cause)));
			setIsLoading(false);
		});

		const unsubscribe = settingsClient.onChanged((nextSettings) => {
			setSettings(nextSettings as unknown as TerminalSettings);
			setError(null);
			setIsLoading(false);
		});

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, [settingsClient]);

	return { settings, error, isLoading, setSettings, settingsClient };
}
