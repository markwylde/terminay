import type { TerminalPresentationCheckpointTailEvent } from './presentationCheckpoint.js';
import type { TerminalDimensions } from './types.js';

/** Trusted-host presentation, never bytes produced by the PTY. */
export interface TerminalPresentationRecovery {
	readonly sessionId: string;
	readonly formatVersion: 1;
	readonly position: number;
	readonly headPosition: number;
	readonly checkpointDimensions: TerminalDimensions;
	readonly dimensions: TerminalDimensions;
	readonly state: Uint8Array;
	readonly tail: readonly TerminalPresentationCheckpointTailEvent[];
}

export const MAX_PRESENTATION_RECOVERY_BYTES = 4 * 1024 * 1024;
const MAX_STATE = 2 * 1024 * 1024;
const MAX_TAIL = 1024 * 1024;
const MAX_HEADER = 1024 * 1024 - 4;
const MAX_EVENTS = 4096;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function invalid(): never {
	throw new Error('invalid holder presentation recovery');
}
function position(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
		invalid();
	return value;
}
function grid(value: unknown): TerminalDimensions {
	if (!value || typeof value !== 'object') invalid();
	const { cols, rows } = value as TerminalDimensions;
	if (
		!Number.isInteger(cols) ||
		cols < 1 ||
		cols > 1000 ||
		!Number.isInteger(rows) ||
		rows < 1 ||
		rows > 1000
	)
		invalid();
	return { cols, rows };
}

/** The envelope names the exact session; output/tail positions remain raw offsets. */
export function encodePresentationRecovery(
	value: TerminalPresentationRecovery,
): Uint8Array {
	let tailBytes = 0;
	const tail = value.tail.map((event) => {
		if (event.type === 'resize') return event;
		tailBytes += event.bytes.byteLength;
		return {
			type: event.type,
			position: event.position,
			nextPosition: event.nextPosition,
			byteLength: event.bytes.byteLength,
		};
	});
	const header = encoder.encode(
		JSON.stringify({
			sessionId: value.sessionId,
			formatVersion: value.formatVersion,
			position: value.position,
			headPosition: value.headPosition,
			checkpointDimensions: value.checkpointDimensions,
			dimensions: value.dimensions,
			stateByteLength: value.state.byteLength,
			tail,
		}),
	);
	if (
		header.byteLength > MAX_HEADER ||
		value.state.byteLength > MAX_STATE ||
		tailBytes > MAX_TAIL ||
		value.tail.length > MAX_EVENTS
	)
		invalid();
	const bytes = new Uint8Array(
		4 + header.byteLength + value.state.byteLength + tailBytes,
	);
	if (bytes.byteLength > MAX_PRESENTATION_RECOVERY_BYTES) invalid();
	new DataView(bytes.buffer).setUint32(0, header.byteLength, false);
	bytes.set(header, 4);
	bytes.set(value.state, 4 + header.byteLength);
	let offset = 4 + header.byteLength + value.state.byteLength;
	for (const event of value.tail)
		if (event.type === 'output') {
			bytes.set(event.bytes, offset);
			offset += event.bytes.byteLength;
		}
	// Validate local producers as strictly as a received transfer.
	decodePresentationRecovery(bytes, value.sessionId);
	return bytes;
}

export function decodePresentationRecovery(
	bytes: Uint8Array,
	sessionId: string,
): TerminalPresentationRecovery {
	if (
		bytes.byteLength < 4 ||
		bytes.byteLength > MAX_PRESENTATION_RECOVERY_BYTES
	)
		invalid();
	const headerLength = new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint32(0, false);
	if (headerLength > MAX_HEADER || 4 + headerLength > bytes.byteLength)
		invalid();
	const header = JSON.parse(
		decoder.decode(bytes.subarray(4, 4 + headerLength)),
	);
	if (
		!header ||
		header.sessionId !== sessionId ||
		header.formatVersion !== 1 ||
		!Array.isArray(header.tail) ||
		header.tail.length > MAX_EVENTS
	)
		invalid();
	const start = position(header.position),
		head = position(header.headPosition);
	if (head < start) invalid();
	const checkpointDimensions = grid(header.checkpointDimensions),
		dimensions = grid(header.dimensions);
	const stateLength = position(header.stateByteLength);
	let offset = 4 + headerLength;
	if (
		stateLength === 0 ||
		stateLength > MAX_STATE ||
		offset + stateLength > bytes.byteLength
	)
		invalid();
	const state = bytes.slice(offset, offset + stateLength);
	offset += stateLength;
	const tail: TerminalPresentationCheckpointTailEvent[] = [];
	let current = start,
		tailBytes = 0,
		currentGrid = checkpointDimensions;
	for (const event of header.tail) {
		if (!event || position(event.position) !== current) invalid();
		if (event.type === 'resize') {
			currentGrid = grid(event.dimensions);
			tail.push({ type: 'resize', position: current, dimensions: currentGrid });
		} else if (event.type === 'output') {
			const length = position(event.byteLength),
				next = position(event.nextPosition);
			if (
				length === 0 ||
				length > 64 * 1024 ||
				next !== current + length ||
				next > head ||
				offset + length > bytes.byteLength
			)
				invalid();
			tailBytes += length;
			if (tailBytes > MAX_TAIL) invalid();
			tail.push({
				type: 'output',
				position: current,
				nextPosition: next,
				bytes: bytes.slice(offset, offset + length),
			});
			offset += length;
			current = next;
		} else invalid();
	}
	if (
		current !== head ||
		offset !== bytes.byteLength ||
		currentGrid.cols !== dimensions.cols ||
		currentGrid.rows !== dimensions.rows
	)
		invalid();
	return {
		sessionId,
		formatVersion: 1,
		position: start,
		headPosition: head,
		checkpointDimensions,
		dimensions,
		state,
		tail,
	};
}
