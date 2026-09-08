import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { buildArchiveFixture } from './archive-fixture.mjs';
import {
	expandedAssets,
	html,
	json,
	releaseDocument,
	startHttpsFixture,
} from './https-fixture.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(new URL('../../..', import.meta.url).pathname);

/**
 * A local stand-in for the GitHub release surface: resolvable releases whose
 * archives are really built, really checksummed, and really signed with the
 * repository's own signing script.
 */
export async function startReleaseFixture(options) {
	const { directory, releases } = options;
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const publicPem = publicKey
		.export({ type: 'spki', format: 'pem' })
		.toString();
	const keyEnv = {
		TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64: Buffer.from(
			privateKey.export({ type: 'pkcs8', format: 'pem' }),
		).toString('base64'),
		TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64: Buffer.from(
			publicKey.export({ type: 'spki', format: 'pem' }),
		).toString('base64'),
	};

	const assets = new Map();
	const built = new Map();
	for (const release of releases) {
		const fixture = await buildArchiveFixture({
			directory,
			version: release.assetVersion ?? release.version,
			channel: release.channel ?? 'tag',
			revision: release.revision,
			architecture: 'x64',
			target: 'linux-x64',
		});
		const bytes = await readFile(fixture.archivePath);
		const digest = createHash('sha256').update(bytes).digest('hex');
		const name = `terminay-server-${release.assetVersion ?? release.version}-linux-x64.tar.gz`;
		await writeFile(`${fixture.archivePath}.sha256`, `${digest}  ${name}\n`);
		await execFileAsync(
			'node',
			[
				join(repositoryRoot, 'scripts/release-signature.mjs'),
				'sign',
				fixture.archivePath,
				`${fixture.archivePath}.sig`,
			],
			{ env: { ...process.env, ...keyEnv } },
		);
		assets.set(`${release.tag}/${name}`, bytes);
		assets.set(
			`${release.tag}/${name}.sha256`,
			await readFile(`${fixture.archivePath}.sha256`),
		);
		assets.set(
			`${release.tag}/${name}.sig`,
			await readFile(`${fixture.archivePath}.sig`),
		);
		built.set(release.tag, { name, manifest: fixture.manifest });
	}

	const latest =
		releases.find((release) => release.latest === true) ?? releases[0];

	const server = await startHttpsFixture((request, response) => {
		const url = request.url ?? '';
		const download = /^\/markwylde\/terminay\/releases\/download\/(.+)$/u.exec(
			url,
		);
		if (download !== null) {
			const key = decodeURIComponent(download[1]);
			const bytes = assets.get(key);
			if (bytes === undefined) {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, { 'content-length': bytes.length });
			response.end(bytes);
			return;
		}
		if (url === '/repos/markwylde/terminay/releases/latest') {
			json(
				response,
				200,
				releaseDocument(
					latest.tag,
					[built.get(latest.tag).name],
					latest.publishedAt,
				),
			);
			return;
		}
		const tagged = /^\/repos\/markwylde\/terminay\/releases\/tags\/(.+)$/u.exec(
			url,
		);
		if (tagged !== null) {
			const tag = decodeURIComponent(tagged[1]);
			const release = releases.find((entry) => entry.tag === tag);
			if (release === undefined) {
				json(response, 404, { message: 'Not Found' });
				return;
			}
			json(
				response,
				200,
				releaseDocument(tag, [built.get(tag).name], release.publishedAt),
			);
			return;
		}
		const expanded =
			/^\/markwylde\/terminay\/releases\/expanded_assets\/(.+)$/u.exec(url);
		if (expanded !== null) {
			const tag = decodeURIComponent(expanded[1]);
			html(response, 200, expandedAssets(tag, [built.get(tag)?.name ?? '']));
			return;
		}
		json(response, 404, { message: 'Not Found' });
	});

	return { ...server, publicPem, built };
}
