import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
/** Deterministic transport for scheduler tests. The bridge suite tests real Python framing. */
export function relayDriver() {
	const streams = new Map();
	return {
		/** Engine stats: tests set `stats` to `{ PIDs, PidsLimit }` or an Error. */
		stats: undefined,
		async run(args) {
			if (args[0] !== 'stats') return '';
			if (this.stats instanceof Error) throw this.stats;
			return JSON.stringify(this.stats ?? {});
		},
		connect(sessionId, servers) {
			const server = servers.find((s) => s.name === 'terminay_bot');
			const token = server.env.find(
				(e) => e.name === 'TERMINAY_RUNTIME_TOKEN',
			).value;
			const stream = streams.get('mcp-' + sessionId);
			for (const [id, method] of [
				[1, 'initialize'],
				[2, 'tools/list'],
			])
				stream.stdout.write(
					JSON.stringify({
						connection: 1,
						token,
						message: { jsonrpc: '2.0', id, method },
					}) + '\n',
				);
		},
		async exec(_container, args) {
			const ids = args[1] === '--kill-all' ? [...streams.keys()] : [args[2]];
			for (const id of ids) {
				streams.get(id)?.kill();
				streams.delete(id);
			}
			return '';
		},
		execStream(_container, args) {
			const stream = new EventEmitter();
			stream.stdin = new PassThrough();
			stream.stdout = new PassThrough();
			stream.stderr = new PassThrough();
			stream.kill = () => {
				stream.stdout.end();
				stream.stdin.destroy();
				stream.emit('close', 0);
			};
			streams.set(args[1], stream);
			queueMicrotask(() => stream.stdout.write('{"ready":true}\n'));
			return stream;
		},
	};
}
