import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDevelopmentBuiltInExtensions } from './prepare-development-built-in-extensions.mjs';
import { stageSelectedSecureWeriftRuntime } from './stage-selected-secure-werift-runtime.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const turboCli = join(repositoryRoot, 'node_modules', 'turbo', 'bin', 'turbo');
const require = createRequire(join(repositoryRoot, 'package.json'));
const electronBinary = require('electron');

let stopping = false;
let activeChild;
function stop(signal = 'SIGTERM') {
	if (stopping) return;
	stopping = true;
	if (
		activeChild !== undefined &&
		activeChild.exitCode === null &&
		activeChild.signalCode === null
	)
		activeChild.kill(signal);
}

function runCommand(cli, args, label) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [cli, ...args], {
			cwd: repositoryRoot,
			stdio: 'inherit',
		});
		activeChild = child;
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (activeChild === child) activeChild = undefined;
			if (code === 0) resolve();
			else reject(new Error(`${label} failed (${signal ?? `exit ${code}`})`));
		});
	});
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		stop(signal);
		process.exitCode = 0;
	});
}

process.env.TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES = '1';
process.env.TERMINAY_WEBRTC_RUNTIME_ROOT = join(
	repositoryRoot,
	'build',
	'webrtc-runtime',
);
delete process.env.TERMINAY_SERVER_UI_WATCH;
delete process.env.VITE_DEV_SERVER_URL;

try {
	// Electron loads packed built-ins and the Turbo-cached Desktop Vite
	// artifacts, not a watcher. One graph compiles workspaces and the
	// generated server UI / preload / Electron bundles so repeat starts
	// restore dist-web, dist-electron, and dist from cache.
	process.stdout.write('[dev] building workspaces and desktop artifacts\n');
	await runCommand(
		turboCli,
		['run', 'build:dev-desktop'],
		'turbo run build:dev-desktop',
	);
	process.stdout.write('[dev] workspace graph ready\n');
	process.stdout.write('[dev] canonical server UI ready\n');
	// Electron resolves its development built-ins from build/, not directly
	// from workspace source. Complete this atomic stage and verification
	// before launching so a clean checkout cannot boot without agents.
	const [builtInStage] = await Promise.all([
		prepareDevelopmentBuiltInExtensions({ root: repositoryRoot }),
		stageSelectedSecureWeriftRuntime(undefined, { reuseValidated: true }),
	]);
	process.stdout.write(
		`[dev] verified ${builtInStage.artifacts.length} built-in extensions\n`,
	);
	process.stdout.write('[dev] verified secure WebRTC runtime\n');

	const electronProcess = spawn(electronBinary, ['.', '--no-sandbox'], {
		cwd: repositoryRoot,
		stdio: 'inherit',
	});
	activeChild = electronProcess;

	await new Promise((resolve, reject) => {
		electronProcess.once('error', reject);
		electronProcess.once('exit', (code, signal) => {
			if (activeChild === electronProcess) activeChild = undefined;
			if (stopping || code === 0) resolve();
			else reject(new Error(`Electron exited (${signal ?? `exit ${code}`})`));
		});
	});
} finally {
	stop();
}
