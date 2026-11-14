// Refresh the deterministic shard estimates from downloaded Gitea job logs.
// Example (list discovery does not run Electron):
// node node_modules/playwright/cli.js test --list --reporter=json > /tmp/list.json
// node scripts/update-e2e-duration-snapshot.mjs /tmp/list.json \
//   https://git.i.wylde.net/markwylde/terminay/actions/runs/25305 /tmp/job-*.log
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { listedTests, timingKey } from './support/e2e-shard-test-list.mjs';

// CI displays both title-path delimiters and punctuation inside titles alike.
// Normalization also carries evidence across the delimiter repair. Ambiguous
// identities are rejected instead of attributing a duration to the wrong test.
const displayKey = (value) => value.replace(/\s*[›:]\s*/gu, ' › ');

export function durationSnapshot(listing, evidence, source) {
	const identities = new Map();
	for (const test of listedTests(listing)) {
		const display = displayKey([test.file, ...test.titles].join(' › '));
		if (identities.has(display)) throw new Error(`ambiguous timing identity: ${display}`);
		identities.set(display, timingKey(test));
	}
	const observations = new Map();
	const inputs = [];
	for (const { name, content } of evidence) {
		inputs.push({ name, sha256: createHash('sha256').update(content).digest('hex') });
		for (const line of content.split('\n')) {
			// Only successful attempts; retries and skipped tests do not become
			// misleading near-zero estimates. The printed durations are rounded.
			const match = line.match(/✓\s+\d+\s+e2e\/(.+?\.spec\.ts):\d+:\d+\s+›\s+(.+?)\s+\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/u);
			if (!match) continue;
			const displayed = `${match[1]} › ${match[2].replace(/ \(retry #\d+\)$/u, '')}`;
			const key = identities.get(displayKey(displayed))
				?? identities.get(displayKey(displayed.replace(/(?:\s+@[\w-]+)+$/u, '')));
			if (!key) continue; // Removed/renamed scenarios use fallback estimates.
			const duration = Number(match[3]) * ({ ms: 1, s: 1000, m: 60_000 }[match[4]]);
			// Sub-millisecond tests print 0ms; keep a positive estimate.
			const estimate = Math.max(1, duration);
			const values = observations.get(key) ?? [];
			values.push(estimate);
			observations.set(key, values);
		}
	}
	const durations = {};
	for (const key of [...observations.keys()].sort()) {
		const values = observations.get(key).sort((a, b) => a - b);
		const middle = Math.floor(values.length / 2);
		durations[key] = Math.ceil(values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2);
	}
	if (!Object.keys(durations).length) throw new Error('no successful test durations matched the listing');
	return {
		version: 1,
		source,
		method: 'Median successful attempt duration from Playwright list-reporter job logs; rounded milliseconds, minimum 1ms. Missing tests use 10 seconds, or 60 seconds for @heavy.',
		inputs,
		durations,
	};
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const [listingPath, source, ...paths] = process.argv.slice(2);
	if (!listingPath || !source || !paths.length) throw new Error('usage: update-e2e-duration-snapshot.mjs LISTING_JSON SOURCE_URL JOB_LOG...');
	const evidence = paths.sort().map((path) => ({ name: basename(path), content: readFileSync(path, 'utf8') }));
	process.stdout.write(`${JSON.stringify(durationSnapshot(JSON.parse(readFileSync(listingPath, 'utf8')), evidence, source), null, 2)}\n`);
}
