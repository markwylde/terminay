import assert from 'node:assert/strict';
import test from 'node:test';
import { MdxRuntimeClient } from '../dist/index.js';

test('MdxRuntimeClient validates opaque resource metadata and bounded ranges', async () => {
  const client = new MdxRuntimeClient({
    async queryWithBody(operation, payload) {
      if (operation === 'mdx.compile') return { result: { runtimeId: 'runtime-1', revision: 'r1', entryResourceId: 'entry', entryPath: 'docs/guide.mdx', dependencies: ['docs/guide.mdx'], resources: [{ resourceId: 'asset-1', mimeType: 'image/png', totalLength: 2 }] }, body: new Uint8Array([1]) }
      if (operation === 'mdx.resource') return { result: { runtimeId: payload.runtimeId, resourceId: payload.resourceId, offset: payload.offset, totalLength: 2, mimeType: 'image/png' }, body: new Uint8Array([1, 2]).slice(0, payload.length) }
      throw new Error(`unexpected ${operation}`)
    },
    async command() { return null },
  })
  const compiled = await client.compile('project-a', 'docs/guide.mdx')
  assert.deepEqual(compiled.resources, [{ resourceId: 'asset-1', mimeType: 'image/png', totalLength: 2 }])
  assert.deepEqual([...(await client.resource('project-a', compiled.runtimeId, 'asset-1', 0, 2)).bytes], [1, 2])
})
