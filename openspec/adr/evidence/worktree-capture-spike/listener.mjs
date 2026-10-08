// Spike listener: logs which parent session id each Git `start` event carries.
// usage: node listener.mjs <socket-path> <log-file> <seconds>
import { appendFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';

const [sock, log, seconds] = process.argv.slice(2);
rmSync(sock, { force: true });
const server = createServer((conn) => {
	let buf = '';
	conn.on('data', (chunk) => {
		buf += chunk;
		for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			try {
				const ev = JSON.parse(line);
				if (ev.event === 'start')
					appendFileSync(log, `${ev.sid.split('/')[0]}\t${(ev.argv ?? []).slice(0, 4).join(' ')}\n`);
			} catch {}
		}
	});
	conn.on('error', () => {});
});
server.listen(sock, () => appendFileSync(log, 'listening\n'));
setTimeout(() => { server.close(); rmSync(sock, { force: true }); process.exit(0); }, Number(seconds) * 1000);
