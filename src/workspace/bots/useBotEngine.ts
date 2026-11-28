/**
 * The container engine and bot image of one server, as the dashboard shows
 * them. Read on demand and on `bots.engine.changed`; never polled.
 */

import { BotEngineClient } from '@terminay/client-core';
import type {
	BotBuildProgress,
	BotEngineReason,
	BotEngineStatus,
} from '@terminay/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { refusalText, type ServerBots } from './useServerBots';

export type { BotBuildProgress, BotEngineReason, BotEngineStatus };
export type BotEngineCandidate = BotEngineStatus['candidates'][number];

/** What each refusal means, in the user's words. */
export const ENGINE_REASON_TEXT: Readonly<Record<BotEngineReason, string>> = {
	'not-installed':
		'No container engine was found. Install Docker or Podman, then check again.',
	'not-running':
		'The container engine is installed but not running. Start it, then check again.',
	'permission-denied':
		'Terminay is not allowed to use the container engine. Give this account access to it, then check again.',
	'remote-engine':
		'The engine is on another machine. Bots need an engine on this machine.',
	'unsupported-engine-mode':
		'This engine mode is not supported. Rootless Docker is not supported: use rootful Docker or Podman.',
	'unsupported-platform': 'Bots are not supported on this platform.',
	'engine-changed':
		'The engine connection changed or its identity marker is missing. Choose Use this engine and confirm to recover.',
};

export type BotEngineView = Readonly<{
	serverId: string | undefined;
	status: BotEngineStatus | undefined;
	error: string | undefined;
	busy: boolean;
	checkAgain: () => void;
	/** Pins a candidate. Replacing an existing pin needs `confirmed`. */
	useEngine: (candidate: BotEngineCandidate, confirmed: boolean) => void;
	buildImage: () => void;
	/** Dismisses the ready notice of a build's image, for every client. */
	acknowledgeImage: (buildId: string) => Promise<void>;
	readBuildLog: () => Promise<string>;
	readBuildProgress: () => Promise<BotBuildProgress | null>;
}>;

export function useBotEngine(server: ServerBots | undefined): BotEngineView {
	const [loaded, setLoaded] = useState<{
		client: BotEngineClient;
		status: BotEngineStatus;
	}>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const transport = server?.transport;
	const client = useMemo(
		() =>
			transport === undefined
				? undefined
				: new BotEngineClient(transport as never),
		[transport],
	);

	// One read at a time. Changes that arrive during a read ask for one more
	// read after it, however many there were, so a burst of events can never
	// queue a burst of requests.
	// Kept per client, so a new connection never waits on the old one's read.
	const reading = useMemo(
		() => ({ client, running: false, again: false, active: false }),
		[client],
	);
	const load = useCallback(async () => {
		if (client === undefined) return;
		const state = reading;
		if (state.running) {
			state.again = true;
			return;
		}
		state.running = true;
		try {
			do {
				state.again = false;
				try {
					const status = await client.status();
					if (state.active) {
						setLoaded({ client, status });
						setError(undefined);
					}
				} catch (cause) {
					if (state.active) {
						setLoaded(undefined);
						setError(refusalText(cause));
					}
				}
			} while (state.active && state.again);
		} finally {
			state.running = false;
		}
	}, [client, reading]);

	useEffect(() => {
		if (client === undefined) return;
		reading.active = true;
		void load();
		let unwatch: (() => void) | undefined;
		try {
			unwatch = client.watch(
				() => void load(),
				() => void load(),
			);
		} catch {
			/* A later connection can restore the watch. */
		}
		return () => {
			reading.active = false;
			unwatch?.();
		};
	}, [load, client, reading]);

	const run = useCallback(
		(action: (c: BotEngineClient) => Promise<void>) => {
			if (client === undefined) return;
			setBusy(true);
			setError(undefined);
			action(client)
				.then(() => load())
				.catch((cause: unknown) => setError(refusalText(cause)))
				.finally(() => setBusy(false));
		},
		[load, client],
	);

	const readBuildLog = useCallback(
		() =>
			client ? client.log() : Promise.reject(new Error('Server unavailable')),
		[client],
	);
	const readBuildProgress = useCallback(
		() =>
			client
				? client.progress()
				: Promise.reject(new Error('Server unavailable')),
		[client],
	);

	// Not through `run`: a dismissal never marks the engine busy or failed.
	const acknowledgeImage = useCallback(
		(buildId: string) =>
			client
				? client.acknowledgeImage(buildId)
				: Promise.reject(new Error('Server unavailable')),
		[client],
	);

	return {
		serverId: server?.serverId,
		status: loaded?.client === client ? loaded?.status : undefined,
		acknowledgeImage,
		readBuildLog,
		readBuildProgress,
		error,
		busy,
		checkAgain: () => run((c) => c.check()),
		useEngine: (candidate, confirmed) => {
			if (candidate.address === null) return;
			const address = candidate.address;
			run((c) => c.use(candidate.kind, address, confirmed));
		},
		buildImage: () => run((c) => c.build()),
	};
}
