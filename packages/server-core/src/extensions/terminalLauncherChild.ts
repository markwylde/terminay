import { validateTerminalLauncherResolution } from '@terminay/extension-api';
import type { HostFrame } from './protocol.js';

/**
 * The child side of terminal launchers. A launcher only answers where its
 * program is installed; the host validates the answer again and decides
 * everything about the terminal it is used for.
 */
export interface TerminalLauncherChildIo {
	result(id: string, payload?: unknown): void;
	failure(id: string, error: unknown): void;
}

interface ChildLauncherRuntime {
	resolve(signal: AbortSignal): Promise<unknown>;
}

export class TerminalLauncherChild {
	private readonly launchers = new Map<string, ChildLauncherRuntime>();
	private declared = new Set<string>();

	constructor(private readonly io: TerminalLauncherChildIo) {}

	/** Forget everything from a previous activation. */
	reset(declared: readonly string[]): void {
		this.launchers.clear();
		this.declared = new Set(declared);
	}

	registry(registered: string[]): Readonly<Record<string, unknown>> {
		return Object.freeze({
			registerLauncher: (launcherId: string, runtime: unknown) => {
				const value =
					typeof runtime === 'object' && runtime !== null
						? (runtime as Record<string, unknown>)
						: undefined;
				if (
					typeof launcherId !== 'string' ||
					!this.declared.has(launcherId) ||
					this.launchers.has(launcherId) ||
					value === undefined ||
					typeof value.resolve !== 'function'
				)
					throw new Error(
						'terminal launcher registration is undeclared or invalid',
					);
				this.launchers.set(
					launcherId,
					value as unknown as ChildLauncherRuntime,
				);
				registered.push(launcherId);
				let disposed = false;
				return Object.freeze({
					launcherId,
					dispose: () => {
						if (disposed) return;
						disposed = true;
						this.launchers.delete(launcherId);
					},
				});
			},
		});
	}

	handles(kind: HostFrame['kind']): boolean {
		return kind === 'terminal.launcher.resolve';
	}

	async receive(frame: HostFrame): Promise<void> {
		try {
			const payload =
				typeof frame.payload === 'object' && frame.payload !== null
					? (frame.payload as Record<string, unknown>)
					: {};
			const runtime =
				typeof payload.launcherId === 'string'
					? this.launchers.get(payload.launcherId)
					: undefined;
			if (runtime === undefined)
				throw new Error('terminal launcher is not registered');
			const result = validateTerminalLauncherResolution(
				await runtime.resolve(new AbortController().signal),
			);
			if (!result.ok) throw new Error(result.reason);
			this.io.result(frame.id, result.value);
		} catch (error) {
			this.io.failure(frame.id, error);
		}
	}
}
