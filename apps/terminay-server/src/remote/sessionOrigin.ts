import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The one file that records a server's stable hosted session origin. */
export const SESSION_ORIGIN_FILE = "remote-session-origin.v1.json";

/**
 * Provision the stable hosted session origin for a data root.
 *
 * The origin is minted once per data root and reused across restarts, so
 * paired devices reconnect without pairing again. A persisted origin is reused
 * only while it still sits under the configured hosted domain; changing the
 * domain mints a new origin rather than advertising one the hosted relay no
 * longer serves. Loopback hosted domains keep `http:` so a development relay
 * needs no certificate.
 *
 * This is shared by Desktop's embedded server and by the standalone CLI:
 * both own their data root, and the file format is part of that root's
 * on-disk contract.
 */
export function loadOrCreateSessionOrigin(
	dataRoot: string,
	hostedDomain: string,
): string {
	const configured = hostedDomain.includes("://")
		? hostedDomain
		: `https://${hostedDomain}`;
	const hosted = new URL(configured);
	const loopbackHostedDomain =
		hosted.hostname === "localhost" ||
		hosted.hostname.endsWith(".localhost") ||
		hosted.hostname === "127.0.0.1" ||
		hosted.hostname === "[::1]";
	hosted.protocol = loopbackHostedDomain ? "http:" : "https:";
	hosted.pathname = "/";
	hosted.search = "";
	hosted.hash = "";
	const file = path.join(dataRoot, SESSION_ORIGIN_FILE);
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			origin?: unknown;
			schemaVersion?: unknown;
		};
		if (parsed.schemaVersion === 1 && typeof parsed.origin === "string") {
			const origin = new URL(parsed.origin);
			if (
				origin.hostname === hosted.hostname ||
				origin.hostname.endsWith(`.${hosted.hostname}`)
			) {
				return origin.origin;
			}
		}
	} catch (error) {
		if (
			typeof error !== "object" ||
			error === null ||
			(error as { code?: unknown }).code !== "ENOENT"
		) {
			throw error;
		}
	}
	hosted.hostname = `${randomUUID().replace(/-/g, "")}.${hosted.hostname}`;
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ origin: hosted.origin, schemaVersion: 1 })}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	renameSync(temporary, file);
	return hosted.origin;
}
