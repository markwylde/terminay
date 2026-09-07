import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CLAUDE_SESSION_FILE_FIELDS } from '../dist/index.js';

/**
 * `fixtures/session-file-v01.json` is a real `~/.claude/sessions/<pid>.json`
 * captured from a running Claude Code 2.1.263 on a developer host, with the
 * peer token and messaging socket path removed before it was checked in. It is
 * the contract this provider binds through, so the fields it reads are held
 * against it here rather than against a hand-written shape.
 */
const reference = JSON.parse(
	await readFile(
		new URL('../fixtures/session-file-v01.json', import.meta.url),
		'utf8',
	),
);

test('the reference session file carries every field the provider reads', () => {
	for (const field of CLAUDE_SESSION_FILE_FIELDS)
		assert.equal(
			Object.hasOwn(reference, field),
			true,
			`the captured session file must carry ${field}`,
		);
	assert.equal(typeof reference.pid, 'number');
	assert.equal(typeof reference.sessionId, 'string');
	assert.equal(typeof reference.cwd, 'string');
	assert.equal(
		typeof reference.startedAt,
		'number',
		'startedAt is epoch milliseconds, not the ctime string procStart carries',
	);
	assert.equal(typeof reference.version, 'string');
});

test('the allowed field set is exactly the five documented fields', () => {
	assert.deepEqual(
		[...CLAUDE_SESSION_FILE_FIELDS],
		['pid', 'sessionId', 'cwd', 'startedAt', 'version'],
	);
});

test('nothing else the captured file carries is in the allowed set', () => {
	const allowed = new Set(CLAUDE_SESSION_FILE_FIELDS);
	const forbidden = Object.keys(reference).filter(
		(field) => !allowed.has(field),
	);
	// The capture must keep the fields the provider must not read, or this
	// assertion would pass by their absence rather than by the rule.
	for (const field of [
		'procStart',
		'name',
		'nameSource',
		'status',
		'statusUpdatedAt',
		'updatedAt',
		'peerProtocol',
		'peerFeatures',
	])
		assert.equal(
			forbidden.includes(field),
			true,
			`${field} must be present in the capture and outside the allowed set`,
		);
	for (const field of forbidden)
		assert.equal(
			allowed.has(field),
			false,
			`${field} must never enter the allowed set`,
		);
});
