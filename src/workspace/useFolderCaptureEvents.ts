import type { TerminayClient } from '@terminay/client-core';
import { useEffect, useRef } from 'react';
import {
	FOLDER_TERMINAL_CAPTURED_EVENT,
	type FolderTerminalCapture,
	parseFolderTerminalCapture,
} from './folderCapture';

/**
 * Hear the server say it moved a terminal into its new worktree's folder.
 *
 * The move itself reaches this device as a workspace change like any other.
 * This is the journal event beside it, subscribed to the way the workspace
 * projection subscribes to its own: on the connection's client, by name. A
 * transport that cannot subscribe, or a server that never sends the event,
 * leaves the terminal moved all the same: only the device that was looking at
 * it is not taken along.
 */
export function useFolderCaptureEvents(
	applicationClient: TerminayClient | undefined,
	onCapture: (capture: FolderTerminalCapture) => void,
): void {
	const onCaptureRef = useRef(onCapture);
	onCaptureRef.current = onCapture;
	useEffect(() => {
		if (applicationClient === undefined) return;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
		void applicationClient
			.subscribe(FOLDER_TERMINAL_CAPTURED_EVENT)
			.then((subscription) => {
				const removeEvent = subscription.onEvent((event) => {
					const capture = parseFolderTerminalCapture(event.payload);
					if (capture !== undefined) onCaptureRef.current(capture);
				});
				const stop = () => {
					removeEvent();
					void subscription.unsubscribe().catch(() => undefined);
				};
				if (disposed) stop();
				else unsubscribe = stop;
			})
			// Following the terminal is a courtesy; the move is on screen without it.
			.catch(() => undefined);
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [applicationClient]);
}
