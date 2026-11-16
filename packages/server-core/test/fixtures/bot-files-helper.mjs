import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reads = new Map(),
	writes = new Map();
const files = new Map([
	['hello', Buffer.from('hello')],
	['large', Buffer.alloc(5 * 1024 * 1024, 120)],
]);
// A small home the list, mkdir, rename and delete ops keep in step, so the
// e2e suite can browse and change it. `hello` stays the first entry.
const home = new Map([
	['hello', 'file'],
	['notes', 'dir'],
	['notes/todo.md', 'file'],
	['.credentials.json', 'credential-link'],
]);
files.set('notes/todo.md', Buffer.from('- try the row menu\n'));
const watchers = new Set();
const parentOf = (p) =>
	p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
function changed(p) {
	for (const id of watchers) send({ id, event: { kind: 'MODIFY', path: p } });
}
function remove(p) {
	for (const key of [...home.keys()])
		if (key === p || key.startsWith(`${p}/`)) {
			home.delete(key);
			files.delete(key);
		}
	changed(p);
}
// The e2e suite removes entries "elsewhere" by writing their paths, one per
// line, to `files-remove` in the fake root.
const root = process.env.TERMINAY_FAKE_BOT_ROOT;
if (root)
	setInterval(() => {
		const request = path.join(root, 'files-remove');
		let names;
		try {
			names = readFileSync(request, 'utf8').split('\n').filter(Boolean);
		} catch {
			return;
		}
		rmSync(request, { force: true });
		for (const name of names) remove(name);
	}, 200).unref();
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
	if (m.op === 'list') {
		const listing = {
			id,
			entries: [...home]
				.filter(([p]) => parentOf(p) === (m.path ?? '.'))
				.map(([p, kind]) => ({
					name: p.slice(p.lastIndexOf('/') + 1),
					kind,
					size: files.get(p)?.length ?? 0,
					mtime: 1,
				})),
			truncated: false,
		};
		let delay = 0;
		if (root) {
			try {
				delay =
					JSON.parse(readFileSync(path.join(root, 'files-list-delay'), 'utf8'))[
						m.path
					] ?? 0;
			} catch {}
		}
		if (delay > 0) {
			writeFileSync(
				path.join(
					root,
					`files-list-pending-${m.path === '.' ? 'home' : m.path}`,
				),
				'',
			);
			setTimeout(() => {
				send(listing);
				writeFileSync(
					path.join(
						root,
						`files-list-delivered-${m.path === '.' ? 'home' : m.path}`,
					),
					'',
				);
			}, delay);
		} else send(listing);
	} else if (m.op === 'mkdir') {
		home.set(m.path, 'dir');
		send({ id, ok: true });
		changed(m.path);
	} else if (m.op === 'rename') {
		for (const [key, kind] of [...home])
			if (key === m.from || key.startsWith(`${m.from}/`)) {
				const to = m.to + key.slice(m.from.length);
				home.delete(key);
				home.set(to, kind);
				if (files.has(key)) {
					files.set(to, files.get(key));
					files.delete(key);
				}
			}
		send({ id, ok: true });
		changed(m.to);
	} else if (m.op === 'delete') {
		remove(m.path);
		send({ id, ok: true });
	} else if (m.op === 'stat')
		send({
			id,
			stat: {
				name: m.path,
				kind: home.get(m.path) ?? 'file',
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
		watchers.delete(m.target);
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
		home.set(w.path, 'file');
		writes.delete(id);
		send({ id, ok: true });
		changed(w.path);
	} else if (m.op === 'watch') {
		watchers.add(id);
		send({ id, ok: true });
		send({ id, event: { kind: 'MODIFY', path: 'hello' } });
	} else send({ id, ok: true });
}
