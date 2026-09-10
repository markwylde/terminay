/**
 * One language gateway per connection, shared by that connection's file
 * panels.
 *
 * A gateway holds a connection-wide diagnostics subscription and a set of open
 * documents, so building one per open file multiplies the subscription by the
 * number of panels and makes each panel's teardown look, to the server, like
 * the whole window losing interest. Panels lease the connection's gateway
 * instead: the last panel to let go disposes it, and the next one opens a new
 * one.
 *
 * The lease is keyed by the application client, which is replaced on every
 * reconnect — so a reconnect naturally yields a new gateway rather than
 * reviving a disposed one.
 */

import { createLanguageGateway } from '../../services/fileViewer';
import type { LanguageGateway } from '../../services/fileViewer/languageGateway';

export type LanguageGatewayLease = Readonly<{
	gateway: LanguageGateway;
	release: () => void;
}>;

type Held = { gateway: LanguageGateway; leases: number };

const held = new WeakMap<object, Held>();

export function acquireLanguageGateway(
	client: object,
	create: (client: object) => LanguageGateway,
): LanguageGatewayLease {
	let entry = held.get(client);
	if (entry === undefined) {
		entry = { gateway: create(client), leases: 0 };
		held.set(client, entry);
	}
	entry.leases += 1;
	const owned = entry;
	let released = false;
	return Object.freeze({
		gateway: owned.gateway,
		release: () => {
			// A double release must not dispose a gateway another panel is using.
			if (released) return;
			released = true;
			owned.leases -= 1;
			if (owned.leases > 0) return;
			if (held.get(client) === owned) held.delete(client);
			owned.gateway.dispose();
		},
	});
}

export { createLanguageGateway };
