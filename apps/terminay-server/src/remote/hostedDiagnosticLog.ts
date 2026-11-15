import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConnectionDeliveryDiagnostic } from '@terminay/server-core';
import type { HostedPairingDiagnostic } from './hostedPairingHost.js';

const STREAM_TYPES = new Set([
	'peer-state',
	'ice-grace',
	'channel-state',
	'application-lane',
	'peer-closed',
]);

const OMITTED_NETWORK_IDENTIFIER_FIELDS = new Set([
	'address',
	'ip',
	'localAddress',
	'localPort',
	'port',
	'remoteAddress',
	'remotePort',
]);

/** One line per record, to stderr and, when configured, the log sink. */
function createDiagnosticLineWriter(
	logSink?: string,
): (record: Record<string, unknown>) => void {
	let sinkReady = logSink === undefined;
	if (logSink) {
		void mkdir(dirname(logSink), { recursive: true })
			.then(() => {
				sinkReady = true;
			})
			.catch(() => {
				sinkReady = false;
			});
	}
	return (record) => {
		const line = `${JSON.stringify({
			timestamp: new Date().toISOString(),
			...record,
		})}\n`;
		process.stderr.write(line);
		if (!logSink || !sinkReady) return;
		void appendFile(logSink, line).catch(() => undefined);
	};
}

export function createHostedDiagnosticLogger(
	logSink?: string,
): (event: HostedPairingDiagnostic) => void {
	const write = createDiagnosticLineWriter(logSink);
	return (event) =>
		write({
			component: 'hosted-remote',
			event: event.type,
			...omitUndefined(event),
		});
}

/**
 * Why each protocol connection ended. A connection the server fails says
 * which limit or deadline failed it; a closed one says whether the client
 * left (`normal`) or its transport went away (`unavailable`). Only the close
 * class and queue sizes are recorded: no payload, identity, or address.
 */
export function createServerConnectionLogger(
	logSink: string | undefined,
	route: 'hosted' | 'local',
): (diagnostic: ConnectionDeliveryDiagnostic) => void {
	const write = createDiagnosticLineWriter(logSink);
	return (diagnostic) => {
		if (diagnostic.phase === 'terminal_congestion') return;
		write({
			component: 'server-connection',
			event:
				diagnostic.phase === 'failure'
					? 'connection-failed'
					: 'connection-closed',
			route,
			code: diagnostic.code,
			queuedBytes: diagnostic.queuedBytes,
			queuedFrames: diagnostic.queuedFrames,
		});
	};
}

export function isHostedStreamDiagnostic(type: string): boolean {
	return STREAM_TYPES.has(type);
}

function omitUndefined(
	event: HostedPairingDiagnostic,
): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (
			key === 'type' ||
			value === undefined ||
			OMITTED_NETWORK_IDENTIFIER_FIELDS.has(key)
		)
			continue;
		fields[key] = value;
	}
	return fields;
}
