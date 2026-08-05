import { randomUUID } from 'node:crypto';
import {
	closeSync,
	mkdirSync,
	openSync,
	type WriteStream,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { App, CrashReporter } from 'electron';
import {
	beginLaunchMarker,
	completeLaunchMarker,
	type DiagnosticEventInput,
	type DiagnosticRateChannel,
	DiagnosticSourceRateLimiter,
	encodeDiagnosticEvent,
	ensurePrivateDiagnosticsDirectory,
	normalizeDiagnosticEvent,
	sanitizeDiagnosticText,
	SegmentedJsonlWriter,
} from './core';

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export interface DesktopDiagnosticsRecordOptions {
	readonly channel?: DiagnosticRateChannel;
}

export interface DesktopDiagnosticsInitOptions {
	readonly app: App;
	readonly crashReporter: CrashReporter;
	readonly now?: () => number;
	readonly launchId?: string;
}

type StreamWrite = WriteStream['write'];

function boundedFallbackError(error: unknown): string {
	let message = 'unknown failure';
	try {
		message = error instanceof Error ? error.message : String(error);
	} catch {
		// Hostile errors cannot prevent the fallback from remaining bounded.
	}
	return sanitizeDiagnosticText(message)
		.replace(/[\r\n\0]+/gu, ' ')
		.slice(0, 512);
}

/**
 * The sole privileged owner of Desktop's readable diagnostic history.
 * Renderers can submit only the separately validated root-error event.
 */
export class DesktopDiagnostics {
	readonly directory: string;
	readonly crashpadDirectory: string;
	readonly launchId: string;

	private readonly writer: SegmentedJsonlWriter;
	private readonly limiter: DiagnosticSourceRateLimiter;
	private readonly now: () => number;
	private readonly originalStdoutWrite: StreamWrite;
	private readonly originalStderrWrite: StreamWrite;
	private cleanupTimer: ReturnType<typeof setInterval> | undefined;
	private outputBound = false;
	private closed = false;

	constructor(options: {
		readonly directory: string;
		readonly crashpadDirectory: string;
		readonly launchId: string;
		readonly now?: () => number;
	}) {
		this.directory = options.directory;
		this.crashpadDirectory = options.crashpadDirectory;
		this.launchId = options.launchId;
		this.now = options.now ?? Date.now;
		this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
		this.originalStderrWrite = process.stderr.write.bind(process.stderr);
		this.writer = new SegmentedJsonlWriter({
			crashpadDirectory: this.crashpadDirectory,
			directory: this.directory,
			launchId: this.launchId,
			now: this.now,
			onWarning: (message) => {
				this.originalStderrWrite(`[Terminay diagnostics] ${message}\n`);
			},
		});
		this.limiter = new DiagnosticSourceRateLimiter({ now: this.now });
	}

	async initialize(metadata: Readonly<Record<string, unknown>>): Promise<void> {
		try {
			await ensurePrivateDiagnosticsDirectory(this.directory);
			await ensurePrivateDiagnosticsDirectory(this.crashpadDirectory);
			await this.writer.initialize();
			const marker = await beginLaunchMarker(
				this.directory,
				this.launchId,
				this.now(),
			);
			if (marker.previousInterrupted) {
				await this.record(
					{
						component: 'diagnostics',
						event: 'diagnostics.launch.previous-interrupted',
						fields: { previousLaunchId: marker.previous?.launchId },
						severity: 'warning',
						source: 'diagnostics',
					},
					{ channel: 'lifecycle' },
				);
			}
			await this.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.launch.started',
					fields: metadata,
					severity: 'info',
					source: 'diagnostics',
				},
				{ channel: 'lifecycle' },
			);
		} catch (error) {
			this.warnDegraded('initialization', error);
		}
		this.bindProcessOutput();
		this.cleanupTimer = setInterval(() => {
			void this.cleanup();
		}, CLEANUP_INTERVAL_MS);
		this.cleanupTimer.unref?.();
	}

	record(
		input: DiagnosticEventInput,
		options: DesktopDiagnosticsRecordOptions = {},
	): Promise<void> {
		if (this.closed) return Promise.resolve();
		const channel = options.channel ?? 'text';
		const source = input.source ?? input.component;
		const normalized = normalizeDiagnosticEvent(input, this.launchId, {
			now: this.now,
		});
		const bytes = Buffer.byteLength(encodeDiagnosticEvent(normalized));
		const decision = this.limiter.admit(source, bytes, channel);
		const writes = decision.summaries.map((summary) =>
			this.writer.write({
				component: 'diagnostics',
				event: 'diagnostics.source.suppressed',
				fields: summary,
				severity: 'warning',
				source: 'diagnostics',
			}),
		);
		if (decision.allowed) writes.push(this.writer.write(input));
		return Promise.all(writes).then(() => undefined);
	}

	async cleanup(): Promise<void> {
		try {
			const result = await this.writer.cleanup();
			for (const summary of this.limiter.drainSuppressionSummaries()) {
				await this.writer.write({
					component: 'diagnostics',
					event: 'diagnostics.source.suppressed',
					fields: summary,
					severity: 'warning',
					source: 'diagnostics',
				});
			}
			if (result.deleted.length > 0 || result.failed.length > 0) {
				await this.writer.write({
					component: 'diagnostics',
					event:
						result.failed.length === 0
							? 'diagnostics.retention.completed'
							: 'diagnostics.cleanup.failed',
					fields: {
						deletedCount: result.deleted.length,
						failedCount: result.failed.length,
						remainingBytes: result.remainingBytes,
					},
					severity: result.failed.length === 0 ? 'info' : 'warning',
					source: 'diagnostics',
				});
			}
		} catch (error) {
			await this.record(
				{
					component: 'diagnostics',
					event: 'diagnostics.cleanup.failed',
					message: error,
					severity: 'warning',
					source: 'diagnostics',
				},
				{ channel: 'lifecycle' },
			);
		}
	}

	async clear(): Promise<void> {
		await this.clearManagedArtifacts();
		await this.recordCleared();
	}

	async clearManagedArtifacts(): Promise<void> {
		await this.writer.clear();
	}

	recordCleared(): Promise<void> {
		return this.writer.write({
			component: 'diagnostics',
			event: 'diagnostics.cleared',
			severity: 'info',
			source: 'diagnostics',
		});
	}

	/** Mark clean only after every other privileged service has stopped cleanly. */
	async close(options: { readonly clean: boolean }): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
		this.unbindProcessOutput();
		if (options.clean) {
			await this.writer.write({
				component: 'diagnostics',
				event: 'diagnostics.launch.clean-exit',
				severity: 'info',
				source: 'diagnostics',
			});
			try {
				await completeLaunchMarker(this.directory, this.launchId, this.now());
			} catch (error) {
				this.warnDegraded('clean marker', error);
			}
		}
		await this.writer.close();
	}

	recordFatalSync(input: DiagnosticEventInput): void {
		try {
			const event = normalizeDiagnosticEvent(input, this.launchId, {
				now: this.now,
			});
			const safeLaunchId = this.launchId
				.replace(/[^a-zA-Z0-9_-]/gu, '_')
				.slice(0, 96);
			for (let sequence = 0; sequence < 10; sequence += 1) {
				const filename = `terminay-diagnostics-v1-${this.now()}-${safeLaunchId}_fatal-${(
					9_990 + sequence
				)
					.toString()
					.padStart(4, '0')}.jsonl`;
				try {
					const descriptor = openSync(
						path.join(this.directory, filename),
						'wx',
						0o600,
					);
					try {
						writeFileSync(descriptor, encodeDiagnosticEvent(event), 'utf8');
					} finally {
						closeSync(descriptor);
					}
					return;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
				}
			}
		} catch {
			// Fatal-path diagnostics must never replace Node/Electron's fatal handling.
		}
	}

	private bindProcessOutput(): void {
		if (this.outputBound) return;
		this.outputBound = true;
		process.stdout.write = this.wrapWrite(
			this.originalStdoutWrite,
			'main.stdout',
			'info',
		);
		process.stderr.write = this.wrapWrite(
			this.originalStderrWrite,
			'main.stderr',
			'warning',
		);
	}

	private unbindProcessOutput(): void {
		if (!this.outputBound) return;
		this.outputBound = false;
		process.stdout.write = this.originalStdoutWrite;
		process.stderr.write = this.originalStderrWrite;
	}

	private wrapWrite(
		original: StreamWrite,
		event: 'main.stdout' | 'main.stderr',
		severity: 'info' | 'warning',
	): StreamWrite {
		const diagnostics = this;
		return function write(
			chunk: Uint8Array | string,
			encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
			callback?: (error?: Error | null) => void,
		): boolean {
			const result = original(
				chunk,
				encodingOrCallback as never,
				callback as never,
			);
			let message: string;
			try {
				message =
					typeof chunk === 'string'
						? chunk
						: Buffer.from(chunk).toString(
								typeof encodingOrCallback === 'string'
									? encodingOrCallback
									: 'utf8',
							);
			} catch {
				message = '<unreadable output>';
			}
			void diagnostics.record({
				component: 'main',
				event,
				message,
				severity,
				source: event,
			});
			return result;
		} as StreamWrite;
	}

	private warnDegraded(operation: string, error: unknown): void {
		this.originalStderrWrite(
			`[Terminay diagnostics] ${operation} failed: ${boundedFallbackError(error)}\n`,
		);
	}
}

export async function initializeDesktopDiagnostics(
	options: DesktopDiagnosticsInitOptions,
): Promise<DesktopDiagnostics> {
	const now = options.now ?? Date.now;
	const launchId = options.launchId ?? randomUUID();
	let directory: string;
	try {
		directory = options.app.getPath('logs');
	} catch {
		directory = path.join(options.app.getPath('temp'), 'Terminay-diagnostics');
	}
	let crashpadDirectory: string;
	try {
		crashpadDirectory = options.app.getPath('crashDumps');
	} catch {
		crashpadDirectory = path.join(directory, 'crash-dumps');
	}
	try {
		mkdirSync(directory, { mode: 0o700, recursive: true });
		crashpadDirectory = path.join(directory, 'crash-dumps');
		mkdirSync(crashpadDirectory, { mode: 0o700, recursive: true });
		options.app.setPath('crashDumps', crashpadDirectory);
	} catch (error) {
		process.stderr.write(
			`[Terminay diagnostics] log directory setup failed: ${boundedFallbackError(error)}\n`,
		);
	}
	const crashReporter = options.crashReporter;
	try {
		crashReporter.start({
			uploadToServer: false,
		});
	} catch (error) {
		process.stderr.write(
			`[Terminay diagnostics] Crashpad setup failed: ${boundedFallbackError(error)}\n`,
		);
	}
	const diagnostics = new DesktopDiagnostics({
		crashpadDirectory,
		directory,
		launchId,
		now,
	});
	await diagnostics.initialize({
		architecture: process.arch,
		chromiumVersion: process.versions.chrome,
		electronVersion: process.versions.electron,
		nodeVersion: process.versions.node,
		operatingSystem: process.platform,
		terminayVersion: options.app.getVersion(),
	});
	return diagnostics;
}

export function bindFatalProcessDiagnostics(
	diagnostics: DesktopDiagnostics,
	options: { readonly terminate?: () => void } = {},
): () => void {
	const terminate = options.terminate ?? (() => process.abort());
	const onUncaughtException = (error: Error, origin: string) => {
		diagnostics.recordFatalSync({
			component: 'main',
			event: 'main.uncaught-exception',
			fields: { origin },
			message: error.message,
			severity: 'fatal',
			source: 'main-fatal',
			stack: error.stack,
		});
		terminate();
	};
	const onUnhandledRejection = (reason: unknown) => {
		diagnostics.recordFatalSync({
			component: 'main',
			event: 'main.unhandled-rejection',
			message: reason,
			severity: 'fatal',
			source: 'main-fatal',
			stack: reason instanceof Error ? reason.stack : undefined,
		});
		setImmediate(() => {
			throw reason instanceof Error
				? reason
				: new Error('Unhandled promise rejection in Electron main');
		});
	};
	process.prependListener('uncaughtException', onUncaughtException);
	process.on('unhandledRejection', onUnhandledRejection);
	return () => {
		process.off('uncaughtException', onUncaughtException);
		process.off('unhandledRejection', onUnhandledRejection);
	};
}
