// On Windows and Linux Electron attaches the application menu to every
// BrowserWindow, including ones created later and ones that had it removed
// whenever `Menu.setApplicationMenu` runs again. Only project-host workspace
// windows should carry the menu bar; every other window is menu-less by
// default. macOS has a single global menu bar, so the policy does nothing there.

export interface MenuPolicyWindow {
	isDestroyed(): boolean;
	removeMenu(): void;
	setMenu(menu: unknown): void;
}

export interface MenuPolicyInput {
	alt: boolean;
	control: boolean;
	key: string;
	meta: boolean;
	shift: boolean;
	type: string;
}

export function hasPerWindowMenus(platform: NodeJS.Platform): boolean {
	return platform !== 'darwin';
}

export function applyWindowMenu(
	window: MenuPolicyWindow,
	options: {
		isProjectHost: boolean;
		menu: unknown;
		platform: NodeJS.Platform;
	},
): void {
	if (!hasPerWindowMenus(options.platform) || window.isDestroyed()) return;
	if (options.isProjectHost && options.menu) {
		window.setMenu(options.menu);
	} else {
		window.removeMenu();
	}
}

export function applyWindowMenus<W extends MenuPolicyWindow>(
	windows: readonly W[],
	options: {
		isProjectHost: (window: W) => boolean;
		menu: unknown;
		platform: NodeJS.Platform;
	},
): void {
	for (const window of windows) {
		applyWindowMenu(window, {
			isProjectHost: options.isProjectHost(window),
			menu: options.menu,
			platform: options.platform,
		});
	}
}

/** The Edit menu's terminal Copy accelerator (Ctrl+Shift+C) only reaches
 * windows that carry the menu, so menu-less windows handle it on input. */
export function isMenuLessCopyInput(
	input: MenuPolicyInput,
	platform: NodeJS.Platform,
): boolean {
	return (
		hasPerWindowMenus(platform) &&
		input.type === 'keyDown' &&
		input.control &&
		input.shift &&
		!input.alt &&
		!input.meta &&
		input.key.toLowerCase() === 'c'
	);
}
