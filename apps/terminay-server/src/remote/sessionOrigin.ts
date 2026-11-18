import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
	type HostedEndpoints,
	sessionIdFromOrigin,
	sessionOriginFor,
} from '@terminay/protocol';

/** The one file that records a server's stable hosted session origin. */
export const SESSION_ORIGIN_FILE = 'remote-session-origin.v1.json';

/**
 * Provision the stable hosted session origin for a data root.
 *
 * The origin is minted once per data root from the configured Session Server
 * template (ADR-0136) and reused across restarts, so paired devices
 * reconnect without pairing again. A persisted origin is reused only while
 * it still matches the configured template; changing the Session Server
 * mints a new origin rather than advertising one the configured relay does
 * not serve.
 *
 * This is shared by Desktop's embedded server and by the standalone CLI:
 * both own their data root, and the file format is part of that root's
 * on-disk contract.
 */
export function loadOrCreateSessionOrigin(
	dataRoot: string,
	endpoints: HostedEndpoints,
): string {
	const file = path.join(dataRoot, SESSION_ORIGIN_FILE);
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
			origin?: unknown;
			schemaVersion?: unknown;
		};
		if (
			parsed.schemaVersion === 1 &&
			typeof parsed.origin === 'string' &&
			URL.canParse(parsed.origin)
		) {
			const origin = new URL(parsed.origin).origin;
			if (sessionIdFromOrigin(endpoints, origin) !== undefined) return origin;
		}
	} catch (error) {
		if (
			typeof error !== 'object' ||
			error === null ||
			(error as { code?: unknown }).code !== 'ENOENT'
		) {
			throw error;
		}
	}
	const origin = sessionOriginFor(endpoints, randomUUID().replace(/-/g, ''));
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const temporary = `${file}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ origin, schemaVersion: 1 })}\n`,
		{ encoding: 'utf8', mode: 0o600 },
	);
	renameSync(temporary, file);
	return origin;
}

/**
 * The session origin a standalone `start` uses (ADR-0120). A server exposed
 * through hosted signaling, or one that names no exposure mode and so may be
 * exposed through hosted signaling at runtime, uses the stable hosted origin
 * of its data root. A server that names an explicit origin, or that is
 * exposed only directly, keeps the origin its options select, so devices it
 * has already paired keep reconnecting.
 */
export function selectStandaloneSessionOrigin(
	input: Readonly<{
		command: string;
		dataRoot: string;
		hostedEndpoints: HostedEndpoints;
		exposeModes: readonly string[];
		remoteOrigin: string;
		remoteOriginExplicit: boolean;
	}>,
	provision: (
		dataRoot: string,
		endpoints: HostedEndpoints,
	) => string = loadOrCreateSessionOrigin,
): string {
	if (input.command !== 'start' || input.remoteOriginExplicit)
		return input.remoteOrigin;
	if (input.exposeModes.includes('hosted') || input.exposeModes.length === 0)
		return provision(input.dataRoot, input.hostedEndpoints);
	return input.remoteOrigin;
}
