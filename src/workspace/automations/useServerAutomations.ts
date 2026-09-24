/**
 * Each attached server's automations, kept current.
 *
 * Automations are server-owned: this holds a read-through projection per
 * connection that serves `automations.v1`, never a copy that could drift.
 * Journal events carry only ids, enums, and timestamps, so every event is a
 * cue to refetch the detail through `automations.get` / `automations.runs`,
 * which revalidate authority on each request.
 *
 * One projection feeds the Home overview, the Automations section, and the
 * missed-run notice, so the three can never disagree.
 */

import {
	AutomationClient,
	type AutomationDefinition,
	type AutomationMissedRecord,
	type AutomationRunEntry,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import { useEffect, useRef, useState } from 'react';
import { refusalMessage, supportsAutomations } from './automationsModel';

/** One connection, as the projection needs it. */
export type AutomationConnectionEntry = Readonly<{
	serverId: string;
	label: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type ServerAutomations = Readonly<{
	serverId: string;
	label: string;
	client: AutomationClient;
	status: 'loading' | 'ready' | 'error';
	/** Why the server could not be read, in a sentence. */
	error?: string;
	automations: readonly AutomationDefinition[];
	revision: number;
	/** The IANA zone the server evaluates schedules in, once known. Next-run
	 * previews use it, never this device's zone. */
	timeZone?: string;
	/** Newest first. */
	runs: readonly AutomationRunEntry[];
	missed: readonly AutomationMissedRecord[];
	/** Refetch definitions and runs now. */
	refresh: () => void;
}>;

type Controller = Readonly<{
	applicationClient: TerminayClient;
	dispose: () => void;
}>;

const RUN_REFETCH_DELAY_MS = 120;

function startController(
	entry: AutomationConnectionEntry & { applicationClient: TerminayClient },
	publish: (serverId: string, next: ServerAutomations | undefined) => void,
): Controller {
	const client = new AutomationClient(
		new TerminayClientFacade(entry.applicationClient),
	);
	let disposed = false;
	let runTimer: ReturnType<typeof setTimeout> | undefined;
	let current: ServerAutomations;
	const set = (patch: Partial<ServerAutomations>) => {
		if (disposed) return;
		current = Object.freeze({ ...current, ...patch });
		publish(entry.serverId, current);
	};
	const loadDefinitions = async () => {
		try {
			const state = await client.get();
			set({
				automations: state.automations,
				revision: state.revision,
				...(state.timeZone === undefined ? {} : { timeZone: state.timeZone }),
				status: 'ready',
				error: undefined,
			});
		} catch (error) {
			set({ status: 'error', error: refusalMessage(error) });
		}
	};
	const loadRuns = async () => {
		try {
			const snapshot = await client.runs();
			set({ runs: snapshot.runs, missed: snapshot.missed });
		} catch {
			// The definitions request reports why the server cannot be read.
		}
	};
	const scheduleRuns = () => {
		if (runTimer !== undefined) return;
		runTimer = setTimeout(() => {
			runTimer = undefined;
			void loadRuns();
		}, RUN_REFETCH_DELAY_MS);
	};
	const refresh = () => {
		void loadDefinitions();
		void loadRuns();
	};
	current = Object.freeze({
		serverId: entry.serverId,
		label: entry.label,
		client,
		status: 'loading',
		automations: Object.freeze([]),
		revision: 0,
		runs: Object.freeze([]),
		missed: Object.freeze([]),
		refresh,
	});
	publish(entry.serverId, current);
	const unsubscribes: (() => void)[] = [];
	try {
		unsubscribes.push(client.onChanged(() => void loadDefinitions()));
		unsubscribes.push(client.onRunChanged(scheduleRuns));
		unsubscribes.push(
			client.onMissedChanged((missed) => set({ missed })),
		);
	} catch {
		// A transport without subscriptions still answers the initial reads;
		// the section offers a refresh.
	}
	refresh();
	return Object.freeze({
		applicationClient: entry.applicationClient,
		dispose: () => {
			disposed = true;
			if (runTimer !== undefined) clearTimeout(runTimer);
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	});
}

/** Automations of every attached server that serves them, by server id. */
export function useServerAutomations(
	entries: readonly AutomationConnectionEntry[],
): ReadonlyMap<string, ServerAutomations> {
	const [byServer, setByServer] = useState<
		ReadonlyMap<string, ServerAutomations>
	>(() => new Map());
	const controllers = useRef(new Map<string, Controller>());

	useEffect(() => {
		const publish = (serverId: string, next: ServerAutomations | undefined) =>
			setByServer((previous) => {
				const map = new Map(previous);
				if (next === undefined) map.delete(serverId);
				else map.set(serverId, next);
				return map;
			});
		const wanted = new Set<string>();
		for (const entry of entries) {
			const { applicationClient } = entry;
			if (
				applicationClient === undefined ||
				!supportsAutomations(entry.capabilities)
			)
				continue;
			wanted.add(entry.serverId);
			const existing = controllers.current.get(entry.serverId);
			if (existing?.applicationClient === applicationClient) continue;
			existing?.dispose();
			controllers.current.set(
				entry.serverId,
				startController({ ...entry, applicationClient }, publish),
			);
		}
		for (const [serverId, controller] of controllers.current) {
			if (wanted.has(serverId)) continue;
			controller.dispose();
			controllers.current.delete(serverId);
			publish(serverId, undefined);
		}
	}, [entries]);

	useEffect(() => {
		const owned = controllers.current;
		return () => {
			for (const controller of owned.values()) controller.dispose();
			owned.clear();
		};
	}, []);

	return byServer;
}
