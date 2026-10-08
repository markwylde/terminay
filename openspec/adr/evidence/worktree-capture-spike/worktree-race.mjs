// Spike: when the worktree registry watch fires, is the `git worktree add`
// process still alive, and does its ancestry reach the terminal's shell?
//
// usage: node worktree-race.mjs <workdir> <tiny|path-to-repo-to-clone> <trials>
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const [workdir, source, trialsArg] = process.argv.slice(2);
const trials = Number(trialsArg ?? 20);
const repo = join(workdir, 'repo');
rmSync(workdir, { recursive: true, force: true });
mkdirSync(workdir, { recursive: true });

const git = (args, cwd = repo) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

if (source === 'tiny') {
	mkdirSync(repo);
	git(['init', '-q', '-b', 'main']);
	writeFileSync(join(repo, 'README.md'), 'hello\n');
	git(['add', '.']);
	git(['-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-qm', 'init']);
} else {
	execFileSync('git', ['clone', '-q', '--local', source, repo]);
}
const files = git(['ls-files']).split('\n').length - 1;

// The stand-in for a terminal: one long-lived shell that commands are typed into.
const shell = spawn('sh', [], { stdio: ['pipe', 'pipe', 'inherit'] });
let onDone = null;
shell.stdout.on('data', (chunk) => {
	if (chunk.toString().includes('DONE') && onDone) onDone(performance.now());
});

const commonDir = join(repo, '.git');
let onEvent = null;
const watcher = watch(commonDir, { recursive: true }, (_type, name) => {
	if (name && String(name).startsWith('worktrees') && onEvent) onEvent(performance.now());
});
await new Promise((r) => setTimeout(r, 500)); // let the watch settle

async function findCreator() {
	const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,command=']);
	const rows = stdout.split('\n').map((line) => {
		const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
		return m ? { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] } : null;
	}).filter(Boolean);
	const parent = new Map(rows.map((r) => [r.pid, r.ppid]));
	const hit = rows.find((r) => /(^|\/)git\b.*\bworktree\s+add\b/.test(r.command) && r.command.includes(workdir));
	if (!hit) return { found: false, reachesShell: false };
	let pid = hit.pid;
	for (let depth = 0; depth < 32 && pid > 1; depth += 1) {
		if (pid === shell.pid) return { found: true, reachesShell: true };
		pid = parent.get(pid) ?? 0;
	}
	return { found: true, reachesShell: false };
}

const results = [];
for (let i = 0; i < trials; i += 1) {
	const wt = join(workdir, `wt-${i}`);
	const eventAt = new Promise((r) => { onEvent = (t) => { onEvent = null; r(t); }; });
	const doneAt = new Promise((r) => { onDone = (t) => { onDone = null; r(t); }; });
	const start = performance.now();
	shell.stdin.write(`git -C '${repo}' worktree add -q '${wt}' -b b-${i} >/dev/null 2>&1; echo DONE\n`);
	const tEvent = await Promise.race([eventAt, new Promise((r) => setTimeout(() => r(null), 5000))]);
	let found = false, reachesShell = false, tPs = null;
	if (tEvent !== null) {
		({ found, reachesShell } = await findCreator());
		tPs = performance.now();
	}
	const tDone = await doneAt;
	results.push({
		eventMs: tEvent === null ? null : Math.round(tEvent - start),
		gitMs: Math.round(tDone - start),
		psMs: tPs === null ? null : Math.round(tPs - tEvent),
		found, reachesShell,
	});
	git(['worktree', 'remove', '--force', wt]);
	git(['branch', '-qD', `b-${i}`]);
	await new Promise((r) => setTimeout(r, 400));
}
watcher.close();
shell.stdin.end();

const med = (xs) => { const s = xs.filter((x) => x !== null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const max = (xs) => Math.max(...xs.filter((x) => x !== null));
console.log(JSON.stringify({
	platform: process.platform, node: process.version, source: source === 'tiny' ? 'tiny' : 'clone', files, trials,
	found: results.filter((r) => r.found).length,
	reachesShell: results.filter((r) => r.reachesShell).length,
	noEvent: results.filter((r) => r.eventMs === null).length,
	gitMs: { median: med(results.map((r) => r.gitMs)), max: max(results.map((r) => r.gitMs)) },
	eventMs: { median: med(results.map((r) => r.eventMs)), max: max(results.map((r) => r.eventMs)) },
	psMs: { median: med(results.map((r) => r.psMs)) },
}));
rmSync(workdir, { recursive: true, force: true });
