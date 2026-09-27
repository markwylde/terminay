/**
 * Pending MCP approvals on every attached server, kept current.
 *
 * Approvals are server-owned (ADR-0031): this is a read-through projection
 * per connection that serves `mcp-approvals.v1`. Journal events carry only
 * ids, so each one is a cue to refetch through `mcp.approvals.get`, which
 * revalidates authority on every request. A client without authority simply
 * sees no approvals.
 */

import {
	type McpApproval,
	type McpApprovalDecision,
	McpApprovalClient,
	MCP_APPROVALS_CAPABILITY,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type McpApprovalConnectionEntry = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

export type ServerMcpApprovals = Readonly<{
	serverId: string;
	approvals: readonly McpApproval[];
	decide: (approvalId: string, decision: McpApprovalDecision) => Promise<void>;
}>;

type Controller = Readonly<{
	applicationClient: TerminayClient;
	dispose: () => void;
}>;

function startController(
	entry: McpApprovalConnectionEntry & { applicationClient: TerminayClient },
	publish: (serverId: string, next: ServerMcpApprovals | undefined) => void,
): Controller {
	const client = new McpApprovalClient(
		new TerminayClientFacade(entry.applicationClient),
	);
	let disposed = false;
	let generation = 0;
	const decide = async (approvalId: string, decision: McpApprovalDecision) => {
		try {
			await client.decide(approvalId, decision);
		} finally {
			void load();
		}
	};
	const load = async () => {
		const requested = ++generation;
		try {
			const approvals = await client.list();
			if (disposed || requested !== generation) return;
			publish(entry.serverId, Object.freeze({ serverId: entry.serverId, approvals, decide }));
		} catch {
			// Without authority, or before the server answers, there is nothing to show.
			if (!disposed && requested === generation)
				publish(entry.serverId, Object.freeze({ serverId: entry.serverId, approvals: [], decide }));
		}
	};
	let unsubscribe: (() => void) | undefined;
	try {
		unsubscribe = client.onChanged(() => void load());
	} catch {
		// A transport without subscriptions still answers the initial read.
	}
	void load();
	return Object.freeze({
		applicationClient: entry.applicationClient,
		dispose: () => {
			disposed = true;
			unsubscribe?.();
		},
	});
}

/** Pending approvals of every attached server that serves them, by server id. */
export function useServerMcpApprovals(
	entries: readonly McpApprovalConnectionEntry[],
): ReadonlyMap<string, ServerMcpApprovals> {
	const [byServer, setByServer] = useState<ReadonlyMap<string, ServerMcpApprovals>>(
		() => new Map(),
	);
	const controllers = useRef(new Map<string, Controller>());

	useEffect(() => {
		const publish = (serverId: string, next: ServerMcpApprovals | undefined) =>
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
				entry.capabilities?.includes(MCP_APPROVALS_CAPABILITY) !== true
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

export const McpApprovalsContext = createContext<ReadonlyMap<string, ServerMcpApprovals>>(
	new Map(),
);

export type TerminalMcpApprovals = Readonly<{
	/** Oldest first; the strip shows the first. */
	approvals: readonly McpApproval[];
	decide: (approvalId: string, decision: McpApprovalDecision) => Promise<void>;
}>;

/** The pending approvals raised by one terminal. */
export function useTerminalMcpApprovals(
	serverId: string | undefined,
	sessionId: string | undefined,
): TerminalMcpApprovals | undefined {
	const byServer = useContext(McpApprovalsContext);
	const server = serverId === undefined ? undefined : byServer.get(serverId);
	return useMemo(() => {
		if (server === undefined || sessionId === undefined) return undefined;
		const approvals = server.approvals.filter(
			(approval) => approval.terminalSessionId === sessionId,
		);
		return approvals.length === 0 ? undefined : { approvals, decide: server.decide };
	}, [server, sessionId]);
}

/** Terminal sessions with a pending approval, as `serverId:sessionId` keys. */
export function pendingApprovalKeys(
	byServer: ReadonlyMap<string, ServerMcpApprovals>,
): ReadonlySet<string> {
	const keys = new Set<string>();
	for (const server of byServer.values())
		for (const approval of server.approvals)
			keys.add(`${server.serverId}:${approval.terminalSessionId}`);
	return keys;
}
