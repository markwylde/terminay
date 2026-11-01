import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canonicalize,
	decodeCanonicalJson,
	encodeCanonicalJson,
} from '../dist/index.js';

const encoder = new TextEncoder();
const reference = (value) =>
	value === null || typeof value !== 'object'
		? JSON.stringify(value)
		: Array.isArray(value)
			? `[${value.map(reference).join(',')}]`
			: `{${Object.keys(value)
					.sort()
					.map((key) => `${JSON.stringify(key)}:${reference(value[key])}`)
					.join(',')}}`;

test('canonical JSON retains byte-identical encoding and round trips a deterministic nested corpus', () => {
	let seed = 54321;
	const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
	const value = (depth) => {
		const choice = next() % (depth > 4 ? 4 : 6);
		if (choice === 0) return null;
		if (choice === 1) return next() % 2 === 0;
		if (choice === 2) return (next() - 0x7fffffff) / 100;
		if (choice === 3) return `escape\n"\\ €😀 ${next()}`;
		if (choice === 4)
			return Array.from({ length: next() % 5 }, () => value(depth + 1));
		return Object.fromEntries(
			Array.from({ length: next() % 5 }, (_, index) => [
				`key-${4 - index}`,
				value(depth + 1),
			]),
		);
	};
	for (let i = 0; i < 500; i++) {
		const item = value(0);
		const expected = reference(item);
		assert.equal(canonicalize(item), expected);
		assert.deepEqual(encodeCanonicalJson(item), encoder.encode(expected));
		assert.deepEqual(decodeCanonicalJson(encoder.encode(expected)), item);
	}
});

test('canonical JSON rejects malformed, noncanonical and excessively nested input at every boundary', () => {
	for (const text of [
		'{"a":1,"a":2}',
		'{"b":1,"a":2}',
		'[1,]',
		'{"a":undefined}',
		'1e999',
		' 1',
		'01',
		'1.0',
		'"unterminated',
		'{"a":1}tail',
	]) {
		assert.throws(
			() => decodeCanonicalJson(encoder.encode(text)),
			undefined,
			text,
		);
	}
	assert.throws(() => decodeCanonicalJson(Uint8Array.of(0xff)), /UTF-8/);
	let item = 0;
	for (let i = 0; i < 32; i++) item = [item];
	assert.deepEqual(decodeCanonicalJson(encodeCanonicalJson(item)), item);
	assert.throws(() => encodeCanonicalJson([item]), /nesting/);
	assert.throws(() => canonicalize([item]), /nesting/);
	assert.throws(
		() =>
			decodeCanonicalJson(
				encoder.encode(`${'['.repeat(10000)}0${']'.repeat(10000)}`),
			),
		/JSON nesting limit/,
	);
	for (const invalid of [undefined, NaN, Infinity, () => {}, { a: undefined }])
		assert.throws(() => encodeCanonicalJson(invalid));
});
