// Spike: can a per-terminal environment make git itself report "worktree add"
// to a server socket, with the terminal identifiable, and at what cost?
//
// usage: node trace2.mjs <workdir> <trials>
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [workdir, trialsArg] = process.argv.slice(2);
const trials = Number(trialsArg ?? 20);
const repo = join(workdir, 'repo');
const sock = join(tmpdir(), `tsk-${process.pid}.sock`); // unix socket paths are capped near 104 bytes
rmSync(workdir, { recursive: true, force: true });
mkdirSync(repo, { recursive: true });
const git = (args, env = {}) =>
	execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
git(['init', '-q', '-b', 'main']);
writeFileSync(join(repo, 'README.md'), 'hello\n');
git(['add', '.']);
git(['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']);

let bytes = 0, lines = 0, onAdd = null;
const kinds = new Map();
const server = createServer((conn) => {
	let buf = '';
	conn.on('data', (chunk) => {
		bytes += chunk.length;
		buf += chunk;
		for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
			const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
			lines += 1;
			let ev; try { ev = JSON.parse(line); } catch { continue; }
			kinds.set(ev.event, (kinds.get(ev.event) ?? 0) + 1);
			const w = ev.event === 'start' ? (ev.argv ?? []).indexOf('worktree') : -1;
			if (w > 0 && ev.argv[w + 1] === 'add' && onAdd)
				onAdd({ t: performance.now(), sid: ev.sid, argv: ev.argv });
		}
	});
});
await new Promise((r) => server.listen(sock, r));

const TERMINAL = 'terminay-session-42';
const env = {
	GIT_TRACE2_EVENT: `af_unix:stream:${sock}`,
	GIT_TRACE2_EVENT_BRIEF: '1',
	GIT_TRACE2_EVENT_NESTING: '1',
	GIT_TRACE2_PARENT_SID: TERMINAL,
};

// A long-lived shell stands in for the terminal; an inner `sh -c` for an agent's tool call.
const shell = spawn('sh', [], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
let onDone = null;
shell.stdout.on('data', (c) => { if (c.toString().includes('DONE') && onDone) onDone(performance.now()); });

let attributed = 0, seen = 0, beforeExit = 0;
for (let i = 0; i < trials; i += 1) {
	const wt = join(workdir, `wt-${i}`);
	const added = new Promise((r) => { onAdd = (e) => { onAdd = null; r(e); }; });
	const done = new Promise((r) => { onDone = (t) => { onDone = null; r(t); }; });
	shell.stdin.write(`sh -c "git -C '${repo}' worktree add -q '${wt}' -b b-${i}" >/dev/null 2>&1; echo DONE\n`);
	const ev = await Promise.race([added, new Promise((r) => setTimeout(() => r(null), 3000))]);
	const tDone = await done;
	if (ev) {
		seen += 1;
		if (ev.sid.startsWith(`${TERMINAL}/`)) attributed += 1;
		if (ev.t < tDone) beforeExit += 1;
	}
	git(['worktree', 'remove', '--force', wt]);
	git(['branch', '-qD', `b-${i}`]);
}

// Volume and cost for the command agents run most.
const before = { bytes, lines };
const once = (extra) => new Promise((r) => spawn('git', ['status', '--porcelain'], { cwd: repo, env: { ...process.env, ...extra }, stdio: 'ignore' }).on('close', r));
const time = async (extra) => { const t = performance.now(); for (let i = 0; i < 50; i += 1) await once(extra); return (performance.now() - t) / 50; };
const plainMs = await time({});
const tracedMs = await time(env);
await new Promise((r) => setTimeout(r, 200));
const perStatus = { bytes: Math.round((bytes - before.bytes) / 50), lines: Math.round((lines - before.lines) / 50) };

// A dead socket must not break or slow git.
server.close();
shell.stdin.end();
await new Promise((r) => setTimeout(r, 200));
rmSync(sock, { force: true });
let deadOk = true, deadStderr = '';
try {
	const out = spawn('git', ['status', '--porcelain'], { cwd: repo, env: { ...process.env, ...env } });
	for await (const c of out.stderr) deadStderr += c;
} catch { deadOk = false; }

console.log(JSON.stringify({
	platform: process.platform, git: execFileSync('git', ['--version']).toString().trim(), trials,
	seen, attributed, beforeExit,
	eventKinds: Object.fromEntries(kinds),
	perStatus, statusMs: { plain: +plainMs.toFixed(2), traced: +tracedMs.toFixed(2) },
	deadSocket: { ok: deadOk, stderr: deadStderr.trim().slice(0, 200) },
}));
rmSync(workdir, { recursive: true, force: true });
