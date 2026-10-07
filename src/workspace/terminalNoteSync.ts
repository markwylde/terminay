export type TerminalNoteReconcileAction = 'adopt' | 'apply' | 'none';

/** What a workspace reconcile does with one terminal's note. The server owns
 * the note; the two exceptions are a local edit still on its way there, and a
 * note that predates server ownership, which is sent up once. */
export function decideTerminalNoteReconcile(input: {
	canonicalNote: string | undefined;
	localNote: string | undefined;
	firstSeen: boolean;
	hasPendingEdit: boolean;
}): TerminalNoteReconcileAction {
	if (input.hasPendingEdit) return 'none';
	if (input.canonicalNote === input.localNote) return 'none';
	if (
		input.firstSeen &&
		input.canonicalNote === undefined &&
		typeof input.localNote === 'string'
	)
		return 'adopt';
	return 'apply';
}

type PendingNoteEdit = {
	note: string | undefined;
	timer: ReturnType<typeof setTimeout> | null;
	sent: Promise<void> | null;
};

export type TerminalNoteSync = {
	/** Record a local edit and send it to the server after a quiet interval. */
	edit: (panelId: string, note: string | undefined) => void;
	/** Send any unsent edit now and wait for the server to accept it. */
	flush: (panelId: string) => Promise<void>;
	/** Send every unsent edit now, without waiting for the debounce. */
	flushAll: () => void;
	/** True while a local edit has not yet been accepted by the server. */
	hasPendingEdit: (panelId: string) => boolean;
	/** True the first time a panel is reconciled by this client. */
	markSeen: (panelId: string) => boolean;
	forget: (panelId: string) => void;
};

export function createTerminalNoteSync(options: {
	send: (panelId: string, note: string | null) => Promise<void>;
	onError: (error: unknown) => void;
	delayMs?: number;
}): TerminalNoteSync {
	const delayMs = options.delayMs ?? 400;
	const pending = new Map<string, PendingNoteEdit>();
	const seen = new Set<string>();

	const send = (panelId: string): Promise<void> => {
		const edit = pending.get(panelId);
		if (edit === undefined) return Promise.resolve();
		if (edit.timer !== null) {
			clearTimeout(edit.timer);
			edit.timer = null;
		}
		if (edit.sent !== null) return edit.sent;
		edit.sent = options
			.send(panelId, edit.note ?? null)
			.catch(options.onError)
			.finally(() => {
				// A newer keystroke replaces the entry; only the edit that was
				// actually sent may clear it.
				if (pending.get(panelId) === edit) pending.delete(panelId);
			});
		return edit.sent;
	};

	return {
		edit: (panelId, note) => {
			const previous = pending.get(panelId);
			if (previous?.timer != null) clearTimeout(previous.timer);
			const edit: PendingNoteEdit = { note, timer: null, sent: null };
			edit.timer = setTimeout(() => void send(panelId), delayMs);
			pending.set(panelId, edit);
		},
		flush: async (panelId) => {
			// An edit made while an earlier one is in flight is a new entry, so
			// keep sending until none is left.
			while (pending.has(panelId)) await send(panelId);
		},
		flushAll: () => {
			for (const panelId of [...pending.keys()]) void send(panelId);
		},
		hasPendingEdit: (panelId) => pending.has(panelId),
		markSeen: (panelId) => {
			if (seen.has(panelId)) return false;
			seen.add(panelId);
			return true;
		},
		forget: (panelId) => {
			const edit = pending.get(panelId);
			if (edit?.timer != null) clearTimeout(edit.timer);
			pending.delete(panelId);
			seen.delete(panelId);
		},
	};
}
