import { createHash } from "node:crypto";
import { hostedSessionId } from "./hostedPairingSecrets.js";

/**
 * The relay session id for a self-hosted direct signaling endpoint.
 *
 * A direct origin is whatever hostname an operator points at their own box, so
 * unlike a hosted session origin it carries no session id in its first label.
 * Both ends derive the same id from the exact origin instead, so a client that
 * saved the origin rejoins the room without the id ever travelling in a link.
 *
 * This is routing, not authority. The id names a room on a data-blind relay;
 * the server host key's signature over the transport transcript remains the
 * only authentication of the endpoint.
 */
export function directSessionId(directOrigin: string): string {
	const origin = new URL(directOrigin).origin;
	// 32 lowercase hex characters, which is the shape a session id must take.
	return createHash("sha256").update(origin).digest("hex").slice(0, 32);
}

/**
 * The relay session id an origin's host and its clients both use.
 *
 * A hosted session origin carries its id in the first label; a self-hosted
 * direct origin has none, so it is derived from the origin itself. Server and
 * client must agree, so both call this rather than classifying separately.
 */
export function relaySessionId(origin: string): string {
	const host = new URL(origin).hostname.toLowerCase();
	const hosted =
		host.endsWith(".terminay.com") ||
		host.endsWith(".localhost") ||
		/\.127\.0\.0\.1$/u.test(host);
	return hosted ? hostedSessionId(origin) : directSessionId(origin);
}
