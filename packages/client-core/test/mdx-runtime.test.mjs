import assert from 'node:assert/strict';
import test from 'node:test';
import { MdxRuntimeClient } from '../dist/index.js';

function client(handlers) {
	return new MdxRuntimeClient({
		async queryWithBody(operation, payload, options) {
			if (options?.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
			return handlers.queryWithBody(operation, payload, options);
		},
		async command(operation, payload) {
			return handlers.command?.(operation, payload) ?? null;
		},
	});
}

test('MdxRuntimeClient validates opaque resource metadata and contiguous ranges', async () => {
	const runtime = client({
		async queryWithBody(operation, payload) {
			if (operation === 'mdx.compile')
				return {
					result: {
						runtimeId: 'runtime-1',
						revision: 'r1',
						entryResourceId: 'entry',
						entryPath: 'docs/guide.mdx',
						dependencies: ['docs/guide.mdx'],
						resources: [{ resourceId: 'asset-1', mimeType: 'image/png', totalLength: 2 }],
					},
					body: new Uint8Array([1]),
				};
			if (operation === 'mdx.resource')
				return {
					result: {
						runtimeId: payload.runtimeId,
						resourceId: payload.resourceId,
						offset: payload.offset,
						totalLength: 2,
						mimeType: 'image/png',
					},
					body: new Uint8Array([1, 2]).slice(payload.offset, payload.offset + payload.length),
				};
			throw new Error(`unexpected ${operation}`);
		},
	});
	const compiled = await runtime.compile('project-a', 'docs/guide.mdx');
	assert.deepEqual(compiled.resources, [{ resourceId: 'asset-1', mimeType: 'image/png', totalLength: 2 }]);
	assert.deepEqual([...(await runtime.resource('project-a', compiled.runtimeId, 'asset-1', 0, 2)).bytes], [1, 2]);
});

test('MdxRuntimeClient rejects a non-contiguous resource range', async () => {
	const runtime = client({
		async queryWithBody() {
			return {
				result: {
					runtimeId: 'runtime-1',
					resourceId: 'asset-1',
					offset: 0,
					totalLength: 2,
					mimeType: 'image/png',
				},
				body: new Uint8Array([1, 2, 3]),
			};
		},
	});
	await assert.rejects(
		() => runtime.resource('project-a', 'runtime-1', 'asset-1', 0, 2),
		/not contiguous/u,
	);
});

test('MdxRuntimeClient forwards cancellation and disposes owned runtimes', async () => {
	const commands = [];
	const runtime = client({
		async queryWithBody(operation) {
			if (operation === 'mdx.compile')
				return {
					result: {
						runtimeId: 'runtime-1',
						revision: 'r1',
						entryResourceId: 'entry',
						entryPath: 'docs/guide.mdx',
						dependencies: [],
						resources: [],
					},
					body: new Uint8Array([1]),
				};
			throw new Error(operation);
		},
		async command(operation, payload) {
			commands.push({ operation, payload });
			return null;
		},
	});
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(() => runtime.compile('project-a', 'docs/guide.mdx', { signal: controller.signal }));
	await runtime.compile('project-a', 'docs/guide.mdx');
	await runtime.disposeAll();
	assert.deepEqual(commands, [{ operation: 'mdx.dispose', payload: { projectId: 'project-a', runtimeId: 'runtime-1' } }]);
});
