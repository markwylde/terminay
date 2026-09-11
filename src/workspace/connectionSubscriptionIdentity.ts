/**
 * A stable token for the live objects a connection hands out.
 *
 * The subscription hooks key one effect on the whole attached set, so the key
 * has to change whenever a *subscription target* is replaced — not only when a
 * server joins or leaves. A reconnect keeps the same `serverId` and swaps in a
 * fresh snapshot store and agent client, and a failed attempt clears the
 * context entirely; keying on the server id alone would leave the hook
 * subscribed to a store nothing writes to any more.
 *
 * Tokens are handed out from a WeakMap, so a replaced context is not kept
 * alive by having been observed.
 */

const tokens = new WeakMap<object, string>();
let issued = 0;

/** A token that is equal for the same object and different for any other.
 * An absent target is its own state, and is never confused with a present one. */
export function subscriptionToken(target: unknown): string {
	if (typeof target !== 'object' || target === null) return '-';
	const existing = tokens.get(target as object);
	if (existing !== undefined) return existing;
	issued += 1;
	const token = `#${issued}`;
	tokens.set(target as object, token);
	return token;
}

/**
 * The dependency key for an effect that subscribes to one object per
 * connection.
 *
 * It changes when a server joins or leaves *and* when the object subscribed to
 * is replaced — which is what a reconnect does behind an unchanged server id.
 */
export function subscriptionKey<T extends Readonly<{ serverId?: string }>>(
	connections: readonly T[],
	target: (connection: T) => unknown,
): string {
	return connections
		.filter((connection) => connection.serverId !== undefined)
		.map(
			(connection) =>
				`${connection.serverId}${subscriptionToken(target(connection))}`,
		)
		.join('\u0000');
}
