/**
 * A terminal's menu, opened from somewhere other than its tab.
 *
 * The menu belongs to the tab: the tab holds its state and its actions report
 * from the tab's element. So another surface that offers the same menu does
 * not build a second one. It asks the tab to open its own, at a point of its
 * choosing, exactly as a right-click on the tab would.
 */

function tabOf(panelId: string): HTMLElement | undefined {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			'.terminal-tab-content[data-panel-id]',
		),
	).find((tab) => tab.dataset.panelId === panelId);
}

/** Open the menu of a terminal's tab at a point. False when the terminal has
 * no tab drawn on this device, which is the caller's to bring about. */
export function openTerminalTabMenu(
	panelId: string,
	anchor: { x: number; y: number },
): boolean {
	const tab = tabOf(panelId);
	if (tab === undefined) return false;
	tab.dispatchEvent(
		new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			button: 2,
			clientX: anchor.x,
			clientY: anchor.y,
		}),
	);
	return true;
}

/**
 * Open a terminal's tab menu, bringing its tab into being first when there is
 * none: a folder this device has not shown has no tabs yet. `reveal` is asked
 * to show the terminal, and the menu opens once its tab has been drawn.
 */
export function openTerminalTabMenuOnceDrawn(
	panelId: string,
	anchor: { x: number; y: number },
	reveal: () => void,
): void {
	if (openTerminalTabMenu(panelId, anchor)) return;
	reveal();
	const startedAt = performance.now();
	const retry = () => {
		if (openTerminalTabMenu(panelId, anchor)) return;
		if (performance.now() - startedAt >= 1_500) return;
		window.requestAnimationFrame(retry);
	};
	window.requestAnimationFrame(retry);
}
