import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { ServerParakeetRuntimeStatus as ParakeetRuntimeStatus } from './parakeetProvider.js';

export const PARAKEET_MODEL = 'mlx-community/parakeet-tdt-0.6b-v3' as const;
export const PARAKEET_MODEL_REVISION = 'ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15';
export const PARAKEET_MODEL_LICENSE = 'CC-BY-4.0';
export const PARAKEET_MLX_VERSION = '0.5.2';
export const PARAKEET_MLX_LICENSE = 'Apache-2.0';
export const PARAKEET_AUDIO_FORMAT = 'WAV PCM signed 16-bit mono 16 kHz';
export type ParakeetRuntimeDisclosure = {
	audioFormat: typeof PARAKEET_AUDIO_FORMAT;
	engine: { license: typeof PARAKEET_MLX_LICENSE; package: 'parakeet-mlx'; version: typeof PARAKEET_MLX_VERSION };
	modelLicense: typeof PARAKEET_MODEL_LICENSE;
	modelRevision: typeof PARAKEET_MODEL_REVISION;
};
const MAX_WORKER_LINE_BYTES = 1024 * 1024;
const WORKER_TIMEOUT_MS = 120_000;
const WORKER_INSTALL_TIMEOUT_MS = 600_000;

export function parakeetFfmpegArguments(inputPath: string, outputPath: string): string[] {
	return ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', path.resolve(inputPath), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', path.resolve(outputPath)];
}

const WORKER_SOURCE = `import json
import sys
from huggingface_hub import snapshot_download
from parakeet_mlx import from_pretrained

MODEL = "mlx-community/parakeet-tdt-0.6b-v3"
MODEL_REVISION = "ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15"

def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

try:
    model_path = snapshot_download(repo_id=MODEL, revision=MODEL_REVISION)
    model = from_pretrained(model_path)
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
	private installStatus: ParakeetRuntimeStatus | null = null;

	constructor(options: ParakeetRuntimeOptions) {
		this.rootDirectory = path.resolve(options.rootDirectory);
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.homeDirectory = path.resolve(options.homeDirectory ?? os.homedir());
		this.spawnProcess = options.spawnProcess ?? (spawn as unknown as SpawnProcess);
	}

	async getStatus(): Promise<ParakeetRuntimeStatus> {
		if (!this.isSupported()) {
			return this.status('unsupported', 'On-device Parakeet requires an Apple Silicon Mac.');
		}
		if (this.installPromise !== null) return this.installStatus ?? this.status('installing', undefined, 0);
		if (this.child !== null) return this.status('ready');
		if (this.lastError) return this.status('error', this.lastError);
		try {
			await access(this.pythonPath(), fsConstants.X_OK);
			await access(this.workerPath(), fsConstants.R_OK);
			await access(this.markerPath(), fsConstants.R_OK);
			if (!await this.findFfmpeg()) return this.status('error', 'Audio conversion is unavailable. Install ffmpeg with “brew install ffmpeg” and try again.');
			return this.status('ready');
		} catch {
			return this.status('not-installed', 'Install the on-device engine and model to use Parakeet.');
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
		const ffmpeg = await this.findFfmpeg();
		if (!ffmpeg) throw new Error('Audio conversion is unavailable. Install ffmpeg with “brew install ffmpeg” and try again.');
		await this.ensureWorker(path.dirname(ffmpeg));
		const child = this.child;
		if (child === null) throw new Error('The on-device Parakeet worker is unavailable.');
		const id = `dictation-${Date.now()}-${++this.sequence}`;
		const conversionDirectory = await mkdtemp(path.join(this.rootDirectory, 'audio-'));
		const convertedPath = path.join(conversionDirectory, 'input.wav');
		try {
			await this.run(ffmpeg, parakeetFfmpegArguments(audioPath, convertedPath));
			return await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new Error('On-device Parakeet transcription timed out.'));
				}, WORKER_TIMEOUT_MS);
				this.pending.set(id, { reject, resolve, timer });
				child.stdin.write(`${JSON.stringify({ id, audioPath: convertedPath })}\n`);
			});
		} finally {
			await rm(conversionDirectory, { force: true, recursive: true });
		}
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
		if (!this.isSupported()) return this.status('unsupported', 'On-device Parakeet requires an Apple Silicon Mac.');
		this.stop();
		this.lastError = undefined;
		this.updateInstallStatus(0.05, 'Checking on-device setup requirements…');
		try {
			const uv = await this.findExecutable([
				path.join(this.homeDirectory, '.local', 'bin', 'uv'),
				'/opt/homebrew/bin/uv',
				'/usr/local/bin/uv',
			]);
			if (!uv) throw new Error('The uv runtime manager is required. Install it from https://docs.astral.sh/uv/ and try again.');
			const ffmpeg = await this.findFfmpeg();
			if (!ffmpeg) throw new Error('ffmpeg is required to decode microphone audio. Install it with “brew install ffmpeg” and try again.');
			await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
			await writeFile(this.workerPath(), WORKER_SOURCE, { encoding: 'utf8', mode: 0o600 });
			this.updateInstallStatus(0.2, 'Creating the private Python environment…');
			await this.run(uv, ['venv', '--clear', '--python', '3.12', this.venvDirectory()]);
			this.updateInstallStatus(0.4, 'Installing the pinned MLX speech engine…');
			await this.run(uv, ['pip', 'install', '--python', this.pythonPath(), `parakeet-mlx==${PARAKEET_MLX_VERSION}`]);
			await writeFile(this.markerPath(), `${PARAKEET_MLX_VERSION}\n`, { mode: 0o600 });
			this.updateInstallStatus(0.7, 'Downloading and loading the Parakeet model. The first setup may take several minutes…');
			await this.ensureWorker(path.dirname(ffmpeg), WORKER_INSTALL_TIMEOUT_MS);
			this.installStatus = null;
			return this.status('ready');
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.stop();
			this.installStatus = null;
			return this.status('error', this.lastError);
		}
	}

	private updateInstallStatus(progress: number, message: string): void {
		this.installStatus = this.status('installing', message, progress);
	}

	private status(state: ParakeetRuntimeStatus['state'], message?: string, progress?: number): ParakeetRuntimeStatus & ParakeetRuntimeDisclosure {
		return {
			audioFormat: PARAKEET_AUDIO_FORMAT,
			engine: { license: PARAKEET_MLX_LICENSE, package: 'parakeet-mlx', version: PARAKEET_MLX_VERSION },
			model: PARAKEET_MODEL,
			modelLicense: PARAKEET_MODEL_LICENSE,
			modelRevision: PARAKEET_MODEL_REVISION,
			state,
			...(message === undefined ? {} : { message }),
			...(progress === undefined ? {} : { progress }),
		};
	}

	private findFfmpeg(): Promise<string | null> {
		return this.findExecutable(['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']);
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
			// Hugging Face and MLX write download diagnostics to stderr. Always drain
			// the pipe: leaving it unread can fill its buffer and suspend the worker.
			child.stderr.on('data', () => { /* diagnostics are intentionally bounded and discarded */ });
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
