// Auxiliary windows (Settings, Remote Control, Recordings, Performance Log)
// open at a preferred size that can exceed a small display. macOS lets a
// window's title bar land above the screen, where its close button cannot be
// reached, and a child of a full-screen window cannot be zoomed to fit. So the
// window is sized to the work area of the display it opens on, and the close
// shortcut always closes it.

export interface PlacementRectangle {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const AUXILIARY_WINDOW_PREFERRED_SIZE = { width: 1180, height: 820 };

/** Fit the preferred size inside the work area and centre it there. */
export function fitAuxiliaryWindowBounds(
	preferred: Readonly<{ width: number; height: number }>,
	workArea: Readonly<PlacementRectangle>,
): PlacementRectangle {
	const width = Math.max(1, Math.min(preferred.width, workArea.width));
	const height = Math.max(1, Math.min(preferred.height, workArea.height));
	return {
		x: Math.round(workArea.x + (workArea.width - width) / 2),
		y: Math.round(workArea.y + (workArea.height - height) / 2),
		width,
		height,
	};
}

/** An auxiliary window has no active terminal; Close closes the window. */
export function closesAuxiliaryWindow(command: string): boolean {
	return command === 'close-active';
}
