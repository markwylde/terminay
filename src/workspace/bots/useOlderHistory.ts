/**
 * Loads older history as the reader scrolls up (reverse infinite scroll).
 *
 * A sentinel at the top of the loaded history is watched with an
 * IntersectionObserver whose top margin is one viewport height, so the next
 * page is requested before the reader reaches the top. The observer is
 * rebuilt after every page, which re-checks the sentinel and keeps filling a
 * tall view. One request is in flight per view, a response for a view that
 * has since reset is dropped, and the message being read is held in place
 * when a page is prepended. A view that is following new messages is left to
 * follow them.
 */
import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { refusalText } from './useServerBots';

const MESSAGE = '[data-terminay-message-key]';

type Anchor = { key: string; offset: number };

/** The first message whose bottom is below the viewport's top, and where it sits. */
export function captureAnchor(viewport: HTMLElement): Anchor | undefined {
	const top = viewport.getBoundingClientRect().top;
	for (const element of viewport.querySelectorAll<HTMLElement>(MESSAGE)) {
		const box = element.getBoundingClientRect();
		const key = element.dataset.terminayMessageKey;
		if (key && box.bottom > top) return { key, offset: box.top - top };
	}
	return undefined;
}

/** Scrolls so the anchored message is back where it was; no-op if already there. */
export function restoreAnchor(viewport: HTMLElement, anchor: Anchor): void {
	const element = viewport.querySelector<HTMLElement>(
		`[data-terminay-message-key="${CSS.escape(anchor.key)}"]`,
	);
	if (!element) return;
	const drift =
		element.getBoundingClientRect().top -
		viewport.getBoundingClientRect().top -
		anchor.offset;
	if (drift) viewport.scrollTop += drift;
}

export function useOlderHistory<Page>({
	scroller,
	sentinel,
	cursor,
	generation,
	enabled,
	pinned,
	fetchPage,
	apply,
}: Readonly<{
	scroller: RefObject<HTMLElement | null>;
	sentinel: RefObject<HTMLElement | null>;
	/** The cursor of the next older page; null when the oldest is loaded. */
	cursor: string | null;
	/** Bumped by the view whenever it starts over; older responses are dropped. */
	generation: RefObject<number>;
	/** False until the view's first page is shown and placed. */
	enabled: boolean;
	/** True while the view follows new messages at the bottom. */
	pinned: RefObject<boolean>;
	/** Fetches one older page without touching state. */
	fetchPage: (cursor: string) => Promise<Page>;
	/** Merges a page and stores its next cursor. */
	apply: (page: Page) => void;
}>): {
	loading: boolean;
	error: string | undefined;
	retry: () => void;
} {
	const [loading, setLoading] = useState(false);
	// A failure belongs to the page it was for: a view that has moved on to
	// another cursor, or been disabled, no longer shows it.
	const [failure, setFailure] = useState<{
		cursor: string;
		generation: number;
		text: string;
	}>();
	const [height, setHeight] = useState(0);
	// Bumped when a response is dropped because the view reset meanwhile, so
	// the observer re-checks a sentinel that never left the margin.
	const [rearm, setRearm] = useState(0);
	const inflight = useRef<{ token: object; generation: number } | undefined>(
		undefined,
	);
	const anchor = useRef<Anchor | undefined>(undefined);
	const live = useRef(true);
	const latest = useRef({ cursor, enabled, fetchPage, apply });
	latest.current = { cursor, enabled, fetchPage, apply };
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
		};
	}, []);
	const request = useCallback(async () => {
		const { cursor: at, enabled: on } = latest.current;
		const view = generation.current;
		if (!at || !on) return;
		// One request per view; a request from a view since reset does not block.
		if (inflight.current?.generation === view) return;
		const token = {};
		inflight.current = { token, generation: view };
		setLoading(true);
		setFailure(undefined);
		let dropped = false;
		try {
			const page = await latest.current.fetchPage(at);
			if (!live.current) return;
			if (view !== generation.current) {
				dropped = true;
				return;
			}
			const viewport = scroller.current;
			anchor.current =
				viewport && !pinned.current ? captureAnchor(viewport) : undefined;
			latest.current.apply(page);
			// This cursor is spent; until the view re-renders with the next one,
			// an observer callback already queued must not fetch it again.
			latest.current = { ...latest.current, cursor: null };
		} catch (cause) {
			if (!live.current) return;
			if (view === generation.current)
				setFailure({ cursor: at, generation: view, text: refusalText(cause) });
			else dropped = true;
		} finally {
			if (inflight.current?.token === token) {
				inflight.current = undefined;
				if (live.current) setLoading(false);
			}
			if (dropped && live.current) setRearm((n) => n + 1);
		}
	}, [generation, pinned, scroller]);
	// A failure shows only in the view and for the page it was for.
	const error =
		enabled &&
		failure &&
		failure.cursor === cursor &&
		failure.generation === generation.current
			? failure.text
			: undefined;
	// Hold the message being read in place, before the browser paints.
	useLayoutEffect(() => {
		const viewport = scroller.current,
			held = anchor.current;
		if (!held || !viewport) return;
		anchor.current = undefined;
		if (!pinned.current) restoreAnchor(viewport, held);
	});
	// One viewport above the top, measured: percentage margins resolve
	// against the root's width.
	useEffect(() => {
		const viewport = scroller.current;
		if (!viewport) return;
		const measure = () => setHeight(Math.round(viewport.clientHeight));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [scroller]);
	// A new observer reports the sentinel's current state, so rebuilding it
	// after each page (and on resize) keeps filling a view still near the top.
	useEffect(() => {
		const viewport = scroller.current,
			target = sentinel.current;
		if (!enabled || !cursor || error || !viewport || !target || !height) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void request();
			},
			{ root: viewport, rootMargin: `${height}px 0px 0px 0px` },
		);
		observer.observe(target);
		return () => observer.disconnect();
	}, [enabled, cursor, error, height, rearm, request, scroller, sentinel]);
	const retry = useCallback(() => {
		setFailure(undefined);
		void request();
	}, [request]);
	return { loading: enabled && loading, error, retry };
}
