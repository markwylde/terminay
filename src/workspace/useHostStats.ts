/**
 * Host stats for the active tab's server, kept current while they are shown.
 *
 * The server samples its host only while some connection watches, so this
 * hook watches only while it is asked to (the preference is on and the status
 * bar is shown) and the document is visible, and unwatches as soon as either
 * stops. Samples are kept per server: switching servers starts a new history,
 * so one server's figures are never drawn into another's graph.
 */

import {
	HOST_STATS_CAPABILITY,
	HOST_STATS_EVENTS,
	HOST_STATS_OPERATIONS,
	type HostStatsSample,
	parseHostStatsSample,
} from '@terminay/protocol';
import { type TerminayClient, TerminayClientFacade } from '@terminay/client-core';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { appendHostStatsSample } from './hostStatsModel.ts';

export type HostStatsServerEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type HostStats = Readonly<{
	/** Whether the active server can describe its host at all. */
	supported: boolean;
	/** Oldest first; empty until the first sample arrives. */
	history: readonly HostStatsSample[];
}>;

function subscribeVisibility(listener: () => void): () => void {
	document.addEventListener('visibilitychange', listener);
	return () => document.removeEventListener('visibilitychange', listener);
}

const documentVisible = () => document.visibilityState === 'visible';

export function useHostStats(
	entry: HostStatsServerEntry | undefined,
	options: Readonly<{ shown: boolean; intervalSeconds: number }>,
): HostStats {
	const applicationClient = entry?.applicationClient;
	const serverId = entry?.serverId;
	const supported =
		entry?.capabilities?.includes(HOST_STATS_CAPABILITY) === true &&
		applicationClient !== undefined;
	const facade = useMemo(
		() =>
			supported && applicationClient !== undefined
				? new TerminayClientFacade(applicationClient)
				: undefined,
		[applicationClient, supported],
	);
	const visible = useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
	const watching = options.shown && visible && facade !== undefined;
	const [samples, setSamples] = useState<{
		serverId: string | undefined;
		history: readonly HostStatsSample[];
	}>({ serverId: undefined, history: [] });

	useEffect(() => {
		// A different server, or none, starts a fresh history.
		setSamples((current) =>
			current.serverId === serverId ? current : { serverId, history: [] },
		);
	}, [serverId]);

	useEffect(() => {
		if (!watching || facade === undefined) return;
		let disposed = false;
		let stopEvents: (() => void) | undefined;
		const watchedServer = serverId;
		// Subscribe before watching so the first sample cannot be missed.
		void facade
			.subscribeEvents(HOST_STATS_EVENTS.sample, (payload) => {
				const sample = parseHostStatsSample(payload);
				if (disposed || sample === null) return;
				setSamples((current) => ({
					serverId: watchedServer,
					history: appendHostStatsSample(
						current.serverId === watchedServer ? current.history : [],
						sample,
					),
				}));
			})
			.then((stop) => {
				if (disposed) {
					stop();
					return;
				}
				stopEvents = stop;
				return facade.command(HOST_STATS_OPERATIONS.watch, {
					intervalSeconds: options.intervalSeconds,
				});
			})
			.catch(() => {
				// A server that cannot be watched shows placeholders; the next
				// change of server, setting or visibility tries again.
			});
		return () => {
			disposed = true;
			stopEvents?.();
			void facade.command(HOST_STATS_OPERATIONS.unwatch, {}).catch(() => undefined);
		};
	}, [facade, options.intervalSeconds, serverId, watching]);

	return {
		supported,
		history: samples.serverId === serverId ? samples.history : [],
	};
}
