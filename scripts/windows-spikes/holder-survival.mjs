// Spike 1.3 (native-windows-desktop): a PowerShell held by a session holder
// that runs from the per-build runtime copy survives its server leaving and
// the NSIS installer running over the installation, and is adopted afterwards.
//
// Bundled with server-core and electron/sessionHolderRuntime.ts into one file,
// with koffi installed beside it, and run on Windows with Terminay installed:
//   esbuild holder-survival.mjs --bundle --platform=node --format=esm \
//     --external:koffi --external:node-pty --outfile=holder-survival.bundle.mjs
//   node holder-survival.bundle.mjs <installer.exe>
// Prints JSON.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
	createSessionHolderPtyFactory,
	currentWindowsUserSid,
	launchDetachedSessionHolder,
	readHolderRecords,
	TerminalService,
} from '../../packages/server-core/src/index.ts';
import { prepareHolderRuntime, pruneHolderRuntimes } from '../../electron/sessionHolderRuntime.ts';

const installer = process.argv[2];
const install = join(process.env.LOCALAPPDATA, 'Programs', 'Terminay');
const executablePath = join(install, 'Terminay.exe');
const dataRoot = join(process.env.USERPROFILE, 'terminay-holder-spike');
const SERVER_ID = 'spike';
const bytesOf = (value) => new TextEncoder().encode(value);
const text = (bytes) => new TextDecoder().decode(bytes);
const result = {};

async function holderExit(pid, limitMs = 15_000) {
	const started = Date.now();
	while (Date.now() - started < limitMs) {
		try {
			process.kill(pid, 0);
		} catch {
			return Date.now() - started;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return null;
}

rmSync(dataRoot, { recursive: true, force: true });
mkdirSync(dataRoot, { recursive: true });
const userSid = currentWindowsUserSid();
const addressing = { platform: 'win32', userSid };
const buildId = `spike:${statSync(executablePath).mtimeMs}`;

const started = Date.now();
const runtime = prepareHolderRuntime({
	executablePath,
	resourcesPath: join(install, 'resources'),
	dataRoot,
	buildId,
});
result.runtimeCopyMs = Date.now() - started;
result.runtime = runtime;

function server() {
	const factory = createSessionHolderPtyFactory({
		dataRoot,
		buildId,
		limitMs: 600_000,
		requireMutualProof: true,
		addressing,
		launch: ({ env }) =>
			launchDetachedSessionHolder(runtime.executablePath, [runtime.entryPath], {
				...process.env,
				ELECTRON_RUN_AS_NODE: '1',
				...env,
			}),
	});
	return { factory, service: new TerminalService({ serverId: SERVER_ID, ptyFactory: factory }) };
}

function watch(service, sessionId) {
	let output = '';
	const waiters = new Set();
	service.subscribe(sessionId, {
		onEvent: (event) => {
			if (event.type !== 'output') return;
			output += text(event.bytes);
			for (const waiter of [...waiters])
				if (output.includes(waiter.value)) {
					waiters.delete(waiter);
					waiter.resolve();
				}
		},
	});
	return (value, ms = 30_000) =>
		output.includes(value)
			? Promise.resolve()
			: new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error(`timed out waiting for ${value}; saw: ${output.slice(-400)}`)), ms);
					waiters.add({ value, resolve: () => { clearTimeout(timer); resolve(); } });
				});
}

try {
	const first = server();
	await first.service.createSession({
		projectId: 'p1',
		sessionId: 's1',
		shellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
		args: ['-NoLogo', '-NoProfile'],
		cwd: dataRoot,
		cols: 120,
		rows: 30,
	});
	const seen = watch(first.service, 's1');
	await first.service.write('s1', bytesOf('echo "marker-$(40+2)"\r'));
	await seen('marker-42');
	const [record] = readHolderRecords(dataRoot, addressing);
	result.holder = { pid: record.pid, address: record.socketPath };
	result.shellPid = first.service.getSession('s1').pid;

	await first.service.shutdown({ detach: true });
	await first.factory.detach();

	// The installer replaces the installation while the holder runs from its copy.
	const installStarted = Date.now();
	execFileSync(installer, ['/S'], { stdio: 'ignore' });
	result.reinstallMs = Date.now() - installStarted;
	result.installedAfter = existsSync(executablePath);

	const second = server();
	const held = await second.factory.start();
	result.heldAfterReinstall = held.map((session) => session.sessionId);
	const { process: pty, record: heldRecord, from } = await second.factory.adopt('s1');
	second.service.adoptSession({
		identity: { serverId: SERVER_ID, projectId: heldRecord.projectId, sessionId: heldRecord.sessionId },
		cwd: heldRecord.cwd,
		createdAt: heldRecord.createdAt,
		cols: heldRecord.cols,
		rows: heldRecord.rows,
		process: pty,
		outputPosition: from,
	});
	const after = watch(second.service, 's1');
	await second.service.write('s1', bytesOf('echo "back-$(2+3)"\r'));
	await after('back-5');
	result.adoptedShellPid = second.service.getSession('s1').pid;
	result.survived = result.adoptedShellPid === result.shellPid;

	await second.service.shutdown();
	await second.factory.endAll();
	// Windows refuses to delete a running image, so prune only once the holder is gone.
	result.prunedWhileHolderRan = (() => {
		pruneHolderRuntimes(dataRoot, 'another-build');
		return !existsSync(runtime.executablePath);
	})();
	result.holderExitMs = await holderExit(result.holder.pid);
	pruneHolderRuntimes(dataRoot, 'another-build');
	result.prunedAfterHolderExit = !existsSync(runtime.executablePath);
} catch (error) {
	result.error = String(error?.stack ?? error).slice(0, 1500);
}

console.log(JSON.stringify(result, null, 2));
process.exit(0);
