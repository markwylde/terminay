/**
 * The transport-neutral shape of one server-owned WebRTC data channel.
 *
 * A concrete host (the hosted pairing host, or a Desktop transport) adapts its
 * native channel to this interface; `HeadlessChannelTransport` then turns it
 * into the canonical ByteTransport. Nothing here knows about WebRTC, Electron,
 * or a specific runtime.
 */
export type HeadlessDataChannelState =
	| 'connecting'
	| 'open'
	| 'closing'
	| 'closed';

export interface HeadlessDataChannel {
	readonly label: string;
	readonly readyState: HeadlessDataChannelState;
	readonly bufferedAmount: number;
	send(frame: Uint8Array): void;
	close(): void;
	onMessage(listener: (frame: Uint8Array) => void): () => void;
	onStateChange(
		listener: (state: HeadlessDataChannelState) => void,
	): () => void;
}
