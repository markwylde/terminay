import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FolderTreeDetails } from '../../workspace/folderTreeModel';
import { createHoverDelay } from '../../workspace/hoverDelay';
import './foldersTree.css';

/** How long the pointer or the focus rests on a card before its details show. */
export const FOLDER_DETAILS_DELAY_MS = 1_000;

/** Kept between the tooltip and the edge of the window. */
const WINDOW_MARGIN = 8;
/** Kept between the tooltip and the line it describes. */
const ANCHOR_GAP = 6;

/** A worktree's details as one sentence, for a card's accessible description. */
export function folderDetailsDescription(details: FolderTreeDetails): string {
	return `Branch ${details.branch}. Worktree ${details.worktree}. Location ${details.location}.`;
}

/**
 * A linked folder's worktree in three lines: its branch, its directory, and
 * where it is. Each is one line. A long location gives way at its start, since
 * the end of a path is the part that tells two worktrees apart.
 */
export function FolderDetails({
	details,
}: Readonly<{ details: FolderTreeDetails }>) {
	return (
		<dl className="folders-tree-details__lines">
			<dt>Branch</dt>
			<dd>{details.branch}</dd>
			<dt>Worktree</dt>
			<dd>{details.worktree}</dd>
			<dt>Location</dt>
			<dd className="folders-tree-details__location">
				<bdi>{details.location}</bdi>
			</dd>
		</dl>
	);
}

/**
 * The details beside the line they describe. Drawn in the document body, so
 * the Folders column cannot clip it, and moved to stay inside the window. It
 * takes no pointer input: it is never between the pointer and a control.
 */
export function FolderDetailsTooltip({
	details,
	anchor,
}: Readonly<{ details: FolderTreeDetails; anchor: DOMRect }>) {
	const ref = useRef<HTMLDivElement>(null);
	const [position, setPosition] = useState<{ left: number; top: number }>({
		left: anchor.left,
		top: anchor.bottom + ANCHOR_GAP,
	});
	useLayoutEffect(() => {
		const box = ref.current?.getBoundingClientRect();
		if (box === undefined) return;
		const below = anchor.bottom + ANCHOR_GAP;
		const above = anchor.top - ANCHOR_GAP - box.height;
		setPosition({
			left: Math.max(
				WINDOW_MARGIN,
				Math.min(anchor.left, window.innerWidth - box.width - WINDOW_MARGIN),
			),
			top:
				below + box.height + WINDOW_MARGIN > window.innerHeight &&
				above >= WINDOW_MARGIN
					? above
					: below,
		});
	}, [anchor]);
	return createPortal(
		<div
			ref={ref}
			className="folders-tree-details"
			role="tooltip"
			style={position}
		>
			<FolderDetails details={details} />
		</div>,
		document.body,
	);
}

/**
 * When a card's details are shown: after the pointer has rested on its title
 * line, or the keyboard focus on the card, for the delay. Anything that ends
 * that rest closes them, and cancels a wait that has not run out.
 */
export function useFolderDetailsTooltip(enabled: boolean) {
	const anchorRef = useRef<HTMLElement | null>(null);
	const [anchor, setAnchor] = useState<DOMRect | null>(null);
	const delay = useMemo(
		() =>
			createHoverDelay(
				FOLDER_DETAILS_DELAY_MS,
				() => setAnchor(anchorRef.current?.getBoundingClientRect() ?? null),
				() => setAnchor(null),
			),
		[],
	);
	const [isResting, setIsResting] = useState(false);
	const rest = () => {
		if (!enabled) return;
		setIsResting(true);
		delay.rest();
	};
	const end = () => {
		setIsResting(false);
		delay.end();
	};
	// A scroll, a drag, or Escape anywhere ends the rest: each moves what the
	// tooltip describes, or says the user is doing something else.
	useEffect(() => {
		if (!isResting) return;
		const stop = () => {
			setIsResting(false);
			delay.end();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') stop();
		};
		window.addEventListener('scroll', stop, true);
		window.addEventListener('dragstart', stop, true);
		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('scroll', stop, true);
			window.removeEventListener('dragstart', stop, true);
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [delay, isResting]);
	useEffect(() => () => delay.end(), [delay]);
	return { anchorRef, anchor, rest, end };
}
