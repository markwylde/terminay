import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { runSystemdRestart, SCENARIOS } from './standalone-systemd-restart.mjs';

/**
 * ADR-0116's gate. The real run needs a privileged systemd container and an
 * archive for the daemon's architecture, so it runs when
 * TERMINAY_SYSTEMD_ARCHIVE names one (the `standalone-systemd-restart` CI job
 * does). The contract below holds everywhere.
 */

const archive = process.env.TERMINAY_SYSTEMD_ARCHIVE;

test('a real restart under systemd keeps old and new terminals able to use /tmp', {
	skip: archive === undefined && 'set TERMINAY_SYSTEMD_ARCHIVE to an archive to run it',
	timeout: 30 * 60 * 1000,
}, () => {
	runSystemdRestart({ archive, scenarios: SCENARIOS });
});

test('the driver judges every terminal from its own shell output, through the real server', async () => {
	const driver = await readFile(new URL('standalone-systemd-restart/driver.mjs', import.meta.url), 'utf8');
	// A marker the shell assembles, so an echo of the typed command never passes.
	assert.match(driver, /echo "SR""-OK-\$\{tag\}"/u);
	assert.match(driver, /'\/opt\/terminay\/current\/bin\/terminay-server',\s*'mcp'/u);
	// The installed unit, real systemd, the real upgrade helper.
	assert.match(driver, /localArchivePath: ARCHIVE/u);
	assert.match(driver, /systemctl\('restart', UNIT\)/u);
	assert.match(driver, /'terminay-upgrade\.service'/u);
	// B waits for an older upgrader's oneshot, and the request must follow it.
	assert.match(driver, /sleep 10; rm -f/u);
	assert.match(driver, /the request was written while the helper was still running/u);
	// C repairs with the release host unreachable.
	assert.match(driver, /127\.0\.0\.1 api\.github\.com/u);
	assert.deepEqual([...SCENARIOS], ['A', 'B', 'C']);
});

test('CI runs it on every pull request against the archive this commit builds', async () => {
	const ci = await readFile(new URL('../.gitea/workflows/ci.yml', import.meta.url), 'utf8');
	const start = ci.indexOf('\n  standalone-systemd-restart:\n');
	assert.notEqual(start, -1, 'the standalone-systemd-restart job exists');
	const rest = ci.slice(start + 1);
	const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/u);
	const body = next === -1 ? rest : rest.slice(0, next + 1);
	assert.match(body, /build-linux-standalone-archive\.sh linux-x64/u);
	assert.match(body, /node scripts\/standalone-systemd-restart\.mjs --archive/u);
	assert.match(body, /timeout-minutes: \d+/u);
});
