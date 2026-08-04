import { fstatSync } from 'node:fs';
import { readHeadlessPassphrase } from './vault-reference.mjs';

const kind = process.argv[2];
const source =
	kind === 'tty' ? { kind: 'tty' } : { kind: 'inherited-fd', fd: 3 };

const passphrase = readHeadlessPassphrase(
	source,
	kind === 'tty'
		? {
				onReady() {
					process.stdout.write('TERMINAY_TTY_READY\n');
				},
			}
		: undefined,
);
const length = passphrase.length;
passphrase.fill(0);

let fdClosed = true;
if (kind !== 'tty') {
	try {
		fstatSync(3);
		fdClosed = false;
	} catch (error) {
		if (error?.code !== 'EBADF') {
			throw error;
		}
	}
}

process.stdout.write(
	`${JSON.stringify({
		length,
		zeroized: passphrase.every((byte) => byte === 0),
		fdClosed,
	})}\n`,
);
