import assert from 'node:assert/strict';
import test from 'node:test';
import {
	applyWindowMenu,
	applyWindowMenus,
	isMenuLessCopyInput,
} from '../electron/windowMenuPolicy.ts';

const MENU = { id: 'app-menu' };

function createWindow(name) {
	return {
		name,
		destroyed: false,
		menu: MENU,
		isDestroyed() {
			return this.destroyed;
		},
		removeMenu() {
			this.menu = null;
		},
		setMenu(menu) {
			this.menu = menu;
		},
	};
}

for (const platform of ['win32', 'linux']) {
	test(`${platform}: only project-host windows keep the menu`, () => {
		const main = createWindow('main');
		const settings = createWindow('settings');
		applyWindowMenu(main, { isProjectHost: true, menu: MENU, platform });
		applyWindowMenu(settings, { isProjectHost: false, menu: MENU, platform });
		assert.equal(main.menu, MENU);
		assert.equal(settings.menu, null);
	});

	test(`${platform}: a menu rebuild leaves secondary windows menu-less`, () => {
		const main = createWindow('main');
		const settings = createWindow('settings');
		const popout = createWindow('popout');
		// Menu.setApplicationMenu re-attaches the menu to every window.
		const rebuilt = { id: 'rebuilt-menu' };
		for (const window of [main, settings, popout]) window.menu = rebuilt;

		applyWindowMenus([main, settings, popout], {
			isProjectHost: (window) => window === main,
			menu: rebuilt,
			platform,
		});
		assert.equal(main.menu, rebuilt);
		assert.equal(settings.menu, null);
		assert.equal(popout.menu, null);
	});

	test(`${platform}: destroyed windows are skipped`, () => {
		const window = createWindow('closed');
		window.destroyed = true;
		window.removeMenu = () => assert.fail('must not touch a destroyed window');
		applyWindowMenu(window, { isProjectHost: false, menu: MENU, platform });
	});
}

test('darwin keeps the single global menu untouched', () => {
	const settings = createWindow('settings');
	settings.removeMenu = () => assert.fail('macOS has no per-window menus');
	settings.setMenu = () => assert.fail('macOS has no per-window menus');
	applyWindowMenu(settings, {
		isProjectHost: false,
		menu: MENU,
		platform: 'darwin',
	});
});

test('Ctrl+Shift+C is the menu-less copy accelerator off macOS', () => {
	const input = {
		type: 'keyDown',
		control: true,
		shift: true,
		alt: false,
		meta: false,
		key: 'C',
	};
	assert.equal(isMenuLessCopyInput(input, 'win32'), true);
	assert.equal(isMenuLessCopyInput(input, 'linux'), true);
	assert.equal(isMenuLessCopyInput(input, 'darwin'), false);
	assert.equal(isMenuLessCopyInput({ ...input, shift: false }, 'linux'), false);
	assert.equal(
		isMenuLessCopyInput({ ...input, type: 'keyUp' }, 'linux'),
		false,
	);
	assert.equal(isMenuLessCopyInput({ ...input, alt: true }, 'linux'), false);
});
