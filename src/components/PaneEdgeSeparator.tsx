/**
 * The left edge of a pane on the right of its row: Home's Pull Requests and
 * Issues detail preview, and the Bots rail. It follows the workspace
 * separators' gesture rules: a drag starts from the drawn width and previews
 * live; releasing commits once, and only if the pointer moved; a cancelled
 * drag, a lost window, or unmounting commits nothing.
 */

import { useEffect, useRef } from 'react';
import './paneEdgeSeparator.css';

export type PaneEdgeSeparatorProps = Readonly<{
	/** Positions the separator in its row; the shared look comes with it. */
	className: string;
	/** The accessible name, say "Resize preview". */
	label: string;
	/** How far one arrow key moves the edge, in pixels. */
	step: number;
	/** Data attributes that identify this separator to tests and styles. */
	data?: Readonly<Record<`data-${string}`, string>>;
	/** The width the pane is drawn at now. */
	width: number;
	min: number;
	max: number;
	/** The width under a dragging pointer, or null when no drag is live. */
	onPreview: (width: number | null) => void;
	onCommit: (width: number) => void;
}>;

type Drag = {
	pointerId: number;
	startX: number;
	startWidth: number;
	latest: number;
	moved: boolean;
	removeListeners: () => void;
};

export function PaneEdgeSeparator({
	className,
	label,
	step: arrowStep,
	data,
	width,
	min,
	max,
	onPreview,
	onCommit,
}: PaneEdgeSeparatorProps) {
	const dragRef = useRef<Drag | null>(null);
	const latest = useRef({ min, max, onPreview, onCommit });
	latest.current = { min, max, onPreview, onCommit };
	const clamp = (next: number) =>
		Math.min(
			latest.current.max,
			Math.max(latest.current.min, Math.round(next)),
		);

	const end = (commit: boolean) => {
		const drag = dragRef.current;
		if (drag === null) return;
		dragRef.current = null;
		drag.removeListeners();
		if (commit && drag.moved) latest.current.onCommit(drag.latest);
		latest.current.onPreview(null);
	};
	const endRef = useRef(end);
	endRef.current = end;

	// Unmounting mid-drag, say because the pane closed, commits nothing.
	useEffect(() => () => endRef.current(false), []);

	return (
		<hr
			{...data}
			className={`pane-edge-separator ${className}`}
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={min}
			aria-valuemax={max}
			aria-valuenow={width}
			aria-valuetext={`${width} pixels`}
			tabIndex={0}
			onKeyDown={(event) => {
				// The pane sits on the right, so moving its edge left widens it.
				const step =
					event.key === 'ArrowLeft'
						? arrowStep
						: event.key === 'ArrowRight'
							? -arrowStep
							: 0;
				if (step === 0) return;
				event.preventDefault();
				event.stopPropagation();
				onCommit(clamp(width + step));
			}}
			onPointerDown={(event) => {
				if (event.button !== 0 || dragRef.current !== null) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture?.(event.pointerId);
				const ownerWindow = event.currentTarget.ownerDocument.defaultView;
				const pointerId = event.pointerId;
				const onMove = (moveEvent: PointerEvent) => {
					const drag = dragRef.current;
					if (drag === null || moveEvent.pointerId !== pointerId) return;
					moveEvent.preventDefault();
					if (moveEvent.clientX !== drag.startX) drag.moved = true;
					const next = clamp(
						drag.startWidth - (moveEvent.clientX - drag.startX),
					);
					if (next === drag.latest) return;
					drag.latest = next;
					latest.current.onPreview(next);
				};
				const onUp = (upEvent: PointerEvent) => {
					if (upEvent.pointerId !== pointerId) return;
					endRef.current(upEvent.type === 'pointerup');
				};
				const onBlur = () => endRef.current(false);
				// Losing pointer capture does not end the drag: the handle is thin
				// and a quick pointer leaves it while the button is still held.
				ownerWindow?.addEventListener('pointermove', onMove);
				ownerWindow?.addEventListener('pointerup', onUp);
				ownerWindow?.addEventListener('pointercancel', onUp);
				ownerWindow?.addEventListener('blur', onBlur);
				dragRef.current = {
					pointerId,
					startX: event.clientX,
					startWidth: width,
					latest: width,
					moved: false,
					removeListeners: () => {
						ownerWindow?.removeEventListener('pointermove', onMove);
						ownerWindow?.removeEventListener('pointerup', onUp);
						ownerWindow?.removeEventListener('pointercancel', onUp);
						ownerWindow?.removeEventListener('blur', onBlur);
					},
				};
			}}
		/>
	);
}
