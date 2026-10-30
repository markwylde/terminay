import {
	validateTerminalCommandDefaultResolution,
	validateTerminalLauncherResolution,
} from '@terminay/extension-api';
import type { HostFrame } from './protocol.js';

/**
 * The child side of terminal launchers and terminal command defaults. A
 * launcher only answers where its program is installed, and a command default
 * only whether it applies and with which flags; the host validates every
 * answer again and decides everything about the terminals they are used for.
 */
export interface TerminalLauncherChildIo {
	result(id: string, payload?: unknown): void;
	failure(id: string, error: unknown): void;
}

interface ChildResolvingRuntime {
	resolve(signal: AbortSignal): Promise<unknown>;
}

export class TerminalLauncherChild {
	private readonly launchers = new Map<string, ChildResolvingRuntime>();
	private readonly commandDefaults = new Map<string, ChildResolvingRuntime>();
	private declared = new Set<string>();
	private declaredCommandDefaults = new Set<string>();

	constructor(private readonly io: TerminalLauncherChildIo) {}

	/** Forget everything from a previous activation. */
	reset(
		declared: readonly string[],
		declaredCommandDefaults: readonly string[] = [],
	): void {
		this.launchers.clear();
		this.commandDefaults.clear();
		this.declared = new Set(declared);
		this.declaredCommandDefaults = new Set(declaredCommandDefaults);
	}

	registry(
		registered: string[],
		registeredCommandDefaults: string[] = [],
	): Readonly<Record<string, unknown>> {
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
					value as unknown as ChildResolvingRuntime,
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
			registerCommandDefault: (commandDefaultId: string, runtime: unknown) => {
				const value =
					typeof runtime === 'object' && runtime !== null
						? (runtime as Record<string, unknown>)
						: undefined;
				if (
					typeof commandDefaultId !== 'string' ||
					!this.declaredCommandDefaults.has(commandDefaultId) ||
					this.commandDefaults.has(commandDefaultId) ||
					value === undefined ||
					typeof value.resolve !== 'function'
				)
					throw new Error(
						'terminal command default registration is undeclared or invalid',
					);
				this.commandDefaults.set(
					commandDefaultId,
					value as unknown as ChildResolvingRuntime,
				);
				registeredCommandDefaults.push(commandDefaultId);
				let disposed = false;
				return Object.freeze({
					commandDefaultId,
					dispose: () => {
						if (disposed) return;
						disposed = true;
						this.commandDefaults.delete(commandDefaultId);
					},
				});
			},
		});
	}

	handles(kind: HostFrame['kind']): boolean {
		return (
			kind === 'terminal.launcher.resolve' ||
			kind === 'terminal.commandDefault.resolve'
		);
	}

	async receive(frame: HostFrame): Promise<void> {
		if (frame.kind === 'terminal.commandDefault.resolve') {
			await this.receiveCommandDefault(frame);
			return;
		}
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

	private async receiveCommandDefault(frame: HostFrame): Promise<void> {
		try {
			const payload =
				typeof frame.payload === 'object' && frame.payload !== null
					? (frame.payload as Record<string, unknown>)
					: {};
			const runtime =
				typeof payload.commandDefaultId === 'string'
					? this.commandDefaults.get(payload.commandDefaultId)
					: undefined;
			if (runtime === undefined)
				throw new Error('terminal command default is not registered');
			const result = validateTerminalCommandDefaultResolution(
				await runtime.resolve(new AbortController().signal),
			);
			if (!result.ok) throw new Error(result.reason);
			this.io.result(frame.id, result.value);
		} catch (error) {
			this.io.failure(frame.id, error);
		}
	}
}
