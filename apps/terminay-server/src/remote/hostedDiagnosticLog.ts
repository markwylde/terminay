import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { HostedPairingDiagnostic } from './hostedPairingHost.js';

const STREAM_TYPES = new Set([
	'peer-state',
	'ice-grace',
	'channel-state',
	'application-lane',
	'peer-closed',
]);

export function createHostedDiagnosticLogger(logSink?: string): (
	event: HostedPairingDiagnostic,
) => void {
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

	return (event) => {
		const line = `${JSON.stringify({
			timestamp: new Date().toISOString(),
			component: 'hosted-remote',
			event: event.type,
			...omitUndefined(event),
		})}\n`;
		process.stderr.write(line);
		if (!logSink || !sinkReady) return;
		void appendFile(logSink, line).catch(() => undefined);
	};
}

export function isHostedStreamDiagnostic(type: string): boolean {
	return STREAM_TYPES.has(type);
}

function omitUndefined(event: HostedPairingDiagnostic): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(event)) {
		if (key === 'type' || value === undefined) continue;
		fields[key] = value;
	}
	return fields;
}
