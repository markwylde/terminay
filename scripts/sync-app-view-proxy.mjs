/**
 * The sandbox proxy (`public/app-view.html`) is also served by terminay.com for
 * hosted sessions, from a copy. Both repositories pin its digest in a test so
 * the copies cannot drift unnoticed. After changing the proxy, run this to
 * update the pin here and, given a terminay.com checkout, the copy and the pin
 * there.
 *
 * Usage: node scripts/sync-app-view-proxy.mjs [path to a terminay.com checkout]
 */
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proxy = path.join(root, 'public/app-view.html');
const digest = createHash('sha256').update(readFileSync(proxy)).digest('hex');
const PIN = /const PROXY_SHA256 = '[0-9a-f]{64}'/u;

function pin(file) {
	const text = readFileSync(file, 'utf8');
	if (!PIN.test(text)) throw new Error(`${file} has no PROXY_SHA256 to update`);
	writeFileSync(file, text.replace(PIN, `const PROXY_SHA256 = '${digest}'`));
	console.log(`pinned ${file}`);
}

pin(path.join(root, 'scripts/app-view-proxy-pin.test.mjs'));
const other = process.argv[2];
if (other !== undefined) {
	copyFileSync(proxy, path.join(other, 'app/src/app-view.html'));
	pin(path.join(other, 'specs/appView.test.mjs'));
}
console.log(digest);
