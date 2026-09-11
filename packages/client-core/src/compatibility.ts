import {
	CLIENT_SERVER_COMPATIBILITY,
	evaluateServerCompatibility,
	type ConnectionCompatibility,
	type IncompatibleVersionEnvelope,
	type ServerCompatibilityRequirements,
	type ServerHello,
} from "@terminay/protocol";
import type { TerminayClient } from "./client.js";
import { ProtocolIncompatibleError } from "./types.js";

/** The outcome of one hello judged against what this client needs. `hello` is
 * absent exactly when the server refused the protocol range outright. */
export interface ServerConnectionCompatibility {
	readonly hello?: ServerHello;
	readonly compatibility: ConnectionCompatibility;
}

/**
 * Connect and classify the server in one step.
 *
 * A refused protocol range is a result, not a thrown surprise: the caller gets
 * an `incompatible` classification naming the side to upgrade. Every other
 * connection failure (transport, timeout, authorization) still throws.
 */
export async function connectWithCompatibility(
	client: TerminayClient,
	requirements: ServerCompatibilityRequirements = CLIENT_SERVER_COMPATIBILITY,
	signal?: AbortSignal,
): Promise<ServerConnectionCompatibility> {
	client.declareServerCompatibility(requirements);
	try {
		const hello = await client.connect(signal);
		return Object.freeze({
			hello,
			compatibility: evaluateServerCompatibility(requirements, hello),
		});
	} catch (error) {
		const refusal = incompatibleVersionRefusal(error);
		if (refusal === undefined) throw error;
		return Object.freeze({
			compatibility: evaluateServerCompatibility(requirements, refusal),
		});
	}
}

/**
 * The refusal can arrive two ways, and both are answers about versions rather
 * than failures: the server replied `incompatible_version`, or the server's
 * hello named a version this client cannot negotiate. Anything else is a real
 * connection failure and is rethrown.
 */
function incompatibleVersionRefusal(
	error: unknown,
): IncompatibleVersionEnvelope | undefined {
	let candidate = error;
	for (let depth = 0; depth < 8 && candidate !== undefined && candidate !== null; depth += 1) {
		if (candidate instanceof ProtocolIncompatibleError) return candidate.envelope;
		const versioned = candidate as {
			readonly code?: unknown;
			readonly supportedMin?: unknown;
			readonly supportedMax?: unknown;
			readonly message?: unknown;
			readonly cause?: unknown;
		};
		if (
			versioned.code === "incompatible" &&
			typeof versioned.supportedMin === "number" &&
			typeof versioned.supportedMax === "number"
		) {
			return Object.freeze<IncompatibleVersionEnvelope>({
				type: "incompatible_version",
				supportedMin: versioned.supportedMin,
				supportedMax: versioned.supportedMax,
				error: {
					code: "incompatible",
					message:
						typeof versioned.message === "string"
							? versioned.message
							: "no shared protocol version",
				},
			});
		}
		candidate = versioned.cause;
	}
	return undefined;
}
