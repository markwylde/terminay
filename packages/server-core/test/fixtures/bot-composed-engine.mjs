// Stateful fake Docker/Podman executable. No sockets, containers or providers.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MessageChannel } from 'node:worker_threads';
const root = process.env.TERMINAY_FAKE_BOT_ROOT;
const calls = path.join(root, 'calls.jsonl');
let args = process.argv.slice(2);
fs.appendFileSync(
	calls,
	`${JSON.stringify({ args, keyPresent: Boolean(process.env.FAKE_KEY) })}\n`,
);
const out = (v) =>
	process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v)}\n`);
const file = (kind, name) =>
	path.join(root, `${kind}-${encodeURIComponent(name)}.json`);
const read = (kind, name) => {
	try {
		return JSON.parse(fs.readFileSync(file(kind, name), 'utf8'));
	} catch {
		return undefined;
	}
};
const put = (kind, name, v) =>
	fs.writeFileSync(file(kind, name), JSON.stringify(v));
if (args[0] === '--version') {
	out('Docker version 29.9.2');
	process.exit(0);
}
if (args[0] === 'context') {
	out([{ Endpoints: { docker: { Host: 'unix:///fake/bots.sock' } } }]);
	process.exit(0);
}
if (args[0] === 'system') {
	process.stderr.write('podman not running');
	process.exit(1);
}
if (args[0]?.startsWith('--')) args = args.slice(2);
const [kind, action] = args;
if (kind === 'info' && fs.existsSync(path.join(root, 'engine-down'))) {
	process.stderr.write(
		'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
	);
	process.exit(1);
} else if (kind === 'info') {
	out({
		ID: process.env.TERMINAY_FAKE_ENGINE_ID ?? 'fake-bot-engine',
		SecurityOptions: [],
	});
} else if (kind === 'events') {
	const { port1 } = new MessageChannel();
	port1.on('message', () => {});
} else if (kind === 'build') {
	const active = path.join(root, 'build-active');
	fs.mkdirSync(active);
	await new Promise((resolve) => setTimeout(resolve, 40));
	if (process.env.TERMINAY_FAKE_BUILD_LOG_BYTES)
		out('x'.repeat(Number(process.env.TERMINAY_FAKE_BUILD_LOG_BYTES)));
	if (process.env.TERMINAY_FAKE_BUILD_FAIL === '1') {
		fs.rmdirSync(active);
		process.stderr.write('fake adapter install failed');
		process.exit(1);
	}
	const dockerfile = fs.readFileSync(
		path.join(args.at(-1), 'Dockerfile'),
		'utf8',
	);
	const fingerprint = /LABEL terminay.fingerprint="([^"]+)"/.exec(
		dockerfile,
	)[1];
	put('image', args[args.indexOf('--tag') + 1], {
		Config: { Labels: { 'terminay.fingerprint': fingerprint } },
		Created: new Date().toISOString(),
	});
	out('Installing pinned fake adapter');
	fs.rmdirSync(active);
} else if (kind === 'image' && action === 'tag') {
	put('image', args[3], read('image', args[2]));
} else if (action === 'inspect') {
	const resource = read(kind, args[2]);
	if (!resource) {
		process.stderr.write('Error: No such object');
		process.exit(1);
	}
	out([resource]);
} else if (action === 'create') {
	const name =
		kind === 'container' ? args[args.indexOf('--name') + 1] : args.at(-1);
	const labels = {};
	args.forEach((v, i) => {
		if (v === '--label') {
			const at = args[i + 1].indexOf('=');
			labels[args[i + 1].slice(0, at)] = args[i + 1].slice(at + 1);
		}
	});
	put(kind, name, {
		Id: name,
		Name: name,
		Labels: labels,
		Config: { Labels: labels, Image: 'terminay-bot:local' },
		State: { Running: false, Status: 'created', ExitCode: 0 },
	});
	out(name);
} else if (action === 'ls') {
	const filters = args.flatMap((v, i) =>
		v === '--filter' ? [args[i + 1]] : [],
	);
	for (const name of fs
		.readdirSync(root)
		.filter((n) => n.startsWith('container-'))) {
		const r = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
		if (args.includes('-q') && !r.State.Running) continue;
		if (
			!filters.every((f) => {
				if (f.startsWith('label!=')) return !(f.slice(7) in r.Config.Labels);
				if (!f.startsWith('label=')) return true;
				const label = f.slice(6),
					at = label.indexOf('=');
				return at < 0
					? label in r.Config.Labels
					: r.Config.Labels[label.slice(0, at)] === label.slice(at + 1);
			})
		)
			continue;
		out(r.Id ?? r.Name);
	}
} else if (['start', 'stop', 'restart'].includes(action)) {
	const name = args.at(-1),
		r = read(kind, name);
	if (r) {
		r.State = {
			Running: action !== 'stop',
			Status: action === 'stop' ? 'exited' : 'running',
			ExitCode: 0,
		};
		put(kind, name, r);
	}
} else if (action === 'rm') {
	fs.rmSync(file(kind, args.at(-1)), { force: true });
} else if (kind === 'run' && args.includes('stat')) {
	process.stdout.write('999\n');
} else if (kind === 'run' && args.includes('terminay-files')) {
	await import('./bot-files-helper.mjs');
} else if (kind === 'exec') {
	const index = args.findIndex((a) => a.startsWith('terminay-bot-'));
	const command = args.slice(index + 1);
	const environment = args.slice(0, index);
	for (let i = 0; i < environment.length; i++)
		if (environment[i] === '-e') {
			const e = environment[++i],
				at = e.indexOf('=');
			if (at >= 0) process.env[e.slice(0, at)] = e.slice(at + 1);
		}
	if (command[0] === 'terminay-run' && command[1].startsWith('--kill')) {
		const names =
			command[1] === '--kill-all'
				? fs.readdirSync(root).filter((n) => n.startsWith('pid-'))
				: [`pid-${command[2]}`];
		for (const name of names) {
			try {
				process.kill(
					Number(fs.readFileSync(path.join(root, name), 'utf8')),
					'SIGKILL',
				);
			} catch {}
			fs.rmSync(path.join(root, name), { force: true });
		}
	} else if (command[0] === 'terminay-run') {
		const sid = command[1];
		fs.writeFileSync(path.join(root, `pid-${sid}`), String(process.pid));
		if (sid.startsWith('source-')) {
			// Simulated container source, never execute a user script on the test host.
			const { createInterface } = await import('node:readline');
			const lines = createInterface({ input: process.stdin });
			let configured = false;
			for await (const line of lines) {
				if (configured) continue;
				configured = true;
				const { source } = JSON.parse(line);
				if (source.kind === 'command') {
					out(
						JSON.stringify({
							stdout:
								source.command === 'fixture-items'
									? '[{"id":"one"},{"id":"two"}]'
									: 'unchanged',
							stderr: '',
							exitCode: 0,
						}),
					);
					process.exit(0);
				}
				if (source.kind === 'http') {
					out(JSON.stringify({ body: '{"status":"ready"}' }));
					process.exit(0);
				}
				if (source.kind === 'sse') {
					out(JSON.stringify({ status: 'connected' }));
					out(JSON.stringify({ eventId: 'fixture-1', data: { id: 'one' } }));
				}
				if (source.kind === 'files') {
					out(JSON.stringify({ snapshot: {}, status: 'watching' }));
				}
			}
		} else if (sid.startsWith('mcp-')) {
			process.execve(
				'/usr/bin/env',
				[
					'env',
					'python3',
					new URL('./bot-relay-host.py', import.meta.url).pathname,
					sid.slice(4),
				],
				process.env,
			);
		} else if (sid.startsWith('signin-')) {
			const config = read('config', args[index]);
			const claude =
				JSON.stringify(command.slice(3)) ===
				JSON.stringify(['claude', 'auth', 'login', '--claudeai']);
			if (!claude && !config?.some((f) => f.content.includes('"file"')))
				process.exit(3);
			out('Open https://example.invalid/device and enter TEST-CODE');
			const mode = read('device-mode', 'next') ?? 'success';
			if (claude && mode === 'success') {
				out('Paste code here:');
				for await (const line of readline.createInterface({
					input: process.stdin,
				})) {
					process.exit(line.trim() === 'TEST-CODE' ? 0 : 1);
				}
			}
			if (mode === 'wait')
				await new Promise(() => {
					process.stdin.resume();
				});
			process.exit(mode === 'fail' ? 1 : 0);
		} else if (sid.startsWith('signout-')) {
			// The unit fixture's agent, or the built-in Codex agent end to end.
			const signOut = JSON.stringify(command.slice(3));
			if (
				signOut !== JSON.stringify(['codex-session', 'forget', '--all']) &&
				signOut !== JSON.stringify(['codex', 'logout']) &&
				signOut !== JSON.stringify(['claude', 'auth', 'logout'])
			)
				process.exit(2);
			if (read('device-mode', 'next') === 'fail-signout') process.exit(1);
		} else if (sid.startsWith('shell-')) {
			for await (const line of readline.createInterface({
				input: process.stdin,
			}))
				out(line === 'whoami' ? 'bot' : line);
		} else {
			fs.appendFileSync(
				calls,
				`${JSON.stringify({ agent: true, config: read('config', args[index]), keyPresent: Boolean(process.env.FAKE_KEY) })}\n`,
			);
			await import('./bot-acp.mjs');
		}
	} else {
		let input = '';
		for await (const chunk of process.stdin) input += chunk;
		if (command[0] === 'terminay-init' && command[1] === '--config')
			put('config', args[index], JSON.parse(input));
	}
} else if (kind === 'logs') {
	if (process.env.TERMINAY_FAKE_CONTAINER_LOG_BYTES)
		process.stdout.write(
			'x'.repeat(Number(process.env.TERMINAY_FAKE_CONTAINER_LOG_BYTES)),
		);
	process.stdout.write('sec');
	process.stdout.write('ret\n');
} else if (kind === 'stats') {
	out({ CPUPerc: '0%', MemUsage: '0B' });
}
