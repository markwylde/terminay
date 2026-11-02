/**
 * One session's transcript, refetched whenever its record moves.
 *
 * The projection refetches a bot's session records on every `bots.changed`;
 * a record whose size, state, or permission changed is the cue to read the
 * transcript again. Reads never overlap: a change during a read schedules one
 * more read after it.
 */

import type { BotSession, BotSessionRecord } from '@terminay/protocol';
import { useEffect, useRef, useState } from 'react';
import { refusalText, type ServerBots } from './useServerBots';

export function sessionRevisionKey(record: BotSessionRecord): string {
	return [
		record.transcriptBytes,
		record.segments,
		record.state,
		record.permission?.id ?? '',
		record.queuedMessage?.status ?? '',
		record.endedAt ?? '',
	].join('|');
}

export function useBotSession(
	server: ServerBots,
	botId: string,
	record: BotSessionRecord | undefined,
): Readonly<{ session: BotSession | undefined; error: string | undefined }> {
	const [session, setSession] = useState<BotSession>();
	const [error, setError] = useState<string>();
	const state = useRef({ busy: false, again: false });
	// The newest effect's reader. A read that finishes after its effect was
	// replaced hands the pending re-read to this one, so no update is lost.
	const latest = useRef<() => void>(() => {});
	const id = record?.id;
	const revision = record === undefined ? '' : sessionRevisionKey(record);

	useEffect(() => {
		setSession((current) => (current?.id === id ? current : undefined));
	}, [id]);

	useEffect(() => {
		if (id === undefined || revision === '') return;
		let live = true;
		const read = () => {
			if (state.current.busy) {
				state.current.again = true;
				return;
			}
			state.current.busy = true;
			server.client
				.session(botId, id)
				.then((next) => {
					if (!live) return;
					setSession(next);
					setError(undefined);
				})
				.catch((cause: unknown) => {
					if (live) setError(refusalText(cause));
				})
				.finally(() => {
					state.current.busy = false;
					if (state.current.again) {
						state.current.again = false;
						latest.current();
					}
				});
		};
		latest.current = read;
		read();
		return () => {
			live = false;
		};
	}, [server.client, botId, id, revision]);

	return { session, error };
}
