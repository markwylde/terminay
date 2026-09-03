import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

/**
 * A data-blind loopback relay for tests. It routes hosted signaling frames by
 * type only and never parses transcripts, so a host and a client in the same
 * process exercise the production message shapes end to end.
 */
export async function startHostedLoopbackRelay() {
	const http = createServer();
	const server = new WebSocketServer({ server: http, path: '/signal' });
	const state = { pairingHost: undefined, deviceHost: undefined, pairingClient: undefined, deviceClient: undefined, log: [], frames: [] };
	server.on('connection', (socket) => {
		socket.on('message', (raw) => {
			const message = JSON.parse(String(raw));
			state.log.push(message.type);
			state.frames.push(String(raw));
			switch (message.type) {
				case 'host-ready':
					state.pairingHost = socket;
					socket.send(JSON.stringify({ type: 'host-registered', roomId: message.roomId }));
					return;
				case 'device-host-ready':
					state.deviceHost = socket;
					socket.send(JSON.stringify({ type: 'device-host-registered', sessionId: message.sessionId }));
					return;
				case 'client-join':
					state.pairingClient = socket;
					state.pairingHost?.send(JSON.stringify(message));
					return;
				case 'answer':
				case 'ice':
					if (socket === state.pairingHost) state.pairingClient?.send(JSON.stringify(message));
					else state.pairingHost?.send(JSON.stringify(message));
					return;
				case 'offer':
					state.pairingClient?.send(JSON.stringify(message));
					return;
				case 'device-join':
					state.deviceClient = socket;
					state.deviceHost?.send(JSON.stringify(message));
					return;
				case 'device-offer':
				case 'device-ice':
					if (socket === state.deviceHost) state.deviceClient?.send(JSON.stringify(message));
					else state.deviceHost?.send(JSON.stringify(message));
					return;
				case 'device-answer':
					state.deviceHost?.send(JSON.stringify(message));
					return;
				default:
					return;
			}
		});
	});
	await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
	const port = http.address().port;
	return {
		port,
		state,
		close: async () => {
			for (const client of server.clients) client.terminate();
			await new Promise((resolve) => server.close(() => http.close(resolve)));
		},
	};
}
