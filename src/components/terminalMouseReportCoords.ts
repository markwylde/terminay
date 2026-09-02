export type TerminalMouseReportCoords = {
	col: number;
	row: number;
	x: number;
	y: number;
};

/**
 * xterm 6.1 synthesizes inertia gesture events without client coordinates.
 * SGR mouse encoding then stringifies NaN (`ESC[<64;NaN;NaNM`) into the PTY.
 * Drop those reports; translation-based scrolling still works.
 */
export function sanitizeMouseReportCoords(
	pos: TerminalMouseReportCoords | undefined,
): TerminalMouseReportCoords | undefined {
	if (
		pos === undefined ||
		!Number.isFinite(pos.col) ||
		!Number.isFinite(pos.row) ||
		!Number.isFinite(pos.x) ||
		!Number.isFinite(pos.y)
	) {
		return undefined;
	}
	return pos;
}

type XtermTerminalWithMouseCoords = {
	_core?: {
		_mouseCoordsService?: {
			getMouseReportCoords?: (
				event: unknown,
				element: unknown,
			) => TerminalMouseReportCoords | undefined;
		};
	};
};

export function suppressNonFiniteMouseReportCoords(
	terminal: unknown,
): () => void {
	const mouseCoordsService = (terminal as XtermTerminalWithMouseCoords)._core
		?._mouseCoordsService;
	const original =
		mouseCoordsService?.getMouseReportCoords?.bind(mouseCoordsService);
	if (!mouseCoordsService || original === undefined) {
		return () => {};
	}

	mouseCoordsService.getMouseReportCoords = (event, element) =>
		sanitizeMouseReportCoords(original(event, element));

	return () => {
		mouseCoordsService.getMouseReportCoords = original;
	};
}
