import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedWhatsNewSubframe } from './whatsNewFrame.ts';

test("only a subframe may load the terminay.com What's New embed", () => {
	assert.equal(
		isAllowedWhatsNewSubframe(
			'https://terminay.com/whats-new/embed/?theme=dark',
			false,
		),
		true,
	);
	assert.equal(
		isAllowedWhatsNewSubframe(
			'https://terminay.com/whats-new/embed/2026-10/?theme=light',
			false,
		),
		true,
	);
	assert.equal(
		isAllowedWhatsNewSubframe(
			'https://terminay.com/whats-new/embed/?theme=dark',
			true,
		),
		false,
	);
});

test('every other hosted page, origin or scheme stays blocked', () => {
	for (const url of [
		'https://terminay.com/whats-new/',
		'https://terminay.com/docs/bots',
		'https://terminay.com/whats-new/embedded/',
		'http://terminay.com/whats-new/embed/',
		'https://app.terminay.com/whats-new/embed/',
		'https://terminay.com.evil.example/whats-new/embed/',
		'https://user:pass@terminay.com/whats-new/embed/',
		'javascript:alert(1)',
		'not a url',
	]) {
		assert.equal(isAllowedWhatsNewSubframe(url, false), false, url);
	}
});
