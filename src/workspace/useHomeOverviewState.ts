/**
 * The Home overview's two pieces of state that are not derived from the
 * workspace: its layout, saved as a server setting (ADR-0101), and the most
 * recent recordings, read on demand.
 */

import { RecordingsClient, TerminayClientFacade } from '@terminay/client-core';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import type { WorkspaceConnectionContext } from '../shared/connections/connectionRegistry';
import type { HomeDashboardSettings } from '../types/settings';
import { HomeLayoutSaveQueue } from './homeDashboardLayout';
import type { HomeRecordingsState } from './homeOverviewWidgets';
import { supportsRecordings } from './recordings/RecordingsPanels';

/**
 * The layout to show and a way to change it. Edits are shown at once and
 * saved one at a time; a failed save shows the server's layout again and
 * says so.
 */
export function useHomeDashboardLayout(
	server: HomeDashboardSettings,
	save: (
		layout: HomeDashboardSettings,
	) => Promise<HomeDashboardSettings | undefined>,
) {
	const saveRef = useRef(save);
	saveRef.current = save;
	const [queue] = useState(
		() => new HomeLayoutSaveQueue((layout) => saveRef.current(layout)),
	);
	const subscribe = useCallback(
		(listener: () => void) => {
			const unsubscribe = queue.subscribe(listener);
			return () => {
				unsubscribe();
			};
		},
		[queue],
	);
	const state = useSyncExternalStore(subscribe, () => queue.snapshot());
	useEffect(() => {
		queue.settle(server);
	}, [queue, server]);
	const change = useCallback(
		(layout: HomeDashboardSettings) => queue.enqueue(layout),
		[queue],
	);
	return {
		layout: state.pending ?? server,
		saveFailed: state.failed,
		change,
	};
}

const RECENT_RECORDINGS = 5;

/**
 * The most recent recordings of the server the window is working in, read
 * each time the overview is shown. Recording lifecycle publishes no change
 * event, and a poll would need the owner's approval (ADR-0028), so this list
 * is fresh as of the moment Home was shown.
 */
export function useHomeRecordings(
	server:
		| Readonly<{
				label: string;
				capabilities?: readonly string[];
				context?: WorkspaceConnectionContext;
		  }>
		| undefined,
	isShown: boolean,
): HomeRecordingsState {
	const applicationClient = server?.context?.applicationClient;
	const supported = supportsRecordings(server?.capabilities);
	const client = useMemo(
		() =>
			applicationClient === undefined || !supported
				? undefined
				: new RecordingsClient(new TerminayClientFacade(applicationClient)),
		[applicationClient, supported],
	);
	const [state, setState] = useState<HomeRecordingsState>({ state: 'loading' });
	useEffect(() => {
		if (!isShown) return;
		if (client === undefined) {
			setState(
				server === undefined
					? { state: 'unsupported' }
					: { state: 'unsupported', serverLabel: server.label },
			);
			return;
		}
		let cancelled = false;
		client.invalidate();
		client
			.list({ limit: RECENT_RECORDINGS })
			.then((result) => {
				if (!cancelled) setState({ state: 'ready', items: result.items });
			})
			.catch(() => {
				if (!cancelled) setState({ state: 'error' });
			});
		return () => {
			cancelled = true;
		};
	}, [client, isShown, server]);
	return state;
}
