// Drives the production embedded composition (real node-pty, real `ps`
// foreground resolver) with the bug report's deterministic repaint loop and
// reports main-process CPU, chunk rate, and `ps` spawn rate.
//
// usage: node [--cpu-prof --cpu-prof-dir=DIR] profile-output.mjs <repoRoot> <seconds> [prefillBytes]
import cp from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = process.argv[2];
const seconds = Number(process.argv[3] ?? 10);
const prefillBytes = Number(process.argv[4] ?? 1_300_000);
const profilePath = process.argv[5];
const { Session } = await import("node:inspector/promises");
const { writeFileSync } = await import("node:fs");
const inspector = new Session();
inspector.connect();

const spawns = new Map();
const originalExecFile = cp.execFile;
const countedExecFile = function (file, ...rest) {
	spawns.set(file, (spawns.get(file) ?? 0) + 1);
	return originalExecFile.call(this, file, ...rest);
};
countedExecFile[promisify.custom] = (file, ...rest) => {
	spawns.set(file, (spawns.get(file) ?? 0) + 1);
	return originalExecFile[promisify.custom](file, ...rest);
};
cp.execFile = countedExecFile;
syncBuiltinESMExports();

const { build } = await import(
	pathToFileURL(join(repoRoot, 'node_modules/esbuild/lib/main.js')).href
);
const cacheRoot = join(repoRoot, 'node_modules', '.cache');
await mkdir(cacheRoot, { recursive: true });
const directory = await mkdtemp(join(cacheRoot, 'terminay-output-profile-'));
const outfile = join(directory, 'authority.mjs');
await build({
	absWorkingDir: repoRoot,
	bundle: true,
	format: 'esm',
	packages: 'external',
	outfile,
	platform: 'node',
	sourcemap: 'inline',
	banner: {
		js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
	},
	stdin: {
		contents: `export { ServerTerminalAuthority } from ${JSON.stringify(join(repoRoot, 'electron/serverTerminalAuthority.ts'))}`,
		loader: 'ts',
		resolveDir: repoRoot,
	},
	target: 'node24',
});
const { ServerTerminalAuthority } = await import(pathToFileURL(outfile).href);

const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-output-profile-data-'));
const definition = {
	id: 'system',
	name: 'System default',
	target: { kind: 'system' },
	args: [],
	startupMode: 'login',
	environment: {},
};
const profile = {
	...definition,
	kind: 'system',
	readOnly: true,
	source: 'system',
	availability: { available: true },
	projectReferences: [],
	environmentEntryCount: 0,
	hasEnvironmentOverlay: false,
};
const authority = new ServerTerminalAuthority({
	serverId: 'output-profile',
	dataRoot,
	shellProfiles: {
		async catalogue() {
			return {
				settingsRevision: 3,
				defaultProfileId: 'system',
				cwdPolicy: 'current',
				entries: [profile],
			};
		},
		async resolveProfile(_id, catalogue) {
			return {
				profile,
				definition,
				settingsRevision: catalogue.settingsRevision,
				target: { kind: 'executable', executable: '/bin/sh' },
			};
		},
	},
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let chunks = 0;
let bytes = 0;
try {
	await authority.initializeWorkspace();
	await authority.create({
		projectId: 'output-profile-project',
		sessionId: 'tui',
		shellPath: '/bin/sh',
		cwd: tmpdir(),
		cols: 120,
		rows: 40,
	});
	authority.attachRenderer('tui', 1, (event) => {
		if (event.type !== 'output') return;
		chunks += 1;
		bytes += (event.bytes ?? event.data).length;
	});
	await sleep(500);
	if (prefillBytes > 0) {
		await authority.write(
			'tui',
			`head -c ${prefillBytes} /dev/zero | tr '\\0' x; echo\n`,
		);
		while (bytes < prefillBytes) await sleep(100);
	}
	// The bug report's reproduction loop: small full-screen repaints.
	await authority.write(
		'tui',
		`end=$((SECONDS + ${seconds + 5})); while [ $SECONDS -lt $end ]; do printf '\\033[H\\033[2J'; seq 1 40; sleep 0.005; done\n`,
	);
	await sleep(1000);
	const startChunks = chunks;
	const startBytes = bytes;
	const startSpawns = new Map(spawns);
	if (profilePath) {
		await inspector.post("Profiler.enable");
		await inspector.post("Profiler.setSamplingInterval", { interval: 200 });
		await inspector.post("Profiler.start");
	}
	const startCpu = process.cpuUsage();
	const startedAt = performance.now();
	await sleep(seconds * 1000);
	const elapsed = (performance.now() - startedAt) / 1000;
	const cpu = process.cpuUsage(startCpu);
	if (profilePath) {
		const { profile: recorded } = await inspector.post("Profiler.stop");
		writeFileSync(profilePath, JSON.stringify(recorded));
	}
	const spawnRates = {};
	for (const [file, count] of spawns)
		spawnRates[file] = Number(
			((count - (startSpawns.get(file) ?? 0)) / elapsed).toFixed(1),
		);
	console.log(
		JSON.stringify(
			{
				seconds: Number(elapsed.toFixed(2)),
				prefillBytes,
				chunksPerSecond: Math.round((chunks - startChunks) / elapsed),
				bytesPerSecond: Math.round((bytes - startBytes) / elapsed),
				mainCpuPercent: Number(
					(((cpu.user + cpu.system) / 1e6 / elapsed) * 100).toFixed(1),
				),
				userCpuPercent: Number(((cpu.user / 1e6 / elapsed) * 100).toFixed(1)),
				systemCpuPercent: Number(
					((cpu.system / 1e6 / elapsed) * 100).toFixed(1),
				),
				spawnsPerSecond: spawnRates,
			},
			null,
			2,
		),
	);
	await authority.kill('tui').catch(() => undefined);
} finally {
	await authority.shutdown().catch(() => undefined);
	await rm(directory, { recursive: true, force: true });
	await rm(dataRoot, { recursive: true, force: true });
}
process.exit(0);
