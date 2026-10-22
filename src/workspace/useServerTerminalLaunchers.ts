/**
 * The terminal launchers each attached server offers, kept current
 * (ADR-0073). A server that does not offer them is asked nothing and lists
 * none, so its New terminal rows show only the shell.
 */

import {
	followTerminalLaunchers,
	serverOffersTerminalLaunchers,
	type TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { useEffect, useMemo, useState } from 'react';
import type { TerminalLauncherView } from '../types/terminalLaunchers';

export type TerminalLauncherServerEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

const NONE: readonly TerminalLauncherView[] = Object.freeze([]);

export function useServerTerminalLaunchers(
	entries: readonly TerminalLauncherServerEntry[],
): (serverId: string | undefined) => readonly TerminalLauncherView[] {
	const offering = useMemo(
		() =>
			entries.filter(
				(entry): entry is TerminalLauncherServerEntry & {
					applicationClient: TerminayClient;
				} =>
					entry.applicationClient !== undefined &&
					serverOffersTerminalLaunchers(entry.capabilities ?? []),
			),
		[entries],
	);
	const [byServer, setByServer] = useState<
		ReadonlyMap<string, readonly TerminalLauncherView[]>
	>(() => new Map());

	useEffect(() => {
		const stops = offering.map((entry) => {
			const facade = new TerminayClientFacade(entry.applicationClient);
			return followTerminalLaunchers(
				{
					query: facade.query.bind(facade),
					command: facade.command.bind(facade),
					subscribe: (event, listener, onResync) =>
						facade.subscribeClientEvents(event, listener, onResync),
				},
				(launchers) =>
					setByServer((current) => {
						const next = new Map(current);
						next.set(entry.serverId, launchers);
						return next;
					}),
			);
		});
		const live = new Set(offering.map((entry) => entry.serverId));
		setByServer((current) => {
			if ([...current.keys()].every((serverId) => live.has(serverId)))
				return current;
			return new Map(
				[...current].filter(([serverId]) => live.has(serverId)),
			);
		});
		return () => {
			for (const stop of stops) stop();
		};
	}, [offering]);

	return useMemo(
		() => (serverId: string | undefined) =>
			serverId === undefined ? NONE : (byServer.get(serverId) ?? NONE),
		[byServer],
	);
}
