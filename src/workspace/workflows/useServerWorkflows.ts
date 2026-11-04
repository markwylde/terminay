/**
 * Workflows and workflow templates of every attached server, kept current.
 *
 * Both are server-owned (ADR-0097): this is a read-through projection per
 * connection that serves `workflows.v1`. Journal events carry only ids, so
 * each one is a cue to read again. A server without the capability simply
 * has none, and nothing is ever merged across servers.
 */

import {
	type SessionWorkflow,
	type TerminayClient,
	TerminayClientFacade,
	WORKFLOWS_CAPABILITY,
	WorkflowClient,
	type WorkflowTemplateState,
} from '@terminay/client-core';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export type WorkflowConnectionEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type ServerWorkflows = Readonly<{
	serverId: string;
	client: WorkflowClient;
	/** By terminal session id. */
	workflows: ReadonlyMap<string, SessionWorkflow>;
	/** Undefined until the first read. */
	templates?: WorkflowTemplateState;
}>;

type Controller = Readonly<{
	applicationClient: TerminayClient;
	dispose: () => void;
}>;

/** Reads one list at a time; a change during a read asks for one more. */
function serialReader<T>(read: () => Promise<T>, publish: (value: T) => void) {
	let running = false;
	let again = false;
	let disposed = false;
	const run = async (): Promise<void> => {
		if (disposed) return;
		if (running) {
			again = true;
			return;
		}
		running = true;
		try {
			do {
				again = false;
				try {
					const value = await read();
					if (!disposed) publish(value);
				} catch {
					// A failed read leaves what was shown; the next change reads again.
				}
			} while (again && !disposed);
		} finally {
			running = false;
		}
	};
	return {
		load: () => void run(),
		dispose: () => {
			disposed = true;
		},
	};
}

function startController(
	entry: WorkflowConnectionEntry & { applicationClient: TerminayClient },
	publish: (
		serverId: string,
		update: (previous: ServerWorkflows | undefined) => ServerWorkflows | undefined,
	) => void,
): Controller {
	const client = new WorkflowClient(
		new TerminayClientFacade(entry.applicationClient),
	);
	const base = (previous: ServerWorkflows | undefined): ServerWorkflows =>
		previous ?? { serverId: entry.serverId, client, workflows: new Map() };
	const workflows = serialReader(
		() => client.list(),
		(list) =>
			publish(entry.serverId, (previous) => ({
				...base(previous),
				workflows: new Map(list.map((view) => [view.sessionId, view])),
			})),
	);
	const templates = serialReader(
		() => client.templates(),
		(state) =>
			publish(entry.serverId, (previous) => ({ ...base(previous), templates: state })),
	);
	const unsubscribes: (() => void)[] = [];
	try {
		unsubscribes.push(client.onChanged(workflows.load));
		unsubscribes.push(client.onTemplatesChanged(templates.load));
	} catch {
		// A transport without subscriptions still answers the first read.
	}
	workflows.load();
	templates.load();
	return Object.freeze({
		applicationClient: entry.applicationClient,
		dispose: () => {
			workflows.dispose();
			templates.dispose();
			for (const unsubscribe of unsubscribes) unsubscribe();
		},
	});
}

/** Workflows of every attached server that serves them, by server id. */
export function useServerWorkflows(
	entries: readonly WorkflowConnectionEntry[],
): ReadonlyMap<string, ServerWorkflows> {
	const [byServer, setByServer] = useState<ReadonlyMap<string, ServerWorkflows>>(
		() => new Map(),
	);
	const controllers = useRef(new Map<string, Controller>());

	useEffect(() => {
		const publish = (
			serverId: string,
			update: (previous: ServerWorkflows | undefined) => ServerWorkflows | undefined,
		) =>
			setByServer((previous) => {
				const next = update(previous.get(serverId));
				const map = new Map(previous);
				if (next === undefined) map.delete(serverId);
				else map.set(serverId, next);
				return map;
			});
		const wanted = new Map<
			string,
			WorkflowConnectionEntry & { applicationClient: TerminayClient }
		>();
		for (const entry of entries) {
			if (entry.applicationClient === undefined) continue;
			if (entry.capabilities?.includes(WORKFLOWS_CAPABILITY) !== true) continue;
			wanted.set(entry.serverId, { ...entry, applicationClient: entry.applicationClient });
		}
		for (const [serverId, controller] of [...controllers.current]) {
			if (wanted.get(serverId)?.applicationClient === controller.applicationClient)
				continue;
			controller.dispose();
			controllers.current.delete(serverId);
			publish(serverId, () => undefined);
		}
		for (const [serverId, entry] of wanted) {
			if (controllers.current.has(serverId)) continue;
			controllers.current.set(serverId, startController(entry, publish));
		}
	}, [entries]);

	useEffect(
		() => () => {
			for (const controller of controllers.current.values()) controller.dispose();
			controllers.current.clear();
		},
		[],
	);

	return byServer;
}

export const WorkflowsContext = createContext<ReadonlyMap<string, ServerWorkflows>>(
	new Map(),
);

/** The workflow one terminal has, and its server's client. */
export function useTerminalWorkflow(
	serverId: string | undefined,
	sessionId: string | undefined,
): { readonly view?: SessionWorkflow; readonly server?: ServerWorkflows } {
	const byServer = useContext(WorkflowsContext);
	const server = serverId === undefined ? undefined : byServer.get(serverId);
	const view = sessionId === undefined ? undefined : server?.workflows.get(sessionId);
	return {
		...(view === undefined ? {} : { view }),
		...(server === undefined ? {} : { server }),
	};
}
