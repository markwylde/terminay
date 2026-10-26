// The first application menu on every Desktop platform is named after the app
// and holds workspace creation and Settings. There is no File menu: Terminay
// opens no documents. Management surfaces (Remote Access, Macros, Extensions)
// are Settings categories and Recordings is a Home section, so they have no
// visible entries here; their accelerators stay registered on hidden items.

import type { MenuItemConstructorOptions } from 'electron';

export type TerminayMenuCommand =
	| 'new-terminal'
	| 'new-project'
	| 'open-settings'
	| 'open-macros'
	| 'open-recordings'
	| 'open-remote-control'
	| 'open-extensions';

export interface TerminayMenuOptions {
	platform: NodeJS.Platform;
	/** The user's configured accelerator for a command, if any. */
	shortcut: (command: TerminayMenuCommand) => string | undefined;
	dispatch: (command: TerminayMenuCommand) => void;
	showAbout: () => void;
}

/** Commands reachable by accelerator without a visible menu entry. */
function hiddenCommandItems(
	options: TerminayMenuOptions,
): MenuItemConstructorOptions[] {
	const hidden: Array<[TerminayMenuCommand, string, string | undefined]> = [
		['open-macros', 'Macros', 'CmdOrCtrl+;'],
		['open-recordings', 'Recordings', options.shortcut('open-recordings')],
		[
			'open-remote-control',
			'Remote Access',
			options.shortcut('open-remote-control'),
		],
		['open-extensions', 'Extensions', options.shortcut('open-extensions')],
	];
	return hidden
		.filter(([, , accelerator]) => accelerator !== undefined)
		.map(([command, label, accelerator]) => ({
			label,
			accelerator,
			visible: false,
			acceleratorWorksWhenHidden: true,
			click: () => options.dispatch(command),
		}));
}

export function buildTerminayMenu(
	options: TerminayMenuOptions,
): MenuItemConstructorOptions {
	const create: MenuItemConstructorOptions[] = [
		{
			label: 'New Terminal Tab',
			accelerator: options.shortcut('new-terminal'),
			click: () => options.dispatch('new-terminal'),
		},
		{
			label: 'New Project',
			accelerator: options.shortcut('new-project'),
			click: () => options.dispatch('new-project'),
		},
	];
	const settings: MenuItemConstructorOptions = {
		label: 'Settings…',
		accelerator: 'CmdOrCtrl+,',
		click: () => options.dispatch('open-settings'),
	};

	if (options.platform === 'darwin') {
		return {
			label: 'Terminay',
			submenu: [
				{ label: 'About Terminay', click: () => options.showAbout() },
				{ type: 'separator' },
				settings,
				{ type: 'separator' },
				...create,
				...hiddenCommandItems(options),
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' },
			],
		};
	}

	return {
		label: 'Terminay',
		submenu: [
			...create,
			...hiddenCommandItems(options),
			{ type: 'separator' },
			settings,
			{ type: 'separator' },
			{ role: 'quit' },
		],
	};
}
