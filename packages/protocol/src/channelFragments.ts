/**
 * Message fragmentation for datagram-style lanes.
 *
 * A WebRTC data channel accepts one bounded SCTP message (commonly 256 KB, and
 * never the protocol's 8 MB frame budget), so a large query result cannot be
 * handed to the channel as a single message. Fragments carry their own magic
 * (`TRMF`) so a receiver can tell them apart from ordinary protocol frames
 * (`TRMY`) on the same lane and reassemble the original frame byte for byte.
 *
 * Ordering is the lane's guarantee, not this codec's: fragments of one transfer
 * must arrive in the order they were sent, which every Terminay lane provides
 * (`createDataChannel(label, { ordered: true })`). Transfers may interleave with
 * each other and with unfragmented frames.
 */

export const FRAGMENT_MAGIC = new Uint8Array([0x54, 0x52, 0x4d, 0x46]); // TRMF
export const FRAGMENT_FORMAT_VERSION = 1;
/** magic(4) + version(1) + reserved(1) + transferId(2) + index(2) + count(2) */
export const FRAGMENT_HEADER_BYTES = 12;
/** Below this a frame costs more in headers and round trips than it saves. */
export const MIN_FRAGMENT_PAYLOAD_BYTES = 1024;
/** In-progress transfers one receiver keeps; a new one evicts the oldest. */
export const MAX_CONCURRENT_FRAGMENT_TRANSFERS = 4;
const MAX_FRAGMENT_COUNT = 0xffff;
const MAX_TRANSFER_ID = 0xffff;

export type ChannelFragmentAdmission =
	| { readonly kind: "frame"; readonly frame: Uint8Array }
	| { readonly kind: "partial" };

export function isChannelFragment(message: Uint8Array): boolean {
	if (!(message instanceof Uint8Array) || message.byteLength < FRAGMENT_HEADER_BYTES) return false;
	for (let index = 0; index < FRAGMENT_MAGIC.length; index += 1) {
		if (message[index] !== FRAGMENT_MAGIC[index]) return false;
	}
	return true;
}

/**
 * Split one protocol frame into channel-sized messages. A frame that already
 * fits is returned unfragmented, so peers only ever see fragments for payloads
 * their lane could not have carried at all.
 */
export function encodeChannelFragments(
	frame: Uint8Array,
	maxMessageBytes: number,
	transferId: number,
): readonly Uint8Array[] {
	if (!(frame instanceof Uint8Array) || frame.byteLength === 0) throw new TypeError("fragment source must be a non-empty Uint8Array");
	if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= FRAGMENT_HEADER_BYTES + MIN_FRAGMENT_PAYLOAD_BYTES) {
		throw new RangeError("channel message limit is too small to fragment");
	}
	if (!Number.isSafeInteger(transferId) || transferId < 0 || transferId > MAX_TRANSFER_ID) throw new RangeError("fragment transfer id is invalid");
	if (frame.byteLength <= maxMessageBytes) return [frame];
	const payloadBytes = maxMessageBytes - FRAGMENT_HEADER_BYTES;
	const count = Math.ceil(frame.byteLength / payloadBytes);
	if (count > MAX_FRAGMENT_COUNT) throw new RangeError("frame needs more fragments than the format allows");
	const fragments: Uint8Array[] = [];
	for (let index = 0; index < count; index += 1) {
		const offset = index * payloadBytes;
		const payload = frame.subarray(offset, Math.min(offset + payloadBytes, frame.byteLength));
		const fragment = new Uint8Array(FRAGMENT_HEADER_BYTES + payload.byteLength);
		fragment.set(FRAGMENT_MAGIC, 0);
		fragment[4] = FRAGMENT_FORMAT_VERSION;
		fragment[5] = 0;
		const view = new DataView(fragment.buffer);
		view.setUint16(6, transferId, false);
		view.setUint16(8, index, false);
		view.setUint16(10, count, false);
		fragment.set(payload, FRAGMENT_HEADER_BYTES);
		fragments.push(fragment);
	}
	return fragments;
}

type PendingTransfer = {
	readonly count: number;
	nextIndex: number;
	bytes: number;
	readonly parts: Uint8Array[];
};

/**
 * Reassemble fragments arriving on one lane. A message that is not a fragment
 * passes straight through, so a peer that never fragments is unaffected. Every
 * inconsistency (a wrong index, an over-budget total) throws: the lane owner
 * decides whether that is fatal.
 */
export class ChannelFragmentReassembler {
	private readonly maxFrameBytes: number;
	private readonly transfers = new Map<number, PendingTransfer>();
	private pendingBytes = 0;

	constructor(options: Readonly<{ maxFrameBytes: number }>) {
		if (!Number.isSafeInteger(options.maxFrameBytes) || options.maxFrameBytes <= 0) throw new RangeError("maxFrameBytes must be positive");
		this.maxFrameBytes = options.maxFrameBytes;
	}

	/** Bytes held for in-progress transfers. Counts against inbound budgets. */
	get bufferedBytes(): number {
		return this.pendingBytes;
	}

	get openTransfers(): number {
		return this.transfers.size;
	}

	accept(message: Uint8Array): ChannelFragmentAdmission {
		if (!isChannelFragment(message)) return { kind: "frame", frame: message };
		if (message[4] !== FRAGMENT_FORMAT_VERSION) {
			this.reset();
			throw new RangeError("channel fragment version is unsupported");
		}
		const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
		const transferId = view.getUint16(6, false);
		const index = view.getUint16(8, false);
		const count = view.getUint16(10, false);
		const payload = message.subarray(FRAGMENT_HEADER_BYTES);
		if (count < 2 || index >= count || payload.byteLength === 0) {
			this.reset();
			throw new RangeError("channel fragment header is invalid");
		}
		let transfer = this.transfers.get(transferId);
		if (index === 0) {
			// A reused id replaces an abandoned transfer: a sender that failed part
			// way through must not strand this receiver's buffer forever.
			if (transfer !== undefined) this.discard(transferId, transfer);
			// A sender that failed part way through leaves a partial transfer no
			// later fragment will ever complete. Evicting the oldest keeps that
			// dead weight from accumulating instead of failing a healthy lane.
			while (this.transfers.size >= MAX_CONCURRENT_FRAGMENT_TRANSFERS) {
				const oldest = this.transfers.entries().next().value;
				if (oldest === undefined) break;
				this.discard(oldest[0], oldest[1]);
			}
			transfer = { count, nextIndex: 0, bytes: 0, parts: [] };
			this.transfers.set(transferId, transfer);
		} else if (transfer === undefined || transfer.count !== count || transfer.nextIndex !== index) {
			if (transfer !== undefined) this.discard(transferId, transfer);
			throw new RangeError("channel fragment arrived out of order");
		}
		if (this.pendingBytes + payload.byteLength > this.maxFrameBytes * MAX_CONCURRENT_FRAGMENT_TRANSFERS || transfer.bytes + payload.byteLength > this.maxFrameBytes) {
			this.discard(transferId, transfer);
			throw new RangeError("channel fragment transfer exceeds the frame limit");
		}
		transfer.parts.push(payload.slice());
		transfer.bytes += payload.byteLength;
		this.pendingBytes += payload.byteLength;
		transfer.nextIndex = index + 1;
		if (transfer.nextIndex < transfer.count) return { kind: "partial" };
		const frame = new Uint8Array(transfer.bytes);
		let offset = 0;
		for (const part of transfer.parts) {
			frame.set(part, offset);
			offset += part.byteLength;
		}
		this.discard(transferId, transfer);
		return { kind: "frame", frame };
	}

	reset(): void {
		this.transfers.clear();
		this.pendingBytes = 0;
	}

	private discard(transferId: number, transfer: PendingTransfer): void {
		this.transfers.delete(transferId);
		this.pendingBytes -= transfer.bytes;
		if (this.pendingBytes < 0) this.pendingBytes = 0;
	}
}

/** Successive transfer ids so a receiver can tell one transfer from the next. */
export function nextChannelTransferId(current: number): number {
	return !Number.isSafeInteger(current) || current < 0 || current >= MAX_TRANSFER_ID ? 0 : current + 1;
}
