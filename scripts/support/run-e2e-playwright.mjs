#!/usr/bin/env node
// Runs the Playwright suite under Xvfb, as the E2E container's entrypoint does.
//
// A `--shard=K/N` argument is replaced by a list of the tests dealt to shard K
// (see e2e-shard-test-list.mjs). Every shard computes the same deal from the
// same image, so the lists are disjoint and cover the suite. If the deal
// cannot be computed, the argument is passed through and Playwright shards the
// suite itself: slower, never incomplete.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sharesSetup, shardTestLists } from './e2e-shard-test-list.mjs';

const args = process.argv.slice(2);
const shardAt = args.findIndex((arg) => /^--shard=\d+\/\d+$/u.test(arg));

if (shardAt !== -1) {
	const [current, total] = args[shardAt].slice('--shard='.length).split('/').map(Number);
	const others = args.filter((_, index) => index !== shardAt);
	try {
		if (current < 1 || current > total) throw new Error(`no shard ${current} of ${total}`);
		const listing = spawnSync(
			'npx',
			['playwright', 'test', '--list', '--reporter=json', ...others],
			{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
		);
		if (listing.status !== 0)
			throw new Error(`listing the suite failed:\n${listing.stderr}`);
		const report = JSON.parse(listing.stdout.slice(listing.stdout.indexOf('{')));
		const sources = new Map();
		const keepsTogether = (file) => {
			if (!sources.has(file))
				sources.set(file, sharesSetup(readFileSync(join(report.config.rootDir, file), 'utf8')));
			return sources.get(file);
		};
		const lines = shardTestLists(report, keepsTogether, total)[current - 1];
		const listPath = join(mkdtempSync(join(tmpdir(), 'terminay-e2e-shard-')), 'tests.txt');
		writeFileSync(listPath, `${lines.join('\n')}\n`);
		args.splice(0, args.length, ...others, `--test-list=${listPath}`);
		process.stdout.write(`Shard ${current} of ${total}: ${lines.length} entries dealt from the suite\n`);
	} catch (error) {
		process.stderr.write(
			`Could not deal the suite to shards; Playwright will shard it instead: ${error instanceof Error ? error.message : String(error)}\n`,
		);
	}
}

const child = spawn('xvfb-run', ['--auto-servernum', 'npx', 'playwright', 'test', ...args], {
	stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
	process.on(signal, () => child.kill(signal));
child.on('error', (error) => {
	process.stderr.write(`${error.message}\n`);
	process.exit(127);
});
child.on('close', (status, signal) => process.exit(status ?? (signal ? 1 : 0)));
