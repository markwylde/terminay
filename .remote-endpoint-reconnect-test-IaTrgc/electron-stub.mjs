import { EventEmitter } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
export const ipcMain = new EventEmitter();
function port(native) {
	return {
		on: (name, listener) =>
			native.on(name, name === 'message' ? (data) => listener({ data }) : listener),
		start: () => native.start(),
		close: () => native.close(),
		postMessage: (value) => native.postMessage(value),
	};
}
export class MessageChannelMain {
	constructor() {
		const channel = new MessageChannel();
		this.port1 = port(channel.port1);
		this.port2 = port(channel.port2);
	}
}
