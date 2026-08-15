import assert from 'node:assert/strict';
import test from 'node:test';
import {
	isTerminayManagerHost,
	isTerminayManagerOrigin,
	TERMINAY_MANAGER_HOST,
	TERMINAY_MANAGER_ORIGIN,
} from '../dist/index.js';

test('manager authority uses exact origins and never classifies session subdomains', () => {
	assert.equal(TERMINAY_MANAGER_ORIGIN, 'https://app.terminay.com');
	assert.equal(TERMINAY_MANAGER_HOST, 'app.terminay.com');
	assert.equal(isTerminayManagerOrigin(TERMINAY_MANAGER_ORIGIN), true);
	assert.equal(
		isTerminayManagerOrigin('https://session.web.terminay.com'),
		false,
	);
	assert.equal(isTerminayManagerHost('APP.TERMINAY.COM.'), true);
	assert.equal(isTerminayManagerHost('session.app.terminay.com'), false);
});
