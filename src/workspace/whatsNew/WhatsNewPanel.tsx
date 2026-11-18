/**
 * The What's New section: terminay.com's monthly post, framed (ADR-0136).
 *
 * The frame is cross-origin and sandboxed: no top navigation, popups, forms,
 * modals or permissions, and no referrer. The page may say it rendered, and
 * may ask for an `https` link to open in the user's browser; nothing else it
 * sends is heard.
 */

import { Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { openExternalUrl } from '../../host/nativeActions';
import { whatsNewStore } from './latestWhatsNew.ts';
import {
	parseWhatsNewMessage,
	WHATS_NEW_PAGE_URL,
	WHATS_NEW_SANDBOX,
	type WhatsNewAppearance,
	type WhatsNewLoadStatus,
	watchWhatsNewLoad,
	whatsNewEmbedUrl,
} from './whatsNewModel.ts';
import './whatsNew.css';

/**
 * Home and the workspace around it are drawn dark whatever the system prefers,
 * so the post is asked for in the same appearance. Following the system would
 * put a white page inside a dark workspace.
 */
const WORKSPACE_APPEARANCE: WhatsNewAppearance = 'dark';

export function WhatsNewPanel({ isVisible }: Readonly<{ isVisible: boolean }>) {
	const appearance = WORKSPACE_APPEARANCE;
	const frameRef = useRef<HTMLIFrameElement>(null);
	const [attempt, setAttempt] = useState(0);
	const [status, setStatus] = useState<WhatsNewLoadStatus>('loading');
	const watchRef = useRef<ReturnType<typeof watchWhatsNewLoad>>(undefined);

	// Each load (first open, Retry) gets its own watch.
	useEffect(() => {
		const watch = watchWhatsNewLoad({
			online: typeof navigator === 'undefined' || navigator.onLine !== false,
			onStatus: setStatus,
			setTimer: (callback, ms) => window.setTimeout(callback, ms),
			clearTimer: (handle) => window.clearTimeout(handle as number),
		});
		watchRef.current = watch;
		return () => watch.cancel();
	}, [appearance, attempt]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const message = parseWhatsNewMessage(
				event,
				frameRef.current?.contentWindow,
			);
			if (message === undefined) return;
			if (message.type === 'terminay.whats-new.ready')
				watchRef.current?.ready();
			else void openExternalUrl(message.url).catch(() => undefined);
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, []);

	// Being on screen is what reads the announced post.
	useEffect(() => {
		const store = whatsNewStore();
		store.setViewing(isVisible);
		return () => store.setViewing(false);
	}, [isVisible]);

	const retry = useCallback(() => setAttempt((value) => value + 1), []);
	const openInBrowser = useCallback(() => {
		void openExternalUrl(WHATS_NEW_PAGE_URL).catch(() => undefined);
	}, []);

	return (
		<div
			className={`whats-new whats-new--${appearance}`}
			data-terminay-whats-new={status}
		>
			{status === 'failed' ? (
				<div className="whats-new__notice" role="status">
					<Sparkles size={22} aria-hidden="true" />
					<h2 className="whats-new__notice-title">Couldn't load What's New</h2>
					<p className="whats-new__notice-text">
						Check your connection, then try again.
					</p>
					<div className="whats-new__notice-actions">
						<button
							type="button"
							className="whats-new__button whats-new__button--primary"
							onClick={retry}
							data-terminay-whats-new-retry="true"
						>
							Retry
						</button>
						<button
							type="button"
							className="whats-new__button"
							onClick={openInBrowser}
						>
							Open in browser
						</button>
					</div>
				</div>
			) : (
				<iframe
					key={`${appearance}:${attempt}`}
					ref={frameRef}
					className="whats-new__frame"
					title="What's New in Terminay"
					src={whatsNewEmbedUrl(appearance)}
					sandbox={WHATS_NEW_SANDBOX}
					referrerPolicy="no-referrer"
					allow=""
					data-terminay-whats-new-frame="true"
					aria-busy={status === 'loading'}
				/>
			)}
		</div>
	);
}
