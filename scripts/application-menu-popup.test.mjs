import assert from 'node:assert/strict';
import test from 'node:test';
import {
	clampMenuPopupPoint,
	createBareAltTracker,
	opensApplicationMenuPopup,
} from '../electron/applicationMenuPopup.ts';

function key(type, keyName, modifiers = {}) {
	return {
		type,
		key: keyName,
		alt: keyName === 'Alt' || modifiers.alt === true,
		control: modifiers.control === true,
		meta: modifiers.meta === true,
		shift: modifiers.shift === true,
	};
}

test('Alt pressed and released alone opens the menu', () => {
	const bareAlt = createBareAltTracker();
	assert.equal(bareAlt(key('keyDown', 'Alt')), false);
	assert.equal(bareAlt(key('keyUp', 'Alt')), true);
});

test('holding Alt repeats its keyDown and still opens the menu once', () => {
	const bareAlt = createBareAltTracker();
	bareAlt(key('keyDown', 'Alt'));
	bareAlt(key('keyDown', 'Alt'));
	assert.equal(bareAlt(key('keyUp', 'Alt')), true);
	assert.equal(bareAlt(key('keyUp', 'Alt')), false);
});

test('an Alt chord, such as Alt+B for a shell, is not a menu request', () => {
	const bareAlt = createBareAltTracker();
	bareAlt(key('keyDown', 'Alt'));
	bareAlt(key('keyDown', 'b', { alt: true }));
	bareAlt(key('keyUp', 'b', { alt: true }));
	assert.equal(bareAlt(key('keyUp', 'Alt')), false);
});

test('Alt held then Escape, or with another modifier, opens nothing', () => {
	const withEscape = createBareAltTracker();
	withEscape(key('keyDown', 'Alt'));
	withEscape(key('keyDown', 'Escape', { alt: true }));
	assert.equal(withEscape(key('keyUp', 'Alt')), false);

	const withControl = createBareAltTracker();
	withControl(key('keyDown', 'Control', { control: true }));
	withControl(key('keyDown', 'Alt', { control: true }));
	assert.equal(withControl(key('keyUp', 'Alt', { control: true })), false);
});

test('only a Windows project window opens the menu as a dropdown', () => {
	assert.equal(opensApplicationMenuPopup('win32', true), true);
	assert.equal(opensApplicationMenuPopup('win32', false), false);
	assert.equal(opensApplicationMenuPopup('linux', true), false);
	assert.equal(opensApplicationMenuPopup('darwin', true), false);
});

test('a requested point is kept inside the window content', () => {
	const content = { width: 1200, height: 800 };
	assert.deepEqual(clampMenuPopupPoint({ x: 8.4, y: 40.6 }, content), {
		x: 8,
		y: 41,
	});
	assert.deepEqual(clampMenuPopupPoint({ x: 99_999, y: 99_999 }, content), {
		x: 1200,
		y: 800,
	});
});
