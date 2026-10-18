import type {
	TerminalService,
	TerminalSubscription,
} from '../packages/server-core/src/terminalService/index';

/**
 * E2E-only control over the two things that make a terminal hand its
 * attachment over while the user is typing: a write that has not come back
 * yet, and a stream the server ends as congested. A test holds the first and
 * causes the second, so the handoff it asserts on happens exactly where it
 * says and never because of timing.
 */
export interface TestTerminalHandoff {
	/** Writes to this terminal wait at the server until `releaseInput`. */
	holdInput(sessionId: string): void;
	/** Writes waiting at the hold. */
	heldInputs(sessionId: string): number;
	/** Let held writes go on, in the order they arrived. */
	releaseInput(sessionId: string): void;
	/** What the terminal has been sent, in order. */
	input(sessionId: string): string;
	/** Output streams opened for this terminal so far; an attach or resume opens one. */
	streams(sessionId: string): number;
	/** End each live output stream as congested, as an overflowing one is. */
	congest(sessionId: string): number;
}

function sessionIdOf(session: string | { readonly sessionId: string }): string {
	return typeof session === 'string' ? session : session.sessionId;
}

/** Wraps the embedded server's terminal service. Install only under TERMINAY_TEST. */
export function installTestTerminalHandoff(
	service: TerminalService,
): TestTerminalHandoff {
	const holds = new Map<string, Array<() => void>>();
	const inputs = new Map<string, string>();
	const decoder = new TextDecoder();
	const live = new Map<string, Set<TerminalSubscription>>();
	const opened = new Map<string, number>();

	service.onInput((identity, bytes) => {
		const previous = inputs.get(identity.sessionId) ?? '';
		inputs.set(
			identity.sessionId,
			(previous + decoder.decode(bytes, { stream: true })).slice(-65_536),
		);
	});

	const input = service.input.bind(service);
	service.input = async (session, data, authorization) => {
		const waiting = holds.get(sessionIdOf(session));
		if (waiting !== undefined)
			await new Promise<void>((resolve) => waiting.push(resolve));
		return input(session, data, authorization);
	};

	const subscribe = service.subscribe.bind(service);
	service.subscribe = (session, options) => {
		const subscription = subscribe(session, options);
		const sessionId = subscription.sessionId;
		opened.set(sessionId, (opened.get(sessionId) ?? 0) + 1);
		let subscriptions = live.get(sessionId);
		if (subscriptions === undefined) {
			subscriptions = new Set();
			live.set(sessionId, subscriptions);
		}
		subscriptions.add(subscription);
		return subscription;
	};

	return Object.freeze({
		holdInput: (sessionId: string) => {
			if (!holds.has(sessionId)) holds.set(sessionId, []);
		},
		heldInputs: (sessionId: string) => holds.get(sessionId)?.length ?? 0,
		releaseInput: (sessionId: string) => {
			const waiting = holds.get(sessionId) ?? [];
			holds.delete(sessionId);
			for (const resolve of waiting) resolve();
		},
		input: (sessionId: string) => inputs.get(sessionId) ?? '',
		streams: (sessionId: string) => opened.get(sessionId) ?? 0,
		congest: (sessionId: string) => {
			let ended = 0;
			for (const subscription of live.get(sessionId) ?? []) {
				live.get(sessionId)?.delete(subscription);
				if (subscription.closed) continue;
				subscription.closeForOverflow();
				ended += 1;
			}
			return ended;
		},
	});
}
