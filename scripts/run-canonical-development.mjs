import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { stageSelectedSecureWeriftRuntime } from './stage-selected-secure-werift-runtime.mjs';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const viteCli = join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');

let stopping = false;
let developmentServer;
let serverUiWatcher;
function stop(signal = 'SIGTERM') {
	if (stopping) return;
	stopping = true;
	void serverUiWatcher?.close();
	if (developmentServer !== undefined) {
		const child = developmentServer;
		if (child.exitCode === null && child.signalCode === null)
			child.kill(signal);
	}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		stop(signal);
		process.exitCode = 0;
	});
}

process.env.TERMINAY_SERVER_UI_WATCH = '1';
process.env.TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES = '1';
process.env.TERMINAY_WEBRTC_RUNTIME_ROOT = join(
	repositoryRoot,
	'build',
	'webrtc-runtime',
);
let initialBundleReady;
let initialBundleFailed;
let initialBundlePublished = false;
const initialBundle = new Promise((resolve, reject) => {
	initialBundleReady = resolve;
	initialBundleFailed = reject;
});
try {
	const [watcher, preloadBuild, runtimeStage] = await Promise.all([
		build({
			configFile: 'vite.server-ui.config.ts',
			build: { watch: {} },
			plugins: [
				{
					name: 'terminay-start-electron-after-initial-server-ui-bundle',
					buildEnd(error) {
						if (error !== undefined) initialBundleFailed(error);
					},
					writeBundle() {
						if (!initialBundlePublished) {
							initialBundlePublished = true;
							process.stdout.write('[dev] canonical server UI ready\n');
						}
						initialBundleReady();
					},
				},
			],
		}),
		build({ configFile: 'vite.server-preload.config.ts' }),
		stageSelectedSecureWeriftRuntime(undefined, { reuseValidated: true }),
	]);
	serverUiWatcher = watcher;

	// The watcher is ready before its initial build is complete. Its write hook
	// runs after the canonical manifest is published, so Electron never observes
	// a partial asset inventory. The preload and trusted runtime build alongside
	// it, rather than serially ahead of application startup.
	await Promise.all([initialBundle, preloadBuild, runtimeStage]);
	process.stdout.write('[dev] verified secure WebRTC runtime\n');
	developmentServer = spawn(process.execPath, [viteCli], { stdio: 'inherit' });

	await new Promise((resolve, reject) => {
		developmentServer.once('error', reject);
		developmentServer.once('exit', (code, signal) => {
			if (stopping) resolve();
			else reject(new Error(`Vite development server exited (${signal ?? `exit ${code}`})`));
		});
	});
} finally {
	stop();
}
