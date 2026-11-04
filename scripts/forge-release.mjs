import { createHash } from 'node:crypto';
import { createReadStream, openAsBlob } from 'node:fs';
import { appendFile, lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assetNames(tag, platform) {
	if (!/^v\d+\.\d+\.\d+$/u.test(tag ?? ''))
		throw new Error('Expected a stable vMAJOR.MINOR.PATCH tag');
	const version = tag.slice(1);
	const names = {
		mac: [
			`Terminay-Mac-${version}-Installer.dmg`,
			`Terminay-Mac-${version}.zip`,
			`Terminay-Mac-${version}.zip.blockmap`,
		],
		linux: [`Terminay-Linux-${version}.AppImage`],
	};
	if (platform && !names[platform]) throw new Error('Unsupported platform');
	return (platform ? names[platform] : Object.values(names).flat()).flatMap(
		(name) => [name, `${name}.sha256`],
	);
}

async function digest(stream) {
	const hash = createHash('sha256');
	for await (const chunk of stream) hash.update(chunk);
	return hash.digest('hex');
}

export class ForgeRelease {
	constructor({ server, repository, token, tag, commit, request = fetch }) {
		assetNames(tag);
		if (!/^[a-f0-9]{40}$/u.test(commit ?? ''))
			throw new Error('Expected a full source commit');
		if (!/^[\w.-]+\/[\w.-]+$/u.test(repository ?? '') || !token)
			throw new Error('Repository and workflow token are required');
		this.server = new URL(server);
		if (this.server.protocol !== 'https:')
			throw new Error('Forge server must use HTTPS');
		this.base = `${this.server.origin}/api/v1/repos/${repository}`;
		Object.assign(this, { token, tag, commit, request });
	}

	async api(path, { method = 'GET', body, missing = false } = {}) {
		const response = await this.request(`${this.base}${path}`, {
			method,
			headers: {
				Authorization: `token ${this.token}`,
				'Content-Type': 'application/json',
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(600_000),
			redirect: 'error',
		});
		if (missing && response.status === 404) return null;
		if (!response.ok)
			throw new Error(`Forge API ${method} ${path}: ${response.status}`);
		return response.status === 204 ? null : response.json();
	}

	async verifyTag() {
		const tag = await this.api(`/tags/${encodeURIComponent(this.tag)}`, {
			missing: true,
		});
		if (!tag || tag.commit?.sha !== this.commit)
			throw new Error('Release tag does not match the source commit');
	}

	async draft() {
		await this.verifyTag();
		const release = await this.api(
			`/releases/tags/${encodeURIComponent(this.tag)}`,
			{ missing: true },
		);
		if (!release?.draft || release.body?.split('\n')[0] !== this.marker())
			throw new Error(
				'Expected a workflow-owned draft for this commit; published releases are immutable',
			);
		return release;
	}

	marker() {
		return `Source commit: ${this.commit}`;
	}

	async prepare() {
		const existingTag = await this.api(
			`/tags/${encodeURIComponent(this.tag)}`,
			{ missing: true },
		);
		if (!existingTag)
			await this.api('/tags', {
				method: 'POST',
				body: { tag_name: this.tag, target: this.commit },
			});
		await this.verifyTag();
		const existing = await this.api(
			`/releases/tags/${encodeURIComponent(this.tag)}`,
			{ missing: true },
		);
		if (!existing)
			await this.api('/releases', {
				method: 'POST',
				body: {
					tag_name: this.tag,
					target_commitish: this.commit,
					name: this.tag,
					body: `${this.marker()}\n\nRelease build in progress.`,
					draft: true,
					prerelease: false,
				},
			});
		return this.draft();
	}

	async download(asset) {
		let url = new URL(asset.browser_download_url);
		for (let redirects = 0; redirects < 5; redirects++) {
			if (url.origin !== this.server.origin)
				throw new Error('Asset URL is outside the release forge');
			const response = await this.request(url, {
				headers: { Authorization: `token ${this.token}` },
				signal: AbortSignal.timeout(600_000),
				redirect: 'manual',
			});
			if ([301, 302, 303, 307, 308].includes(response.status)) {
				const location = response.headers.get('location');
				await response.body?.cancel();
				if (!location) throw new Error('Asset redirect has no location');
				url = new URL(location, url);
				continue;
			}
			if (!response.ok)
				throw new Error(`Asset download failed: ${response.status}`);
			return response;
		}
		throw new Error('Too many asset redirects');
	}

	async upload(platform, directory) {
		const release = await this.draft();
		const names = assetNames(this.tag, platform);
		for (const name of names) {
			const path = `${directory}/${name}`;
			if (!(await lstat(path)).isFile())
				throw new Error('Asset must be a regular file');
		}
		// Validate local sidecars before making any remote mutation.
		for (const name of names.filter((name) => !name.endsWith('.sha256'))) {
			const actual = await digest(createReadStream(`${directory}/${name}`));
			if (
				(await readFile(`${directory}/${name}.sha256`, 'utf8')) !==
				`${actual}  ${name}\n`
			)
				throw new Error('Local checksum mismatch');
		}
		const assets = await this.api(`/releases/${release.id}/assets?limit=100`);
		for (const name of names) {
			const path = `${directory}/${name}`;
			const existing = assets.find((asset) => asset.name === name);
			if (existing) {
				if (
					(await digest((await this.download(existing)).body)) !==
					(await digest(createReadStream(path)))
				)
					throw new Error(`Refusing to replace different bytes: ${name}`);
				continue;
			}
			const form = new FormData();
			form.set('attachment', await openAsBlob(path), basename(path));
			const response = await this.request(
				`${this.base}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
				{
					method: 'POST',
					headers: { Authorization: `token ${this.token}` },
					body: form,
					signal: AbortSignal.timeout(600_000),
					redirect: 'error',
				},
			);
			if (!response.ok)
				throw new Error(`Asset upload failed: ${response.status}`);
		}
	}

	async publish() {
		const release = await this.draft();
		const assets = await this.api(`/releases/${release.id}/assets?limit=100`);
		const expected = assetNames(this.tag);
		if (
			JSON.stringify(assets.map((asset) => asset.name).sort()) !==
			JSON.stringify(expected.sort())
		)
			throw new Error('Release asset inventory is incomplete or unexpected');
		for (const name of expected.filter((name) => !name.endsWith('.sha256'))) {
			const actual = await digest(
				(await this.download(assets.find((asset) => asset.name === name))).body,
			);
			const checksum = await (
				await this.download(
					assets.find((asset) => asset.name === `${name}.sha256`),
				)
			).text();
			if (checksum !== `${actual}  ${name}\n`)
				throw new Error(`Published checksum mismatch: ${name}`);
		}
		await this.verifyTag();
		await this.api(`/releases/${release.id}`, {
			method: 'PATCH',
			body: {
				draft: false,
				body: `${this.marker()}\n\nIndependently built macOS arm64 and Linux x64 desktop downloads.\n\nmacOS is signed and notarized. Each payload has a SHA-256 checksum sidecar.\n\nApplication updates continue to use the GitHub release feed.`,
			},
		});
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const [command, platform, directory] = process.argv.slice(2);
	const client = new ForgeRelease({
		server: process.env.FORGE_SERVER_URL,
		repository: process.env.FORGE_REPOSITORY,
		token: process.env.FORGE_TOKEN,
		tag: process.env.RELEASE_TAG,
		commit: process.env.RELEASE_COMMIT,
	});
	if (command === 'prepare') {
		await client.prepare();
		if (process.env.GITHUB_OUTPUT)
			await appendFile(
				process.env.GITHUB_OUTPUT,
				`tag=${client.tag}\nsource_commit=${client.commit}\n`,
			);
	} else if (command === 'upload' && platform && directory)
		await client.upload(platform, directory);
	else if (command === 'publish') await client.publish();
	else
		throw new Error(
			'usage: forge-release.mjs prepare | upload <mac|linux> <directory> | publish',
		);
}
