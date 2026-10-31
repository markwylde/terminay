// Helper for named-pipe.mjs: connects to the pipe in argv[2] and writes what
// happened to the file in argv[3]. Run as a different local account.
import { writeFileSync } from 'node:fs';
import { connect } from 'node:net';

const [, , path, out] = process.argv;
const finish = (result) => {
	writeFileSync(out, result);
	process.exit(0);
};
setTimeout(() => finish('timeout'), 5_000);
const socket = connect(path);
let data = '';
socket.on('data', (chunk) => {
	data += chunk;
});
socket.on('end', () => finish(data.trim() === 'served' ? 'served' : `ended:${data.trim()}`));
socket.on('error', (error) => finish(`error:${error.code ?? String(error)}`));
