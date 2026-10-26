import assert from 'node:assert/strict';
import test from 'node:test';
import {
	deviceDisplayName,
	deviceNameIsAbbreviated,
} from './deviceDisplayName.ts';

test('an iPhone running Safari is named by device and browser', () => {
	assert.equal(
		deviceDisplayName(
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0.1 Mobile/15E148 Safari/604.1',
		),
		'iPhone · Safari 27',
	);
});

test('Firefox on macOS', () => {
	assert.equal(
		deviceDisplayName(
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0',
		),
		'Mac · Firefox 158',
	);
});

test('Chrome on Linux, and Edge is not mistaken for Chrome', () => {
	assert.equal(
		deviceDisplayName(
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
		),
		'Linux · Chrome 140',
	);
	assert.equal(
		deviceDisplayName(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
		),
		'Windows · Edge 140',
	);
});

test('an unrecognised user agent still reads as a browser', () => {
	assert.equal(deviceDisplayName('Mozilla/5.0 (Something) Strange/1'), 'Unknown browser');
});

test('a name that is not a user agent is kept', () => {
	assert.equal(deviceDisplayName('Studio Mac'), 'Studio Mac');
	assert.equal(deviceNameIsAbbreviated('Studio Mac'), false);
	assert.equal(
		deviceNameIsAbbreviated('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0'),
		true,
	);
});
