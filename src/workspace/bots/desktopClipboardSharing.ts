import type { TerminayHostClipboardSnapshot } from '@terminay/protocol';
import type { DesktopClipboardSharing } from '../../host/nativeActions';
import { type ClipboardRfb, clipboardTextForHost } from './desktopClipboard.ts';

const canonical = (text: string) => text.replace(/\r\n|\r/g, '\n');

/** A sharing lifetime, distinct from the lifetime of the connected RFB canvas. */
export function attachDesktopClipboardSharing(
	rfb: ClipboardRfb,
	host: DesktopClipboardSharing,
	options: {
		onState: (state: 'syncing' | 'active' | 'inactive' | 'unavailable') => void;
		onTooLarge: () => void;
	},
) {
	let token: string | undefined;
	let revision = -1;
	let text: string | undefined;
	let initialized = false;
	let disposed = false;
	let queue = Promise.resolve();
	const receive = (snapshot: TerminayHostClipboardSnapshot) => {
		if (disposed || snapshot.token !== token || snapshot.revision < revision)
			return;
		if (!snapshot.active) {
			token = undefined;
			initialized = false;
			options.onState('inactive');
			return;
		}
		if (initialized && snapshot.revision === revision) return;
		revision = snapshot.revision;
		initialized = true;
		options.onState('active');
		if (snapshot.tooLarge) options.onTooLarge();
		const next =
			snapshot.text === undefined ? undefined : canonical(snapshot.text);
		if (next !== undefined && next !== text) rfb.clipboardPasteFrom(next);
		text = next;
	};
	const claim = () => {
		if (disposed) return;
		const previous = token;
		token = crypto.randomUUID();
		const own = token;
		revision = -1;
		initialized = false;
		text = undefined;
		options.onState('syncing');
		if (previous) void host.stop(previous).catch(() => undefined);
		void host
			.start(own, receive)
			.then((snapshot) => {
				if (disposed || own !== token) {
					void host.stop(own).catch(() => undefined);
					return;
				}
				if (snapshot) receive(snapshot);
				else {
					token = undefined;
					options.onState('unavailable');
				}
			})
			.catch(() => {
				if (!disposed && own === token) {
					token = undefined;
					options.onState('unavailable');
				}
			});
	};
	const clipboard = (event: Event) => {
		// Events received before the initial host snapshot are the remote baseline,
		// not a new copy made during sharing. The host seeds each new session.
		if (!token || !initialized) return;
		const next = clipboardTextForHost(
			(event as CustomEvent<{ text?: unknown }>).detail?.text,
		);
		if (next === undefined || canonical(next) === text) return;
		const own = token;
		const copied = canonical(next);
		queue = queue
			.then(async () => {
				if (disposed || own !== token) return;
				const expectedRevision = revision;
				const snapshot = await host.write(own, expectedRevision, copied);
				if (disposed || own !== token) return;
				// Accepted writes already exist in the bot: never send them back as an
				// RFB upload. A stale revision instead reconciles to the newer host text.
				if (
					snapshot.active &&
					snapshot.revision >= revision &&
					snapshot.text === copied
				) {
					revision = snapshot.revision;
					text = copied;
				} else receive(snapshot);
			})
			.catch(() => undefined);
	};
	rfb.addEventListener('clipboard', clipboard);
	return {
		claim,
		active: () => token !== undefined && initialized,
		selected: () => token !== undefined,
		release: () => {
			const own = token;
			token = undefined;
			initialized = false;
			if (own) void host.stop(own).catch(() => undefined);
			options.onState('inactive');
		},
		dispose: () => {
			disposed = true;
			const own = token;
			token = undefined;
			if (own) void host.stop(own).catch(() => undefined);
			host.dispose();
			rfb.removeEventListener('clipboard', clipboard);
		},
	};
}
