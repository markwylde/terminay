// On Windows Terminay draws the title bar, so a project window has no menu
// row. Its application menu opens as a dropdown instead: from the title-bar
// menu button, which names only a point, and from a bare Alt press, which
// Windows apps use to reach their menu. Neither path names a command.

export interface MenuPopupKeyInput {
	alt: boolean;
	control: boolean;
	key: string;
	meta: boolean;
	shift: boolean;
	type: string;
}

export interface MenuPopupPoint {
	x: number;
	y: number;
}

/** Where a bare Alt opens the menu: under the button's place at the title bar's left end. */
export const BARE_ALT_MENU_POINT: MenuPopupPoint = Object.freeze({
	x: 0,
	y: 40,
});

export function opensApplicationMenuPopup(
	platform: NodeJS.Platform,
	isProjectHost: boolean,
): boolean {
	return platform === 'win32' && isProjectHost;
}

/**
 * Tracks one window's keys and answers true on the Alt release that ends a
 * press of Alt alone. Any other key, or Alt pressed with another modifier,
 * makes that press a chord, which is left to the page.
 */
export function createBareAltTracker(): (input: MenuPopupKeyInput) => boolean {
	let armed = false;
	return (input) => {
		const isAlt = input.key === 'Alt';
		if (input.type === 'keyDown') {
			armed = isAlt && !input.control && !input.meta && !input.shift;
			return false;
		}
		if (input.type !== 'keyUp' || !isAlt) return false;
		const fire = armed;
		armed = false;
		return fire;
	};
}

/** A renderer's point, in CSS pixels, kept inside the window's content. */
export function clampMenuPopupPoint(
	point: MenuPopupPoint,
	content: { width: number; height: number },
): MenuPopupPoint {
	const clamp = (value: number, limit: number) =>
		Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.floor(limit)));
	return Object.freeze({
		x: clamp(point.x, content.width),
		y: clamp(point.y, content.height),
	});
}
