import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_READ_MAX_BYTES,
	createServerControlDispatcher,
	createTerminalControlAdapter,
} from '../dist/index.js';

function context() {
	return {
		terminalSessionId: 'caller',
		projectId: 'project-a',
		scope: 'write',
		connectionId: 'connection-a',
		requestId: 'request-a',
		signal: new AbortController().signal,
	};
}

function createReadDispatcher() {
	const reads = [];
	const dispatch = createTerminalControlAdapter({
		adapter: {
			readTerminal(params) {
				reads.push(params);
				return { accepted: true };
			},
		},
	});
	return { reads, dispatch };
}

function createSearchDispatcher() {
	const searches = [];
	const dispatch = createTerminalControlAdapter({
		adapter: {
			searchTerminal(params) {
				searches.push(params);
				return { accepted: true };
			},
		},
	});
	return { searches, dispatch };
}

async function read(dispatch, params) {
	return dispatch(
		{ id: 'read', version: 1, op: 'read_terminal', params },
		context(),
	);
}

async function search(dispatch, params) {
	return dispatch(
		{ id: 'search', version: 1, op: 'search_terminal', params },
		context(),
	);
}

test('server control dispatcher invokes operations directly with implicit project/session scope', async () => {
	const calls = [];
	const dispatch = createServerControlDispatcher({
		handlers: {
			listTerminals: (received) => ({
				terminals: [
					{ id: received.terminalSessionId, projectId: received.projectId },
				],
			}),
			writeTerminal: (params, received) => {
				calls.push({ params, received });
				return { ok: true };
			},
		},
	});
	const listed = await dispatch(
		{ id: 'one', version: 1, op: 'list_terminals', params: {} },
		context(),
	);
	assert.deepEqual(listed, {
		terminals: [{ id: 'caller', projectId: 'project-a' }],
	});
	const written = await dispatch(
		{
			id: 'two',
			version: 1,
			op: 'write_terminal',
			params: { terminal: 'sibling', text: 'echo ok' },
		},
		{ ...context(), requestId: 'two' },
	);
	assert.deepEqual(written, { ok: true });
	assert.equal(calls[0].received.projectId, 'project-a');
	assert.equal('token' in calls[0].received, false);
});

test('server control dispatcher enforces scope, bounded params, and unsupported handlers', async () => {
	const dispatch = createServerControlDispatcher({
		maxParamsBytes: 16,
		handlers: { listTerminals: () => [] },
	});
	const denied = await dispatch(
		{ id: 'one', version: 1, op: 'write_terminal', params: {} },
		{ ...context(), scope: 'read' },
	);
	assert.equal(denied.ok, false);
	assert.equal(denied.error.code, 'forbidden');
	const limited = await dispatch(
		{
			id: 'two',
			version: 1,
			op: 'list_terminals',
			params: { value: 'x'.repeat(100) },
		},
		context(),
	);
	assert.equal(limited.ok, false);
	assert.equal(limited.error.code, 'limit_exceeded');
	const unsupported = await dispatch(
		{ id: 'three', version: 1, op: 'read_terminal', params: {} },
		context(),
	);
	assert.equal(unsupported.ok, false);
	assert.equal(unsupported.error.code, 'unsupported_op');

	const byteLimited = createServerControlDispatcher({
		maxParamsBytes: 13,
		handlers: { listTerminals: () => [] },
	});
	const unicode = await byteLimited(
		{
			id: 'four',
			version: 1,
			op: 'list_terminals',
			params: { value: 'é' },
		},
		context(),
	);
	assert.equal(unicode.ok, false);
	assert.equal(unicode.error.code, 'limit_exceeded');
	const unserializable = await byteLimited(
		{
			id: 'five',
			version: 1,
			op: 'list_terminals',
			params: { value: 1n },
		},
		context(),
	);
	assert.equal(unserializable.ok, false);
	assert.equal(unserializable.error.code, 'bad_request');
});

test('terminal dispatcher gives every read an explicit default text format and byte bound', async () => {
	const { dispatch, reads } = createReadDispatcher();
	assert.deepEqual(await read(dispatch, { terminal: 'sibling' }), {
		accepted: true,
	});
	assert.deepEqual(reads, [
		{
			terminal: 'sibling',
			format: 'text',
			maxBytes: DEFAULT_READ_MAX_BYTES,
		},
	]);
});

test('terminal dispatcher accepts visual-line and raw-cursor read forms', async () => {
	const { dispatch, reads } = createReadDispatcher();
	assert.deepEqual(
		await read(dispatch, {
			terminal: 'sibling',
			format: 'text',
			lines: 25,
			max_bytes: 65536,
		}),
		{ accepted: true },
	);
	assert.deepEqual(
		await read(dispatch, {
			terminal: 'sibling',
			format: 'raw',
			after: 0,
			max_bytes: 1,
		}),
		{ accepted: true },
	);
	assert.deepEqual(reads, [
		{
			terminal: 'sibling',
			format: 'text',
			lines: 25,
			maxBytes: 65536,
		},
		{
			terminal: 'sibling',
			format: 'raw',
			after: 0,
			maxBytes: 1,
		},
	]);
});

test('terminal dispatcher rejects malformed read modes, byte bounds, and output positions before calling adapters', async () => {
	const { dispatch, reads } = createReadDispatcher();
	for (const params of [
		{ terminal: 'sibling', format: 'unknown' },
		{ terminal: 'sibling', format: 'raw', lines: 1 },
		{ terminal: 'sibling', format: 'ansi', lines: 1 },
		{ terminal: 'sibling', format: 'text', after: 0 },
		{ terminal: 'sibling', format: 'ansi', after: 0 },
		{ terminal: 'sibling', max_bytes: 0 },
		{ terminal: 'sibling', max_bytes: 65537 },
		{ terminal: 'sibling', max_bytes: 1.5 },
		{ terminal: 'sibling', lines: 0 },
		{ terminal: 'sibling', lines: 4097 },
		{ terminal: 'sibling', lines: 1.5 },
		{ terminal: 'sibling', format: 'raw', after: -1 },
		{ terminal: 'sibling', format: 'raw', after: 1.5 },
		{ terminal: 'sibling', format: 'raw', after: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		const result = await read(dispatch, params);
		assert.equal(result.ok, false, JSON.stringify(params));
		assert.equal(result.error.code, 'bad_request', JSON.stringify(params));
	}
	assert.deepEqual(reads, []);
});

test('terminal dispatcher invokes the optional global capability adapter method without terminal parameters', async () => {
	const calls = [];
	const dispatch = createTerminalControlAdapter({
		adapter: {
			getMcpCapabilities(received, signal) {
				calls.push({ received, signal });
				return { tools: [{ name: 'search_terminal', available: true }] };
			},
		},
	});
	const result = await dispatch(
		{ id: 'capabilities', version: 1, op: 'get_mcp_capabilities', params: {} },
		context(),
	);
	assert.deepEqual(result, {
		tools: [{ name: 'search_terminal', available: true }],
	});
	assert.equal(calls.length, 1);
	assert.equal(calls[0].received.projectId, 'project-a');
	assert.equal('token' in calls[0].received, false);
});

test('terminal dispatcher applies bounded literal-search defaults and maps snake-case wire parameters', async () => {
	const { dispatch, searches } = createSearchDispatcher();
	assert.deepEqual(
		await search(dispatch, { terminal: 'sibling', query: 'café' }),
		{ accepted: true },
	);
	assert.deepEqual(
		await search(dispatch, {
			terminal: 'sibling',
			query: 'Needle',
			case_sensitive: false,
			context_lines: 0,
			max_matches: 100,
			max_bytes: 65_536,
		}),
		{ accepted: true },
	);
	assert.deepEqual(searches, [
		{
			terminal: 'sibling',
			query: 'café',
			caseSensitive: true,
			contextLines: 2,
			maxMatches: 20,
			maxBytes: 16_384,
		},
		{
			terminal: 'sibling',
			query: 'Needle',
			caseSensitive: false,
			contextLines: 0,
			maxMatches: 100,
			maxBytes: 65_536,
		},
	]);
});

test('terminal dispatcher rejects malformed literal-search contracts before calling the adapter', async () => {
	const { dispatch, searches } = createSearchDispatcher();
	for (const params of [
		{ terminal: 'sibling' },
		{ terminal: 'sibling', query: '' },
		{ terminal: 'sibling', query: '\0' },
		{ terminal: 'sibling', query: 1 },
		{ terminal: 'sibling', query: 'needle', case_sensitive: 'false' },
		{ terminal: 'sibling', query: 'needle', context_lines: -1 },
		{ terminal: 'sibling', query: 'needle', context_lines: 20.5 },
		{ terminal: 'sibling', query: 'needle', context_lines: 21 },
		{ terminal: 'sibling', query: 'needle', max_matches: 0 },
		{ terminal: 'sibling', query: 'needle', max_matches: 100.5 },
		{ terminal: 'sibling', query: 'needle', max_matches: 101 },
		{ terminal: 'sibling', query: 'needle', max_bytes: 0 },
		{ terminal: 'sibling', query: 'needle', max_bytes: 65_537 },
		{ terminal: 'sibling', query: 'needle', max_bytes: 1.5 },
	]) {
		const result = await search(dispatch, params);
		assert.equal(result.ok, false, JSON.stringify(params));
		assert.equal(result.error.code, 'bad_request', JSON.stringify(params));
	}
	assert.deepEqual(searches, []);
});
