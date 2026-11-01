// Run on native Node: node benchmark.mjs <baseline-worktree> <changed-worktree>.
// These isolate production methods; they do not measure a PTY or end-to-end typing.
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

async function implementation(root, name) {
  const module = relative => import(pathToFileURL(join(resolve(root), relative)).href);
  return { name, protocol: await module('packages/protocol/dist/index.js'), core: await module('packages/server-core/dist/index.js') };
}
const versions = await Promise.all([implementation(process.argv[2], 'baseline'), implementation(process.argv[3], 'changed')]);
const envelope = { type: 'command', commandId: 'benchmark-command', correlationId: 'benchmark-correlation', operation: 'terminal.input', payload: { attachmentId: 'attachment', clientId: 'client', dataBase64: 'YQ==', identity: { serverId: 'server', projectId: 'project', sessionId: 'session' } } };
const samples = [];
const measure = async (name, workload, trial, loops, run) => {
  const cpu = process.cpuUsage(); const start = performance.now();
  await run();
  samples.push({ name, workload, trial, loops, elapsedMs: performance.now() - start, cpuMicros: process.cpuUsage(cpu) });
};

for (const version of versions) {
  for (let i = 0; i < 2000; i++) version.protocol.decodeFrame(version.protocol.encodeFrame(envelope));
  version.dispatcher = version.core.createOperationDispatcher({ commands: { 'terminal.input': () => ({ result: { bytes: 1 } }) } });
  version.context = { connectionId: 'benchmark', clientId: 'client', authScope: 'write', signal: new AbortController().signal };
}

for (let trial = 0; trial < 5; trial++) {
  for (const version of trial % 2 ? [...versions].reverse() : versions) {
    const { protocol, core, name } = version;
    await measure(name, 'small terminal frame encode/decode', trial, 5000, () => {
      for (let i = 0; i < 5000; i++) protocol.decodeFrame(protocol.encodeFrame(envelope));
    });
    await measure(name, 'terminal input dispatch with completed-ledger eviction', trial, 5000, async () => {
      for (let i = 0; i < 5000; i++) await version.dispatcher.command({ envelope: { ...envelope, commandId: `command-${trial}-${i}` }, body: new Uint8Array(), context: version.context });
    });
    for (const chunkSize of [4096, 16]) {
      const holder = Object.create(core.SessionHolder.prototype);
      holder.maxBufferBytes = 1024 * 1024;
      const ring = name === 'baseline' ? [] : new core.BoundedChunkQueue(holder.maxBufferBytes, 'within-bound-keep-last');
      for (let position = 0; position < holder.maxBufferBytes; position += chunkSize) ring.push({ position, bytes: new Uint8Array(chunkSize) });
      const session = { ring, ringBytes: holder.maxBufferBytes, outputPosition: holder.maxBufferBytes, bufferedFrom: 0, streaming: false };
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 100; i++) holder.output(session, bytes);
      await measure(name, `holder retains 1 MiB in ${chunkSize}-byte chunks`, trial, 2000, () => {
        for (let i = 0; i < 2000; i++) holder.output(session, bytes);
      });
    }
  }
}
console.log(JSON.stringify({ node: process.version, flags: process.execArgv, samples }, null, 2));
