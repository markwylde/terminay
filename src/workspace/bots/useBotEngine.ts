/**
 * The container engine and bot image of one server, as the dashboard shows
 * them. Read on demand and on `bots.engine.changed`; never polled.
 */

import { BotEngineClient } from '@terminay/client-core';
import type { BotEngineReason, BotEngineStatus } from '@terminay/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { refusalText, type ServerBots } from './useServerBots';

export type { BotEngineReason, BotEngineStatus };
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
	status: BotEngineStatus | undefined;
	error: string | undefined;
	busy: boolean;
	checkAgain: () => void;
	/** Pins a candidate. Replacing an existing pin needs `confirmed`. */
	useEngine: (candidate: BotEngineCandidate, confirmed: boolean) => void;
	buildImage: () => void;
}>;

export function useBotEngine(server: ServerBots | undefined): BotEngineView {
	const [status, setStatus] = useState<BotEngineStatus>();
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
		() => ({ client, running: false, again: false }),
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
					setStatus(await client.status());
					setError(undefined);
				} catch (cause) {
					setStatus(undefined);
					setError(refusalText(cause));
				}
			} while (state.again);
		} finally {
			state.running = false;
		}
	}, [client, reading]);

	useEffect(() => {
		if (client === undefined) return;
		void load();
		try {
			return client.watch(
				() => void load(),
				() => void load(),
			);
		} catch {
			return undefined;
		}
	}, [load, client]);

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

	return {
		status,
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
