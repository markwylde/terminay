import type { RequestContext } from '../types.js';
import type { BotStreamAuthority } from './streamAuthority.js';
import { assertBotAuthority } from './authority.js';

/** Connection-scoped teardown shared with Files/Shell/Desktop adapters. The
 * host calls revoke on authority loss and closeConnection on disconnection. */
export class BotConnectionResources {
	constructor(private readonly onRevoke?: (connectionId: string) => void) {}
	private readonly lifetimes = new Map<
		string,
		{ controller: AbortController; context: RequestContext }
	>();
	authority(context: RequestContext): BotStreamAuthority {
		assertBotAuthority(context);
		let lifetime = this.lifetimes.get(context.connectionId);
		if (!lifetime) {
			lifetime = { controller: new AbortController(), context };
			this.lifetimes.set(context.connectionId, lifetime);
		}
		const signal = lifetime.controller.signal;
		return {
			...context,
			signal,
			assertCurrent: () => {
				signal.throwIfAborted();
				assertBotAuthority(context);
			},
		};
	}
	private readonly resources = new Map<string, Set<() => void>>();
	bind(context: RequestContext, teardown: () => void): () => void {
		assertBotAuthority(context);
		const resources =
			this.resources.get(context.connectionId) ?? new Set<() => void>();
		this.resources.set(context.connectionId, resources);
		let active = true;
		const close = () => {
			if (!active) return;
			active = false;
			resources.delete(close);
			context.signal.removeEventListener('abort', close);
			teardown();
			if (!resources.size) this.resources.delete(context.connectionId);
		};
		resources.add(close);
		context.signal.addEventListener('abort', close, { once: true });
		return close;
	}
	revoke(connectionId: string): void {
		this.lifetimes.get(connectionId)?.controller.abort();
		this.lifetimes.delete(connectionId);
		for (const close of [...(this.resources.get(connectionId) ?? [])]) close();
		this.onRevoke?.(connectionId);
	}
	close(): void {
		for (const id of new Set([
			...this.resources.keys(),
			...this.lifetimes.keys(),
		]))
			this.revoke(id);
	}
}
