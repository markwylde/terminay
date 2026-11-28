import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteDesktopViewerSettings } from './viewerSettings.ts';

test('the controlling stream takes input, shares the clipboard, and asks the desktop to follow its size', () => {
	assert.deepEqual(
		remoteDesktopViewerSettings({
			requested: 'view-only',
			granted: 'control',
			thumbnail: false,
			resize: true,
		}),
		{
			mode: 'control',
			viewOnly: false,
			scaleViewport: true,
			resizeSession: true,
			clipboard: true,
		},
	);
});

test('a viewer never asks for a size and is scaled to fit, whatever it requested', () => {
	for (const requested of ['view-only', 'control'] as const)
		assert.deepEqual(
			remoteDesktopViewerSettings({
				requested,
				granted: 'view-only',
				thumbnail: false,
				resize: true,
			}),
			{
				mode: 'view-only',
				viewOnly: true,
				scaleViewport: true,
				resizeSession: false,
				clipboard: false,
			},
		);
});

test('when control is taken the replacing stream has no clipboard and no resize', () => {
	const before = remoteDesktopViewerSettings({
		requested: 'view-only',
		granted: 'control',
		thumbnail: false,
		resize: true,
	});
	const after = remoteDesktopViewerSettings({
		requested: 'view-only',
		granted: 'view-only',
		thumbnail: false,
		resize: true,
	});
	assert.equal(before.clipboard, true);
	assert.equal(after.clipboard, false);
	assert.equal(after.resizeSession, false);
	assert.equal(after.viewOnly, true);
});

test('a stream that names no mode is shown in the mode asked for, and resizes only when told to', () => {
	const bot = remoteDesktopViewerSettings({
		requested: 'control',
		thumbnail: false,
		resize: false,
	});
	assert.equal(bot.mode, 'control');
	assert.equal(bot.resizeSession, false);
	assert.equal(bot.clipboard, true);
	assert.equal(bot.scaleViewport, true);
});

test('a thumbnail is always view-only', () => {
	assert.deepEqual(
		remoteDesktopViewerSettings({
			requested: 'control',
			granted: 'control',
			thumbnail: true,
			resize: true,
		}),
		{
			mode: 'view-only',
			viewOnly: true,
			scaleViewport: true,
			resizeSession: false,
			clipboard: false,
		},
	);
});
