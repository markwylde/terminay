import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { ParakeetRuntimeStatus } from '../../src/types/terminay';

export const PARAKEET_MODEL = 'mlx-community/parakeet-tdt-0.6b-v3' as const;
export const PARAKEET_MLX_VERSION = '0.5.2';
const MAX_WORKER_LINE_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 120_000;
const WORKER_INSTALL_TIMEOUT_MS = 600_000;

const WORKER_SOURCE = `import json
import sys
from parakeet_mlx import from_pretrained

MODEL = "mlx-community/parakeet-tdt-0.6b-v3"

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

try:
    model = from_pretrained(MODEL)
    emit({"type": "ready", "model": MODEL})
except Exception as error:
    emit({"type": "fatal", "error": str(error)[:2000]})
    raise

for line in sys.stdin:
    try:
        request = json.loads(line)
        request_id = request["id"]
        audio_path = request["audioPath"]
        result = model.transcribe(audio_path)
        emit({"type": "result", "id": request_id, "text": result.text})
    except Exception as error:
        emit({"type": "error", "id": request.get("id", ""), "error": str(error)[:2000]})
`;

type PendingRequest = {
	reject: (error: Error) => void;
	resolve: (text: string) => void;
	timer: NodeJS.Timeout;
};

export type ParakeetRuntimeOptions = {
	rootDirectory: string;
	platform?: NodeJS.Platform;
	arch?: string;
	homeDirectory?: string;
	spawnProcess?: SpawnProcess;
};

type SpawnProcess = (
	command: string,
	args: readonly string[],
	options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export class ParakeetRuntime {
	private readonly rootDirectory: string;
	private readonly platform: NodeJS.Platform;
	private readonly arch: string;
	private readonly homeDirectory: string;
	private readonly spawnProcess: SpawnProcess;
	private child: ChildProcessWithoutNullStreams | null = null;
	private installPromise: Promise<ParakeetRuntimeStatus> | null = null;
	private startPromise: Promise<void> | null = null;
	private readonly pending = new Map<string, PendingRequest>();
	private sequence = 0;
	private lastError: string | undefined;

	constructor(options: ParakeetRuntimeOptions) {
		this.rootDirectory = path.resolve(options.rootDirectory);
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
		this.spawnProcess = options.spawnProcess ?? (spawn as unknown as SpawnProcess);
	}

	async getStatus(): Promise<ParakeetRuntimeStatus> {
		if (!this.isSupported()) {
			return { model: PARAKEET_MODEL, state: 'unsupported', message: 'On-device Parakeet requires an Apple Silicon Mac.' };
		}
		if (this.installPromise !== null) return { model: PARAKEET_MODEL, state: 'installing' };
		if (this.child !== null) return { model: PARAKEET_MODEL, state: 'ready' };
		if (this.lastError) return { model: PARAKEET_MODEL, state: 'error', message: this.lastError };
		try {
			await access(this.pythonPath(), fsConstants.X_OK);
			await access(this.workerPath(), fsConstants.R_OK);
			await access(this.markerPath(), fsConstants.R_OK);
			return { model: PARAKEET_MODEL, state: 'ready' };
		} catch {
			return { model: PARAKEET_MODEL, state: 'not-installed', message: 'Install the on-device engine and model to use Parakeet.' };
		}
	}

	install(): Promise<ParakeetRuntimeStatus> {
		if (this.installPromise !== null) return this.installPromise;
		this.installPromise = this.installInternal().finally(() => { this.installPromise = null; });
		return this.installPromise;
	}

	async transcribe(audioPath: string): Promise<string> {
		const status = await this.getStatus();
		if (status.state !== 'ready') throw new Error(status.message ?? 'The on-device Parakeet engine is not ready.');
		await this.ensureWorker();
		const child = this.child;
		if (child === null) throw new Error('The on-device Parakeet worker is unavailable.');
		const id = `dictation-${Date.now()}-${++this.sequence}`;
		return new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error('On-device Parakeet transcription timed out.'));
			}, WORKER_TIMEOUT_MS);
			this.pending.set(id, { reject, resolve, timer });
			child.stdin.write(`${JSON.stringify({ id, audioPath: path.resolve(audioPath) })}\n`);
		});
	}

	stop(): void {
		const child = this.child;
		this.child = null;
		this.startPromise = null;
		child?.kill('SIGTERM');
		this.rejectPending(new Error('On-device Parakeet stopped.'));
	}

	private isSupported(): boolean { return this.platform === 'darwin' && this.arch === 'arm64'; }
	private venvDirectory(): string { return path.join(this.rootDirectory, 'venv'); }
	private pythonPath(): string { return path.join(this.venvDirectory(), 'bin', 'python'); }
	private workerPath(): string { return path.join(this.rootDirectory, 'worker.py'); }
	private markerPath(): string { return path.join(this.rootDirectory, `parakeet-mlx-${PARAKEET_MLX_VERSION}.installed`); }

	private async installInternal(): Promise<ParakeetRuntimeStatus> {
		if (!this.isSupported()) return { model: PARAKEET_MODEL, state: 'unsupported', message: 'On-device Parakeet requires an Apple Silicon Mac.' };
		this.stop();
		this.lastError = undefined;
		try {
			const uv = await this.findExecutable([
				path.join(this.homeDirectory, '.local', 'bin', 'uv'),
				'/opt/homebrew/bin/uv',
				'/usr/local/bin/uv',
			]);
			if (!uv) throw new Error('The uv runtime manager is required. Install it from https://docs.astral.sh/uv/ and try again.');
			const ffmpeg = await this.findExecutable(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
			if (!ffmpeg) throw new Error('ffmpeg is required to decode microphone audio. Install it with “brew install ffmpeg” and try again.');
			await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
			await writeFile(this.workerPath(), WORKER_SOURCE, { encoding: 'utf8', mode: 0o600 });
			await this.run(uv, ['venv', '--clear', '--python', '3.12', this.venvDirectory()]);
			await this.run(uv, ['pip', 'install', '--python', this.pythonPath(), `parakeet-mlx==${PARAKEET_MLX_VERSION}`]);
			await writeFile(this.markerPath(), `${PARAKEET_MLX_VERSION}\n`, { mode: 0o600 });
			await this.ensureWorker(path.dirname(ffmpeg), WORKER_INSTALL_TIMEOUT_MS);
			return { model: PARAKEET_MODEL, state: 'ready' };
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.stop();
			return { model: PARAKEET_MODEL, state: 'error', message: this.lastError };
		}
	}

	private async ensureWorker(
		ffmpegDirectory?: string,
		startupTimeoutMs = WORKER_TIMEOUT_MS,
	): Promise<void> {
		if (this.child !== null) return;
		if (this.startPromise !== null) return this.startPromise;
		this.startPromise = new Promise<void>((resolve, reject) => {
			const env = {
				HOME: this.homeDirectory,
				PATH: [ffmpegDirectory, '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':'),
				HF_HOME: path.join(this.rootDirectory, 'huggingface'),
				PYTHONNOUSERSITE: '1',
			} as unknown as NodeJS.ProcessEnv;
			const child = this.spawnProcess(this.pythonPath(), ['-I', '-u', this.workerPath()], { cwd: this.rootDirectory, env });
			this.child = child;
			let settled = false;
			const startupTimer = setTimeout(() => fail(new Error('Timed out while loading the Parakeet model.')), startupTimeoutMs);
			const fail = (error: Error) => {
				if (!settled) { settled = true; clearTimeout(startupTimer); reject(error); }
				this.lastError = error.message;
				this.stop();
			};
			const lines = readline.createInterface({ input: child.stdout });
			lines.on('line', (line) => {
				if (Buffer.byteLength(line) > MAX_WORKER_LINE_BYTES) return fail(new Error('Parakeet returned an oversized response.'));
				let message: Record<string, unknown>;
				try { message = JSON.parse(line) as Record<string, unknown>; } catch { return fail(new Error('Parakeet returned an invalid response.')); }
				if (message.type === 'ready') { if (!settled) { settled = true; clearTimeout(startupTimer); resolve(); } return; }
				if (message.type === 'fatal') return fail(new Error(typeof message.error === 'string' ? message.error : 'Unable to load Parakeet.'));
				const id = typeof message.id === 'string' ? message.id : '';
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id); clearTimeout(pending.timer);
				if (message.type === 'result' && typeof message.text === 'string') pending.resolve(message.text.trim());
				else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Parakeet transcription failed.'));
			});
			child.once('error', (error) => fail(error));
			child.once('exit', () => fail(new Error('The on-device Parakeet worker exited.')));
		});
		try { await this.startPromise; } finally { this.startPromise = null; }
	}

	private async findExecutable(candidates: string[]): Promise<string | null> {
		for (const candidate of candidates) {
			try { await access(candidate, fsConstants.X_OK); return candidate; } catch { /* try next fixed path */ }
		}
		return null;
	}

	private run(command: string, args: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const env = {
				HOME: this.homeDirectory,
				PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
			} as unknown as NodeJS.ProcessEnv;
			const child = this.spawnProcess(command, args, { cwd: this.rootDirectory, env });
			let stderr = '';
			child.stdout.resume();
			child.stderr.on('data', (chunk) => { if (stderr.length < 4000) stderr += String(chunk); });
			child.once('error', reject);
			child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Runtime setup failed with exit code ${code ?? 'unknown'}.`)));
		});
	}

	private rejectPending(error: Error): void {
		for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
		this.pending.clear();
	}
}
