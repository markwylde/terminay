// usage: node lock-spike.mjs <dir> hold|try
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [dir, mode] = process.argv.slice(2);
const db = new DatabaseSync(join(dir, 'lock.sqlite'));
try {
	db.exec('BEGIN EXCLUSIVE');
	console.log(`${mode}: ACQUIRED pid=${process.pid}`);
	if (mode === 'hold') setInterval(() => {}, 1 << 30);
	else {
		db.exec('ROLLBACK');
		db.close();
	}
} catch (error) {
	console.log(
		`${mode}: REFUSED code=${error.code} errcode=${error.errcode} msg=${error.message}`,
	);
	process.exit(3);
}
