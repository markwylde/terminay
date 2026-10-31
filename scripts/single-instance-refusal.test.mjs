import assert from 'node:assert/strict';
import test from 'node:test';
import { singleInstanceRefusalMessage } from '../electron/singleInstanceRefusal.ts';

test('a refused launch names the process holding the lock', () => {
	const message = singleInstanceRefusalMessage('/home/u/.config/Terminay', () => 'wsl-box-4242');
	assert.match(message, /Another Terminay is already running with \/home\/u\/\.config\/Terminay \(process 4242 on wsl-box\)/u);
	assert.match(message, /end it and launch again/u);
});

test('without a lock file it still says why it exits', () => {
	const message = singleInstanceRefusalMessage('C:\\Users\\u\\AppData\\Roaming\\Terminay', () => {
		throw Object.assign(new Error('no'), { code: 'ENOENT' });
	});
	assert.match(message, /already running with C:\\Users\\u\\AppData\\Roaming\\Terminay\. It was asked/u);
});
