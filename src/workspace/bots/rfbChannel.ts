/**
 * A bot desktop stream as the WebSocket-like channel noVNC attaches to.
 *
 * The server relays RFB through the Terminay connection: it authenticates to
 * the bot's VNC service itself and offers this client security None, so the
 * password never reaches the renderer. Reads are pulled one at a time; writes
 * go out in order.
 */

import type { BotByteStreamClient } from '@terminay/client-core';

type MessageHandler = (event: { data: ArrayBuffer }) => void;

export class RfbStreamChannel {
	binaryType = 'arraybuffer';
	protocol = '';
	readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'open';
	onopen: () => void = () => {};
	onmessage: MessageHandler = () => {};
	onclose: (event: {
		code: number;
		reason: string;
		wasClean: boolean;
	}) => void = () => {};
	onerror: (event: unknown) => void = () => {};
	send: (data: ArrayBuffer | Uint8Array) => void;
	close: () => void;

	constructor(stream: BotByteStreamClient) {
		let queue = Promise.resolve();
		this.send = (data) => {
			if (this.readyState !== 'open') return;
			const bytes =
				data instanceof Uint8Array
					? data.slice()
					: new Uint8Array(data.slice(0));
			queue = queue
				.then(() => stream.write(bytes))
				.catch((error: unknown) => {
					this.onerror(error);
					this.close();
				});
		};
		this.close = () => {
			if (this.readyState === 'closed') return;
			this.readyState = 'closed';
			void stream.close();
			this.onclose({ code: 1000, reason: '', wasClean: true });
		};
		this.start = () => {
			if (started) return;
			started = true;
			void pump();
		};
		let started = false;
		const pump = async () => {
			try {
				for await (const chunk of stream.read()) {
					if (this.readyState !== 'open') break;
					const copy = new Uint8Array(chunk.length);
					copy.set(chunk);
					this.onmessage({ data: copy.buffer });
				}
			} catch (error) {
				this.onerror(error);
			}
			this.close();
		};
	}

	/** Begin reading; call once noVNC has attached its handlers. */
	readonly start: () => void;
}
