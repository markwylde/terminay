import {
	isHttpsOrigin,
	validateForgeAccounts,
	validateForgeClaim,
	validateForgeDetail,
	validateForgePage,
	validateForgeQuery,
	validateForgeReference,
} from '@terminay/extension-api';
import type { ChildFrame, HostFrame } from './protocol.js';

/**
 * The child side of forge sources (ADR-0105). Terminay asks; a source answers
 * one call. Every answer is validated here and again in the host, so a source
 * can only ever return bounded, typed facts about the question it was asked.
 */
export interface ForgeSourceChildIo {
	send(frame: ChildFrame): void;
	nextId(prefix: string): string;
	broker(
		operation: 'forge.token' | 'forge.token.reject',
		payload: unknown,
		signal?: AbortSignal,
	): Promise<unknown>;
	result(id: string, payload?: unknown): void;
	failure(id: string, error: unknown): void;
}

interface ChildForgeRuntime {
	accounts(signal: AbortSignal): Promise<unknown>;
	claim(remote: unknown, signal: AbortSignal): Promise<unknown>;
	query(query: unknown, signal: AbortSignal): Promise<unknown>;
	detail(reference: unknown, signal: AbortSignal): Promise<unknown>;
}

const FORGE_FRAMES: readonly HostFrame['kind'][] = [
	'forge.source.accounts',
	'forge.source.claim',
	'forge.source.query',
	'forge.source.detail',
	'forge.source.credential',
];

export class ForgeSourceChild {
	private readonly sources = new Map<string, ChildForgeRuntime>();
	private readonly calls = new Map<string, AbortController>();
	private readonly credentialListeners = new Set<(origin: string) => void>();
	private declared = new Set<string>();
	private generation = new AbortController();

	constructor(private readonly io: ForgeSourceChildIo) {}

	/** Forget everything from a previous activation. */
	reset(declared: readonly string[]): void {
		this.stopAll();
		this.sources.clear();
		this.credentialListeners.clear();
		this.declared = new Set(declared);
		this.generation = new AbortController();
	}

	/** Abort every running call; used on deactivation. */
	stopAll(): void {
		for (const controller of this.calls.values()) controller.abort();
		this.calls.clear();
		this.generation.abort();
	}

	/** The host cancelled one call (timeout, superseded, or client gone). */
	cancel(id: string): boolean {
		const controller = this.calls.get(id);
		if (controller === undefined) return false;
		controller.abort();
		this.calls.delete(id);
		return true;
	}

	registry(registered: string[]): Readonly<Record<string, unknown>> {
		const io = this.io;
		const generation = this.generation.signal;
		return Object.freeze({
			registerSource: (sourceId: string, runtime: unknown) => {
				const value =
					typeof runtime === 'object' && runtime !== null
						? (runtime as Record<string, unknown>)
						: undefined;
				if (
					typeof sourceId !== 'string' ||
					!this.declared.has(sourceId) ||
					this.sources.has(sourceId) ||
					generation.aborted ||
					value === undefined ||
					typeof value.accounts !== 'function' ||
					typeof value.claim !== 'function' ||
					typeof value.query !== 'function' ||
					typeof value.detail !== 'function'
				)
					throw new Error('forge source registration is undeclared or invalid');
				this.sources.set(sourceId, value as unknown as ChildForgeRuntime);
				registered.push(sourceId);
				let disposed = false;
				return Object.freeze({
					sourceId,
					invalidate: (origin: string) => {
						if (disposed || generation.aborted || !isHttpsOrigin(origin))
							return;
						io.send({
							protocolVersion: 1,
							kind: 'forge.source.invalidate',
							id: io.nextId('forge-invalidate'),
							payload: { sourceId, origin },
						});
					},
					dispose: () => {
						if (disposed) return;
						disposed = true;
						this.sources.delete(sourceId);
						io.send({
							protocolVersion: 1,
							kind: 'forge.source.disposed',
							id: io.nextId('forge-dispose'),
							payload: { sourceId },
						});
					},
				});
			},
			credentials: Object.freeze({
				async token(origin: string): Promise<string | undefined> {
					if (!isHttpsOrigin(origin)) return undefined;
					const value = await io.broker('forge.token', { origin }, generation);
					return typeof value === 'string' ? value : undefined;
				},
				async reject(origin: string): Promise<void> {
					if (!isHttpsOrigin(origin)) return;
					await io.broker('forge.token.reject', { origin }, generation);
				},
				onAvailable: (listener: (origin: string) => void) => {
					this.credentialListeners.add(listener);
					return Object.freeze({
						dispose: () => {
							this.credentialListeners.delete(listener);
						},
					});
				},
			}),
		});
	}

	handles(kind: HostFrame['kind']): boolean {
		return FORGE_FRAMES.includes(kind);
	}

	async receive(frame: HostFrame): Promise<void> {
		const payload =
			typeof frame.payload === 'object' && frame.payload !== null
				? (frame.payload as Record<string, unknown>)
				: {};
		if (frame.kind === 'forge.source.credential') {
			const origin = payload.origin;
			if (isHttpsOrigin(origin))
				for (const listener of [...this.credentialListeners])
					try {
						listener(origin);
					} catch {
						/* a listener's failure is the extension's own */
					}
			this.io.result(frame.id);
			return;
		}
		const controller = new AbortController();
		this.calls.set(frame.id, controller);
		try {
			const runtime =
				typeof payload.sourceId === 'string'
					? this.sources.get(payload.sourceId)
					: undefined;
			if (runtime === undefined) throw new Error('forge source is not registered');
			const signal = controller.signal;
			let answer: unknown;
			if (frame.kind === 'forge.source.accounts') {
				const result = validateForgeAccounts(await runtime.accounts(signal));
				if (!result.ok) throw new Error(result.reason);
				answer = result.value;
			} else if (frame.kind === 'forge.source.claim') {
				const remote = payload.remote as { name: string; url: string };
				if (
					typeof remote?.name !== 'string' ||
					typeof remote?.url !== 'string'
				)
					throw new Error('remote is invalid');
				const result = validateForgeClaim(
					await runtime.claim({ name: remote.name, url: remote.url }, signal),
					remote,
				);
				if (!result.ok) throw new Error(result.reason);
				answer = result.value;
			} else if (frame.kind === 'forge.source.query') {
				const query = validateForgeQuery(payload.query);
				if (!query.ok) throw new Error(query.reason);
				const result = validateForgePage(
					await runtime.query(query.value, signal),
					query.value,
				);
				if (!result.ok) throw new Error(result.reason);
				answer = result.value.page;
			} else {
				const reference = validateForgeReference(payload.reference);
				if (!reference.ok) throw new Error(reference.reason);
				const result = validateForgeDetail(
					await runtime.detail(reference.value, signal),
					reference.value,
				);
				if (!result.ok) throw new Error(result.reason);
				answer = result.value;
			}
			if (signal.aborted) return;
			this.io.result(frame.id, answer);
		} catch (error) {
			if (!controller.signal.aborted) this.io.failure(frame.id, error);
		} finally {
			this.calls.delete(frame.id);
		}
	}
}
