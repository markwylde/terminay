// Spike 1.2 (native-windows-desktop): what Git for Windows writes when its
// Trace2 event target is a directory. Watches the directory while a
// `git worktree add` runs, and records the file names, when each grew, whether
// the last event is `exit`/`atexit`, and whether the parent session id we set
// appears. Run with Node and Git on Windows; prints JSON.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tgt-'));
const traces = join(root, 'run', 'git-trace');
const repo = join(root, 'repo');
mkdirSync(traces, { recursive: true });
mkdirSync(repo);
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
git(['init', '-q', '-b', 'main']);
git(['-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']);

const token = 'terminay-0123456789abcdef01234567';
const started = performance.now();
const events = [];
const watcher = watch(traces, (event, filename) => {
	let size = null;
	try {
		size = statSync(join(traces, filename)).size;
	} catch {}
	events.push({ atMs: Math.round(performance.now() - started), event, filename, size });
});

const exitAtMs = await new Promise((resolve) => {
	const child = spawn('git', ['worktree', 'add', '-q', '-b', 'spike-wt', join(root, 'wt')], {
		cwd: repo,
		env: {
			...process.env,
			GIT_TRACE2_EVENT: traces,
			GIT_TRACE2_EVENT_BRIEF: '1',
			GIT_TRACE2_EVENT_NESTING: '1',
			GIT_TRACE2_PARENT_SID: token,
		},
		stdio: 'inherit',
	});
	child.on('exit', () => resolve(Math.round(performance.now() - started)));
});
await new Promise((resolve) => setTimeout(resolve, 500));
watcher.close();

const files = readdirSync(traces).map((filename) => {
	const lines = readFileSync(join(traces, filename), 'utf8').split('\n').filter(Boolean);
	const parsed = lines.map((line) => {
		try {
			return JSON.parse(line);
		} catch {
			return { unparsed: line.slice(0, 200) };
		}
	});
	return {
		filename,
		lines: lines.length,
		bytes: statSync(join(traces, filename)).size,
		events: parsed.map((entry) => entry.event ?? 'unparsed'),
		sids: [...new Set(parsed.map((entry) => entry.sid).filter(Boolean))],
		parentSidSeen: lines.some((line) => line.includes(token)),
		lastEvent: parsed.at(-1)?.event,
		worktreeAdd: parsed.some((entry) => entry.event === 'cmd_name' && String(entry.name).startsWith('worktree')),
		sample: lines.slice(0, 4),
	};
});

console.log(
	JSON.stringify(
		{ git: git(['--version']).trim(), exitAtMs, watchEvents: events, files },
		null,
		2,
	),
);
