// usage: node lease-check.mjs <data-root> hold|try
import {
	DataRootInUseError,
	describeDataRootInUse,
	FileDataRootLease,
} from './dataRootLease.js';

const [root, mode] = process.argv.slice(2);
const lease = new FileDataRootLease();
try {
	await lease.acquire(root);
	console.log(`${mode}: ACQUIRED`);
	if (mode === 'hold') setInterval(() => {}, 1 << 30);
	else await lease.release(root);
} catch (error) {
	if (!(error instanceof DataRootInUseError)) throw error;
	process.stderr.write(
		describeDataRootInUse(error, {
			container: process.env.TERMINAY_MANAGED_BY === 'container',
		}),
	);
	process.exit(1);
}
