import type { SettingsClient } from '@terminay/client-core';
import { type JsonValue, TERMINAY_HOST_MENU_COMMANDS } from '@terminay/protocol';
import { createContext, createElement, type ReactNode, useContext, useEffect, useState } from 'react';
import { updateNativeMenuAccelerators } from '../host/nativeActions';
import {
	defaultTerminalSettings,
	normalizeTerminalSettings,
	selectDeviceTerminalSettings,
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
	let connectionHostSettings = readConnectionHostSettings();
	const effectiveSettings = (server: JsonValue) =>
		normalizeTerminalSettings(
			mergeSettings(
				mergeSettings(defaultTerminalSettings, serverSettings(server)),
				connectionHostSettings,
			),
		);
	return {
		async get<T>() {
			return effectiveSettings(await client.get<JsonValue>()) as T;
		},
		async update<T>(settings: JsonValue) {
			const current = serverSettings(await client.get<JsonValue>());
			const serverUpdate = selectServerSettings(settings, current);
			connectionHostSettings = selectConnectionHostSettings(settings);
			writeConnectionHostSettings(connectionHostSettings);
			await publishNativeAccelerators(settings);
			const state = serverSettings(await client.update<JsonValue>(serverUpdate));
			return normalizeTerminalSettings(
				mergeSettings(mergeSettings(defaultTerminalSettings, state), connectionHostSettings),
			) as T;
		},
		async reset<T>() {
			connectionHostSettings = {};
			writeConnectionHostSettings(connectionHostSettings);
			await publishNativeAccelerators(defaultTerminalSettings as unknown as JsonValue);
			const state = serverSettings(await client.reset<JsonValue>());
			return normalizeTerminalSettings(mergeSettings(defaultTerminalSettings, state)) as T;
		},
		onChanged: (listener) => client.onChanged((state) => {
			listener(effectiveSettings(state) as unknown as JsonValue);
		}),
	};
}

const CONNECTION_HOST_SETTINGS_KEY = 'terminay.connection-host-settings.v1';

function selectConnectionHostSettings(value: JsonValue): JsonValue {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new TypeError('Settings must be objects.');
	return selectDeviceTerminalSettings(
		normalizeTerminalSettings(value),
	) as JsonValue;
}

function readConnectionHostSettings(): JsonValue {
	if (typeof window === 'undefined') return {};
	try {
		const value = window.localStorage.getItem(CONNECTION_HOST_SETTINGS_KEY);
		if (value === null) return {};
		const parsed = JSON.parse(value) as unknown;
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
			? (parsed as JsonValue)
			: {};
	} catch {
		return {};
	}
}

function writeConnectionHostSettings(settings: JsonValue): void {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(
			CONNECTION_HOST_SETTINGS_KEY,
			JSON.stringify(settings),
		);
	} catch {
		// An unavailable host store must not prevent selected-server settings writes.
	}
}

async function publishNativeAccelerators(settings: JsonValue): Promise<void> {
	if (typeof window === 'undefined' || typeof settings !== 'object' || settings === null || Array.isArray(settings)) return;
	const shortcuts = settings.keyboardShortcuts;
	if (typeof shortcuts !== 'object' || shortcuts === null || Array.isArray(shortcuts)) return;
	await updateNativeMenuAccelerators(TERMINAY_HOST_MENU_COMMANDS.map((command) => ({
		command,
		accelerator: typeof shortcuts[command] === 'string' ? shortcuts[command] : '',
	})));
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
