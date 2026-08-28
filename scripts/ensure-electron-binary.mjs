import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const electronDir = path.resolve(process.cwd(), 'node_modules/electron');
const pathFile = path.join(electronDir, 'path.txt');
const platformPath = process.platform === 'darwin' || process.platform === 'mas'
	? 'Electron.app/Contents/MacOS/Electron'
	: process.platform === 'win32'
		? 'electron.exe'
		: 'electron';
const binaryPath = path.join(electronDir, 'dist', platformPath);

function log(message) {
	console.log(`[electron ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

function executableExists() {
	return existsSync(binaryPath);
}

if (!existsSync(path.join(electronDir, 'install.js'))) {
	throw new Error('node_modules/electron/install.js is missing. Run npm ci first.');
}

if (executableExists() && !existsSync(pathFile)) {
	writeFileSync(pathFile, platformPath);
	log(`repaired path.txt -> ${platformPath}`);
}

if (executableExists() && existsSync(pathFile)) {
	log(`binary already present at ${binaryPath}`);
	process.exit(0);
}

log(`downloading Electron for ${os.platform()}-${os.arch()} (progress below, heartbeat every 10s)`);
await new Promise((resolve, reject) => {
	const child = spawn(process.execPath, [path.join(electronDir, 'install.js')], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const started = Date.now();
	const heartbeat = setInterval(() => {
		const seconds = Math.round((Date.now() - started) / 1000);
		log(`still downloading (${seconds}s elapsed)`);
	}, 10_000);
	const write = (chunk, stream) => {
		stream.write(String(chunk).replaceAll('\r', '\n'));
	};
	child.stdout.on('data', (chunk) => write(chunk, process.stdout));
	child.stderr.on('data', (chunk) => write(chunk, process.stderr));
	child.on('error', (error) => {
		clearInterval(heartbeat);
		reject(error);
	});
	child.on('exit', (code, signal) => {
		clearInterval(heartbeat);
		if (code === 0) {
			log('download complete');
			resolve();
			return;
		}
		reject(new Error(`electron install.js failed (${signal ? `signal ${signal}` : `exit ${code}`})`));
	});
});
