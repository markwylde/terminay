import assert from 'node:assert/strict';
import test from 'node:test';

import { archiveName, ROLLING_TAG, resolveRef } from '../dist/resolve.js';
import { createFakeBin } from './fake-bin.mjs';
import {
	expandedAssets,
	html,
	json,
	releaseDocument,
	startHttpsFixture,
} from './https-fixture.mjs';

const TAG_ASSETS = [
	'terminay-server-4.1.1-linux-x64.tar.gz',
	'terminay-server-4.1.1-linux-x64.tar.gz.sha256',
	'terminay-server-4.1.1-linux-x64.tar.gz.sig',
	'terminay-server-4.1.1-linux-arm64.tar.gz',
	'terminay-server-4.1.1-linux-arm64.tar.gz.sha256',
	'terminay-server-4.1.1-linux-arm64.tar.gz.sig',
];

const ROLLING_ASSETS = [
	'terminay-server-main-linux-x64.tar.gz',
	'terminay-server-main-linux-x64.tar.gz.sha256',
	'terminay-server-main-linux-x64.tar.gz.sig',
	'terminay-server-main-linux-arm64.tar.gz',
	'terminay-server-main-linux-arm64.tar.gz.sha256',
	'terminay-server-main-linux-arm64.tar.gz.sig',
];

/** Serves the two GitHub surfaces the resolver uses, with per-test overrides. */
async function withGitHub(options, run) {
	const seen = [];
	const fixture = await startHttpsFixture((request, response) => {
		seen.push(request.url);
		const url = request.url ?? '';
		if (options.apiDown === true && url.startsWith('/repos/')) {
			json(response, 403, { message: 'API rate limit exceeded' });
			return;
		}
		if (url === '/repos/markwylde/terminay/releases/latest') {
			json(response, 200, releaseDocument('v4.1.1', TAG_ASSETS));
			return;
		}
		if (url === '/repos/markwylde/terminay/releases/tags/v4.1.1') {
			json(response, 200, releaseDocument('v4.1.1', TAG_ASSETS));
			return;
		}
		if (url === `/repos/markwylde/terminay/releases/tags/${ROLLING_TAG}`) {
			json(response, 200, releaseDocument(ROLLING_TAG, ROLLING_ASSETS));
			return;
		}
		if (url === '/repos/markwylde/terminay/releases/tags/v9.9.9') {
			json(
				response,
				200,
				releaseDocument('v9.9.9', ['terminay-server-9.9.9-linux-x64.tar.gz']),
			);
			return;
		}
		if (url === '/markwylde/terminay/releases/latest') {
			response.writeHead(302, {
				location: '/markwylde/terminay/releases/tag/v4.1.1',
			});
			response.end();
			return;
		}
		if (url === '/markwylde/terminay/releases/expanded_assets/v4.1.1') {
			html(response, 200, expandedAssets('v4.1.1', TAG_ASSETS));
			return;
		}
		if (url === `/markwylde/terminay/releases/expanded_assets/${ROLLING_TAG}`) {
			html(response, 200, expandedAssets(ROLLING_TAG, ROLLING_ASSETS));
			return;
		}
		if (url === '/markwylde/terminay/releases/expanded_assets/v9.9.9') {
			html(
				response,
				200,
				expandedAssets('v9.9.9', ['terminay-server-9.9.9-linux-x64.tar.gz']),
			);
			return;
		}
		json(response, 404, { message: 'Not Found' });
	});
	try {
		await run(
			{
				apiBase: fixture.origin,
				webBase: fixture.origin,
				architecture: options.architecture ?? 'x64',
			},
			seen,
		);
	} finally {
		await fixture.close();
	}
}

test('no reference resolves the newest tagged release', async () => {
	await withGitHub({}, async (options) => {
		const resolved = await resolveRef(undefined, options);
		assert.equal(resolved.channel, 'tag');
		assert.equal(resolved.version, '4.1.1');
		assert.equal(resolved.tag, 'v4.1.1');
		assert.match(
			resolved.assets.archive,
			/\/releases\/download\/v4\.1\.1\/terminay-server-4\.1\.1-linux-x64\.tar\.gz$/u,
		);
		assert.equal(resolved.assets.sha256, `${resolved.assets.archive}.sha256`);
		assert.equal(resolved.assets.signature, `${resolved.assets.archive}.sig`);
	});
});

test('an explicit tag resolves that release', async () => {
	await withGitHub({}, async (options) => {
		const resolved = await resolveRef('v4.1.1', options);
		assert.equal(resolved.channel, 'tag');
		assert.equal(resolved.version, '4.1.1');
		assert.equal(resolved.publishedAt, '2026-09-08T13:32:38Z');
	});
});

test('main resolves the rolling prerelease, which is not tagged for the branch', async () => {
	await withGitHub({}, async (options) => {
		const resolved = await resolveRef('main', options);
		assert.equal(resolved.channel, 'main');
		assert.equal(resolved.version, 'main');
		assert.equal(resolved.tag, 'main-latest');
		// A release tagged `main` would make `main` ambiguous in every clone.
		assert.notEqual(resolved.tag, 'main');
		assert.match(
			resolved.assets.archive,
			/terminay-server-main-linux-x64\.tar\.gz$/u,
		);
	});
});

test('the host architecture selects the archive', async () => {
	await withGitHub({ architecture: 'arm64' }, async (options) => {
		const resolved = await resolveRef('v4.1.1', options);
		assert.match(resolved.assets.archive, /linux-arm64\.tar\.gz$/u);
	});
	assert.equal(
		archiveName('4.1.1', 'arm64'),
		'terminay-server-4.1.1-linux-arm64.tar.gz',
	);
});

test('a release without an archive for this architecture fails and names both', async () => {
	await withGitHub({ architecture: 'arm64' }, async (options) => {
		await assert.rejects(
			() => resolveRef('v9.9.9', options),
			(error) =>
				error.message.includes('arm64') && error.message.includes('v9.9.9'),
		);
	});
});

test('a rate-limited API falls back to the release page', async () => {
	await withGitHub({ apiDown: true }, async (options, seen) => {
		const resolved = await resolveRef('v4.1.1', options);
		assert.equal(resolved.version, '4.1.1');
		assert.ok(
			seen.some((url) => url.includes('/expanded_assets/')),
			'expected the release page fallback',
		);
	});
	await withGitHub({ apiDown: true }, async (options) => {
		const resolved = await resolveRef(undefined, options);
		assert.equal(resolved.tag, 'v4.1.1');
	});
});

test('a rate-limited API still reports a missing architecture', async () => {
	await withGitHub(
		{ apiDown: true, architecture: 'arm64' },
		async (options) => {
			await assert.rejects(() => resolveRef('v9.9.9', options), /arm64/u);
		},
	);
});

test('a branch resolves to a source build at the tip git reports', async () => {
	const revision = 'b'.repeat(40);
	const fake = await createFakeBin();
	fake.install('git', `echo "${revision}\trefs/heads/feature/x"`);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		const resolved = await resolveRef('feature/x', { architecture: 'x64' });
		assert.equal(resolved.channel, 'source');
		assert.equal(resolved.revision, revision);
		assert.equal(resolved.sourceRef, 'feature/x');
		assert.ok(
			fake.invocations().some((line) => line.startsWith('git ls-remote')),
			'expected git ls-remote to resolve the branch',
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('a reference that is neither a release nor a git ref fails clearly', async () => {
	const fake = await createFakeBin();
	fake.install('git', 'exit 2');
	const originalPath = process.env.PATH;
	process.env.PATH = `${fake.directory}:${originalPath}`;
	try {
		await assert.rejects(
			() => resolveRef('not-a-thing', { architecture: 'x64' }),
			/could not resolve "not-a-thing" as a release, a branch, or a commit/u,
		);
	} finally {
		process.env.PATH = originalPath;
		await fake.close();
	}
});

test('a full commit sha resolves to a source build without any network call', async () => {
	const revision = 'a'.repeat(40);
	const resolved = await resolveRef(revision, {
		architecture: 'x64',
		apiBase: 'https://127.0.0.1:1',
		webBase: 'https://127.0.0.1:1',
	});
	assert.equal(resolved.channel, 'source');
	assert.equal(resolved.revision, revision);
	assert.equal(resolved.sourceRef, revision);
	assert.equal(resolved.assets, undefined);
});
