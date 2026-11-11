/**
 * How the renderer asks for pull requests and issues (ADR-0105).
 *
 * Every request is on demand: when a view is shown, when its query changes,
 * on Refresh, on window focus once the last answer is a minute old, and on a
 * `forge.changed` event while the view is shown. Nothing runs on a timer, and
 * an answer to a request that a newer one on the same view replaced is
 * dropped.
 */

import {
	type ForgeClientListRequest,
	ForgeSupersededError,
	TerminayClientFacade,
	type TerminayClient,
	TerminayForgeClient,
} from '@terminay/client-core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
	EMPTY_FORGE_LIST,
	ForgeListController,
	type ForgeListState,
} from './forgeListController.ts';
import type {
	ForgeReference,
	ForgeSummaryView,
	ForgeWorktreeMatchView,
} from './forgeModel.ts';

export type { ForgeListState };

/**
 * A forge client for a connection, or undefined when the server does not
 * advertise forge sources. With `capabilities` undefined nothing is checked:
 * the caller treats a failed request as "no forge here".
 */
export function createForgeClient(
	applicationClient: TerminayClient | undefined,
	capabilities: readonly string[] | undefined,
): TerminayForgeClient | undefined {
	if (applicationClient === undefined) return undefined;
	const facade = new TerminayClientFacade(applicationClient);
	const client = new TerminayForgeClient(
		{
			query: (operation, payload, options) => facade.query(operation, payload, options),
			command: (operation, payload, options) => facade.command(operation, payload, options),
			subscribeClientEvents: async (event, listener, onResync) =>
				facade.subscribe(event, (payload) => listener({ payload } as never), onResync),
		},
		capabilities === undefined ? {} : { serverCapabilities: capabilities },
	);
	return capabilities === undefined || client.available ? client : undefined;
}

export function useForgeClient(
	applicationClient: TerminayClient | undefined,
	capabilities: readonly string[] | undefined,
): TerminayForgeClient | undefined {
	const capabilityKey = capabilities?.join('\u0000');
	return useMemo(
		() => createForgeClient(applicationClient, capabilities),
		[applicationClient, capabilityKey],
	);
}

/** Follow `forge.changed` while mounted. */
export function useForgeChanges(
	client: TerminayForgeClient | undefined,
	listener: () => void,
): void {
	const listenerRef = useRef(listener);
	listenerRef.current = listener;
	useEffect(() => {
		if (client === undefined) return;
		let active = true;
		let dispose: (() => void) | undefined;
		void client
			.onChanged(() => listenerRef.current())
			.then((unsubscribe) => {
				if (active) dispose = unsubscribe;
				else unsubscribe();
			})
			.catch(() => undefined);
		return () => {
			active = false;
			dispose?.();
		};
	}, [client]);
}

export type ForgeListSource = Readonly<{
	list: (request: ForgeClientListRequest, key?: string) => Promise<unknown>;
	onChanged?: (listener: () => void) => Promise<() => void>;
}>;

/**
 * One list's items, asked for on demand through a `ForgeListController`.
 * `request` undefined asks nothing; `visible` false holds requests until the
 * view is shown again.
 */
export function useForgeList(
	client: ForgeListSource | undefined,
	request: ForgeClientListRequest | undefined,
	visible: boolean,
): ForgeListState & { refresh: () => void; loadMore: () => void } {
	const viewKey = useId();
	const [state, setState] = useState<ForgeListState>(EMPTY_FORGE_LIST);
	const controller = useMemo(
		() =>
			client === undefined
				? undefined
				: new ForgeListController<ForgeClientListRequest>(
						(next, key) => client.list(next, key),
						viewKey,
						setState,
					),
		[client, viewKey],
	);
	const requestKey = request === undefined ? '' : JSON.stringify(request);
	// The controller compares requests by value; the key is what changes.
	useEffect(() => {
		controller?.setRequest(request);
		controller?.setVisible(visible);
	}, [controller, requestKey, visible]);
	useEffect(() => {
		if (controller === undefined) {
			setState(EMPTY_FORGE_LIST);
			return;
		}
		const onFocus = () => controller.focus();
		window.addEventListener('focus', onFocus);
		let active = true;
		let dispose: (() => void) | undefined;
		void client
			?.onChanged?.(() => controller.changed())
			.then((unsubscribe) => {
				if (active) dispose = unsubscribe;
				else unsubscribe();
			})
			.catch(() => undefined);
		return () => {
			active = false;
			dispose?.();
			window.removeEventListener('focus', onFocus);
		};
	}, [client, controller]);
	return {
		...state,
		refresh: () => controller?.refresh(),
		loadMore: () => controller?.loadMore(),
	};
}

export type ForgeDetailView = Readonly<{
	summary: ForgeSummaryView;
	body: string;
	comments: ReadonlyArray<Readonly<{ author: string; createdAt: string; body: string }>>;
}>;

export type ForgeDetailState = Readonly<{
	detail?: ForgeDetailView;
	worktrees: readonly ForgeWorktreeMatchView[];
	loading: boolean;
	error?: string;
}>;

/** One item's detail, asked for when it is selected. */
export function useForgeDetail(
	client: TerminayForgeClient | undefined,
	sourceId: string | undefined,
	reference: ForgeReference | undefined,
	refreshToken: number,
): ForgeDetailState & { reload: () => void } {
	const viewKey = useId();
	const [state, setState] = useState<ForgeDetailState>({ worktrees: [], loading: false });
	const [reloads, setReloads] = useState(0);
	const referenceKey = reference === undefined ? '' : JSON.stringify(reference);
	const lastReloadsRef = useRef(reloads);
	useEffect(() => {
		if (client === undefined || sourceId === undefined || reference === undefined) {
			setState({ worktrees: [], loading: false });
			return;
		}
		const fresh = lastReloadsRef.current !== reloads;
		lastReloadsRef.current = reloads;
		let current = true;
		setState((previous) => ({
			worktrees: previous.detail?.summary.url === undefined ? [] : previous.worktrees,
			loading: true,
		}));
		client
			.detail(sourceId, reference, { fresh, key: viewKey })
			.then((value) => {
				if (!current) return;
				const result = value as unknown as { detail: ForgeDetailView; worktrees: ForgeWorktreeMatchView[] };
				setState({ detail: result.detail, worktrees: result.worktrees, loading: false });
			})
			.catch((error: unknown) => {
				if (!current || error instanceof ForgeSupersededError) return;
				setState({
					worktrees: [],
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			});
		return () => {
			current = false;
		};
	}, [client, referenceKey, refreshToken, reloads, sourceId, viewKey]);
	return { ...state, reload: () => setReloads((value) => value + 1) };
}
