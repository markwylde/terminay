// Real-protocol check: Xvnc 1.15 clipboard through BotRfbClientFilter('control').
// Run in node:26.13.0-trixie-slim with tigervnc-standalone-server, tigervnc-tools and xclip,
// the worktree mounted read-only at /w, Xvnc :1 started with -SendPrimary=0 -MaxCutText=1048576
// and Xvnc :2 without them (see ../verification.md).
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import zlib from 'node:zlib';
import { BotRfbClientFilter } from '/w/packages/server-core/dist/botService/index.js';

const sh = (cmd, args, env = {}) =>
	execFileSync(cmd, args, { env: { ...process.env, DISPLAY: ':1', ...env } }).toString();
const results = [];
const check = (name, ok, detail = '') => {
	results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
	console.log(results.at(-1));
};
const word = (v) => {
	const b = Buffer.alloc(4);
	b.writeInt32BE(v | 0);
	return b;
};
const CAPS = 1 << 24, REQUEST = 1 << 25, NOTIFY = 1 << 27, PROVIDE = 1 << 28, TEXT = 1;

async function connect(encodings) {
	const sock = net.connect(5901, '127.0.0.1');
	const filter = new BotRfbClientFilter('control');
	let buf = Buffer.alloc(0);
	const waiters = [];
	sock.on('data', (d) => {
		buf = Buffer.concat([buf, d]);
		for (const w of [...waiters]) w();
	});
	const read = (n) =>
		new Promise((resolve) => {
			const tryRead = () => {
				if (buf.length >= n) {
					waiters.splice(waiters.indexOf(tryRead), 1);
					const out = buf.subarray(0, n);
					buf = buf.subarray(n);
					resolve(out);
				}
			};
			waiters.push(tryRead);
			tryRead();
		});
	await new Promise((r) => sock.once('connect', r));
	await read(12);
	sock.write('RFB 003.008\n');
	const count = (await read(1))[0];
	await read(count);
	sock.write(Buffer.from([1])); // None
	await read(4);
	sock.write(Buffer.from([1])); // shared
	const head = await read(24);
	await read(head.readUInt32BE(20));
	const send = (bytes) => sock.write(filter.push(bytes));
	const enc = Buffer.alloc(4 + encodings.length * 4);
	enc[0] = 2;
	enc.writeUInt16BE(encodings.length, 2);
	for (const [i, e] of encodings.entries()) enc.writeInt32BE(e, 4 + i * 4);
	send(enc);
	// Read server messages; we never request framebuffer updates, so only
	// cut text (type 3) and bells arrive.
	const messages = [];
	const pump = async () => {
		for (;;) {
			const t = (await read(1))[0];
			if (t === 3) {
				const h = await read(7);
				const len = h.readInt32BE(3);
				messages.push({ len, body: await read(Math.abs(len)) });
			} else if (t === 2) {
				// bell
			} else {
				messages.push({ unexpected: t });
			}
		}
	};
	void pump();
	const next = async (ms = 3000) => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (messages.length) return messages.shift();
			await new Promise((r) => setTimeout(r, 20));
		}
		return undefined;
	};
	return { sock, send, next };
}
const cut = (payload, extended) =>
	Buffer.concat([Buffer.from([6, 0, 0, 0]), word(extended ? -payload.length : payload.length), payload]);

// 1. Extended: caps, Notify→Request→Provide of UTF-8 text lands in CLIPBOARD.
const c = await connect([0, -1063131698]);
const caps = await c.next();
const capsFlags = caps?.body.readUInt32BE(0) ?? 0;
check('server offers ExtendedClipboard caps', caps?.len < 0 && (capsFlags & CAPS) !== 0);
c.send(cut(Buffer.concat([word(CAPS | REQUEST | NOTIFY | PROVIDE | TEXT), word(0)]), true));
c.send(cut(word(NOTIFY | TEXT), true));
const early = await c.next(800);
check('Xvnc does not request before an application pastes', early === undefined, JSON.stringify(early));
// An X application pastes now (as the chord does); Xvnc asks the client, which provides.
const paster = spawn('xclip', ['-o', '-selection', 'clipboard'], { env: { ...process.env, DISPLAY: ':1' } });
let pasted = '';
paster.stdout.on('data', (d) => { pasted += d; });
const request = await c.next();
check('the paste makes Xvnc request the text', request?.len < 0 && (request.body.readUInt32BE(0) & REQUEST) !== 0);
const text = 'café ✓ — 漢字\r\nline2';
const raw = Buffer.from(`${text}\0`, 'utf8');
const provide = Buffer.concat([word(PROVIDE | TEXT), zlib.deflateSync(Buffer.concat([word(raw.length), raw]))]);
c.send(cut(provide, true));
await new Promise((r) => paster.once('close', r));
check('the application receives the UTF-8 text', pasted === 'café ✓ — 漢字\nline2', JSON.stringify(pasted));

// 2. Bot copy reaches the client as Notify, Provide decodes to UTF-8.
const copier = spawn('xclip', ['-i', '-selection', 'clipboard'], { env: { ...process.env, DISPLAY: ':1' } });
copier.stdin.end('from bot ✓');
let notify;
for (let i = 0; i < 5 && !notify; i++) {
	const m = await c.next();
	if (m && m.len < 0 && (m.body.readUInt32BE(0) & NOTIFY)) notify = m;
}
check('bot copy is notified', !!notify);
c.send(cut(word(REQUEST | TEXT), true));
let provided;
for (let i = 0; i < 5 && !provided; i++) {
	const m = await c.next();
	if (m && m.len < 0 && (m.body.readUInt32BE(0) & PROVIDE)) provided = m;
}
const inflated = provided ? zlib.inflateSync(provided.body.subarray(4), { finishFlush: zlib.constants.Z_SYNC_FLUSH }) : Buffer.alloc(0);
const decoded = inflated.subarray(4, 4 + inflated.readUInt32BE(0)).toString('utf8').replace(/\0$/, '');
check('bot → device UTF-8 decodes', decoded === 'from bot ✓', JSON.stringify(decoded));

// 3. PRIMARY alone is never sent.
const primary = spawn('xclip', ['-i', '-selection', 'primary'], { env: { ...process.env, DISPLAY: ':1' } });
primary.stdin.end('highlight only');
const leak = await c.next(1500);
check('a PRIMARY-only selection sends nothing', leak === undefined, JSON.stringify(leak));
c.sock.destroy();

// 4. Legacy Latin-1 ClientCutText still works.
const l = await connect([0]);
l.send(cut(Buffer.from('olé', 'latin1'), false));
await new Promise((r) => setTimeout(r, 300));
check('legacy Latin-1 cut text lands in CLIPBOARD', sh('xclip', ['-o', '-selection', 'clipboard']) === 'olé');
l.sock.destroy();

// 5. Runtime vncconfig on an Xvnc started without the flag.
const before = sh('vncconfig', ['-display', ':2', '-get', 'SendPrimary']).trim();
sh('vncconfig', ['-display', ':2', '-set', 'SendPrimary=0']);
const after = sh('vncconfig', ['-display', ':2', '-get', 'SendPrimary']).trim();
check('runtime SendPrimary=0 on an older Xvnc', before === 'on' && after === 'off', `${before} → ${after}`);
check('new Xvnc has MaxCutText 1 MiB', sh('vncconfig', ['-display', ':1', '-get', 'MaxCutText']).trim() === '1048576');

copier.kill();
primary.kill();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
