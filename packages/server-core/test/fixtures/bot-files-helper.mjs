import readline from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reads = new Map(),
	writes = new Map();
const files = new Map([
	['hello', Buffer.from('hello')],
	['large', Buffer.alloc(5 * 1024 * 1024, 120)],
]);
function pump(id) {
	const r = reads.get(id);
	while (r && r.credit > 0) {
		r.credit--;
		if (r.offset >= r.data.length) {
			send({ id, done: true });
			reads.delete(id);
			break;
		}
		const chunk = r.data.subarray(r.offset, r.offset + 1024 * 1024);
		r.offset += chunk.length;
		send({ id, chunk: chunk.toString('base64') });
	}
}
send({ ready: true });
for await (const line of readline.createInterface({ input: process.stdin })) {
	const m = JSON.parse(line),
		id = m.id;
	if (m.op === 'list')
		send({
			id,
			entries: [{ name: 'hello', kind: 'file', size: 5, mtime: 1 }],
			truncated: false,
		});
	else if (m.op === 'stat')
		send({
			id,
			stat: {
				name: m.path,
				kind: 'file',
				size: files.get(m.path)?.length ?? 0,
				mtime: 1,
			},
		});
	else if (m.op === 'read') {
		reads.set(id, {
			data: files.get(m.path) ?? Buffer.alloc(0),
			credit: 4,
			offset: 0,
		});
		pump(id);
	} else if (m.op === 'credit') {
		if (reads.has(id)) reads.get(id).credit += m.n;
		pump(id);
	} else if (m.op === 'cancel') {
		reads.delete(m.target);
		writes.delete(m.target);
		send({ id, ok: true });
	} else if (m.op === 'write-begin') {
		writes.set(id, { path: m.path, chunks: [] });
		send({ id, ok: true, credit: 4 });
	} else if (m.op === 'write-chunk') {
		writes.get(id).chunks.push(Buffer.from(m.data, 'base64'));
		send({ id, credit: 1 });
	} else if (m.op === 'write-commit') {
		const w = writes.get(id);
		files.set(w.path, Buffer.concat(w.chunks));
		writes.delete(id);
		send({ id, ok: true });
	} else if (m.op === 'watch') {
		send({ id, ok: true });
		send({ id, event: { kind: 'MODIFY', path: 'hello' } });
	} else send({ id, ok: true });
}
