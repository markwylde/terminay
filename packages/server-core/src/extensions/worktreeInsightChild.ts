import type { ChildFrame, HostFrame } from './protocol.js';

/**
 * The child side of worktree insight sources. It turns host frames into the
 * public `WorktreeInsightSourceStart` surface and the source's calls back into
 * frames; every value is validated again by the host before it applies.
 */
export interface WorktreeInsightChildIo {
	send(frame: ChildFrame): boolean;
	nextId(prefix: string): string;
	broker(
		operation: 'worktree.token' | 'worktree.token.reject',
		payload: unknown,
		signal?: AbortSignal,
	): Promise<unknown>;
	result(id: string): void;
	failure(id: string, error: unknown): void;
}

interface ChildInsightSource {
	readonly runtime: { start(start: unknown): unknown };
	controller?: AbortController;
	contexts: readonly unknown[];
	readonly contextListeners: Set<(contexts: readonly unknown[]) => void>;
	readonly credentialListeners: Set<(origin: string) => void>;
}

export class WorktreeInsightChild {
	private readonly sources = new Map<string, ChildInsightSource>();
	private declared = new Set<string>();

	constructor(private readonly io: WorktreeInsightChildIo) {}

	/** Forget everything from a previous activation. */
	reset(declared: readonly string[]): void {
		this.stopAll();
		this.sources.clear();
		this.declared = new Set(declared);
	}

	registry(registered: string[]): Readonly<Record<string, unknown>> {
		return Object.freeze({
			registerInsightSource: (sourceId: string, runtime: unknown) => {
				const value =
					typeof runtime === 'object' && runtime !== null
						? (runtime as Record<string, unknown>)
						: undefined;
				if (
					typeof sourceId !== 'string' ||
					!this.declared.has(sourceId) ||
					this.sources.has(sourceId) ||
					value === undefined ||
					typeof value.start !== 'function'
				)
					throw new Error(
						'worktree insight source registration is undeclared or invalid',
					);
				this.sources.set(sourceId, {
					runtime: value as ChildInsightSource['runtime'],
					contexts: [],
					contextListeners: new Set(),
					credentialListeners: new Set(),
				});
				registered.push(sourceId);
				let disposed = false;
				return Object.freeze({
					sourceId,
					dispose: () => {
						if (disposed) return;
						disposed = true;
						this.stop(this.sources.get(sourceId));
						this.sources.delete(sourceId);
						this.io.send({
							protocolVersion: 1,
							kind: 'worktree.source.disposed',
							id: this.io.nextId('worktree-dispose'),
							payload: { sourceId },
						});
					},
				});
			},
		});
	}

	handles(kind: HostFrame['kind']): boolean {
		return kind.startsWith('worktree.source.');
	}

	async receive(frame: HostFrame): Promise<void> {
		try {
			const payload = objectOf(frame.payload);
			const sourceId = payload?.sourceId;
			const source =
				typeof sourceId === 'string' ? this.sources.get(sourceId) : undefined;
			if (source === undefined || typeof sourceId !== 'string')
				throw new Error('worktree insight source is not registered');
			if (frame.kind === 'worktree.source.start')
				await this.start(sourceId, source, contextsOf(payload?.contexts));
			else if (frame.kind === 'worktree.source.stop') this.stop(source);
			else if (frame.kind === 'worktree.source.contexts') {
				source.contexts = contextsOf(payload?.contexts);
				for (const listener of [...source.contextListeners])
					listener(source.contexts);
			} else if (frame.kind === 'worktree.source.credential') {
				const origin = payload?.origin;
				if (typeof origin !== 'string') throw new Error('origin is invalid');
				for (const listener of [...source.credentialListeners])
					listener(origin);
			} else throw new Error('unknown worktree insight frame');
			this.io.result(frame.id);
		} catch (error) {
			this.io.failure(frame.id, error);
		}
	}

	stopAll(): void {
		for (const source of this.sources.values()) this.stop(source);
	}

	private stop(source: ChildInsightSource | undefined): void {
		if (source === undefined) return;
		source.controller?.abort();
		source.controller = undefined;
		source.contextListeners.clear();
		source.credentialListeners.clear();
	}

	private async start(
		sourceId: string,
		source: ChildInsightSource,
		contexts: readonly unknown[],
	): Promise<void> {
		this.stop(source);
		const controller = new AbortController();
		source.controller = controller;
		source.contexts = contexts;
		const active = () =>
			!controller.signal.aborted && source.controller === controller;
		const io = this.io;
		const listen = <T>(set: Set<T>, listener: T) => {
			if (typeof listener !== 'function')
				throw new TypeError('listener must be a function');
			set.add(listener);
			return Object.freeze({
				dispose() {
					set.delete(listener);
				},
			});
		};
		await source.runtime.start(
			Object.freeze({
				contexts: source.contexts,
				onContextsChanged: (listener: (contexts: readonly unknown[]) => void) =>
					listen(source.contextListeners, listener),
				publisher: Object.freeze({
					publish(
						contextId: unknown,
						worktreeId: unknown,
						properties: unknown,
					) {
						if (!active()) return;
						io.send({
							protocolVersion: 1,
							kind: 'worktree.source.publish',
							id: io.nextId('worktree-publish'),
							payload: {
								sourceId,
								contextId,
								worktreeId,
								properties: properties ?? null,
							} as Record<string, unknown>,
						});
					},
					requestSignIn(request: unknown) {
						if (!active()) return;
						io.send({
							protocolVersion: 1,
							kind: 'worktree.source.sign-in',
							id: io.nextId('worktree-sign-in'),
							payload: { sourceId, request } as Record<string, unknown>,
						});
					},
				}),
				credentials: Object.freeze({
					async token(origin: string): Promise<string | undefined> {
						const value = await io.broker(
							'worktree.token',
							{ sourceId, origin },
							controller.signal,
						);
						return typeof value === 'string' ? value : undefined;
					},
					async reject(origin: string): Promise<void> {
						await io.broker(
							'worktree.token.reject',
							{ sourceId, origin },
							controller.signal,
						);
					},
					onAvailable: (listener: (origin: string) => void) =>
						listen(source.credentialListeners, listener),
				}),
				signal: controller.signal,
			}),
		);
	}
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function contextsOf(value: unknown): readonly unknown[] {
	return Object.freeze(Array.isArray(value) ? [...value] : []);
}
