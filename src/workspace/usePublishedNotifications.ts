/**
 * The notifications the window's server has published, or `undefined` when
 * that server does not publish them and the window falls back to reading
 * terminal activity itself.
 */

import type {
	NotificationClient,
	NotificationSnapshot,
} from '@terminay/client-core';
import { useEffect, useState } from 'react';

export function usePublishedNotifications(
	client: NotificationClient | undefined,
): NotificationSnapshot | undefined {
	const [snapshot, setSnapshot] = useState<NotificationSnapshot | undefined>(
		client?.store.snapshot,
	);
	useEffect(() => {
		// A reconnect replaces the client behind the same server, so the
		// projection is re-read from the new one rather than carried over.
		setSnapshot(client?.store.snapshot);
		if (client === undefined) return;
		return client.store.subscribe((next) => setSnapshot(next));
	}, [client]);
	return snapshot;
}
