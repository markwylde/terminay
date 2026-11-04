import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { assetNames, ForgeRelease } from './forge-release.mjs';
import { selectForgeReleaseTag } from './forge-release-version.mjs';

const commit = 'a'.repeat(40);
const tag = 'v1.2.3';
const notes =
	'Terminay has a clearer release workflow.\n\n## Changes\n\n### Releases\n- Generated useful release notes.\n';

function harness() {
	const state = {
		tag: null,
		release: null,
		assets: [],
		bytes: new Map(),
		writes: 0,
	};
	const json = (value, status = 200) =>
		new Response(JSON.stringify(value), { status });
	const request = async (url, options) => {
		assert.equal(options.headers.Authorization, 'token secret');
		const parsed = new URL(url);
		assert.equal(
			options.redirect,
			parsed.pathname.startsWith('/download/') ? 'manual' : 'error',
		);
		const path = parsed.pathname.replace('/api/v1/repos/owner/repo', '');
		const method = options.method ?? 'GET';
		if (method !== 'GET') state.writes++;
		if (path === `/tags/${tag}`)
			return state.tag ? json({ commit: { sha: state.tag } }) : json({}, 404);
		if (path === '/tags') {
			state.tag = JSON.parse(options.body).target;
			return json({});
		}
		if (path === `/releases/tags/${tag}`)
			return state.release ? json(state.release) : json({}, 404);
		if (path === '/releases') {
			state.release = { id: 1, ...JSON.parse(options.body) };
			return json(state.release);
		}
		if (path === '/releases/1' && method === 'PATCH') {
			Object.assign(state.release, JSON.parse(options.body));
			return json(state.release);
		}
		if (path === '/releases/1/assets' && method === 'GET')
			return json(state.assets);
		if (path === '/releases/1/assets' && method === 'POST') {
			const name = parsed.searchParams.get('name');
			state.bytes.set(
				name,
				Buffer.from(await options.body.get('attachment').arrayBuffer()),
			);
			state.assets.push({
				name,
				browser_download_url: `https://forge.test/download/${name}`,
			});
			return json({});
		}
		if (path.startsWith('/download/'))
			return new Response(state.bytes.get(path.slice('/download/'.length)));
		throw new Error(`Unexpected request: ${method} ${path}`);
	};
	const client = new ForgeRelease({
		server: 'https://forge.test',
		repository: 'owner/repo',
		token: 'secret',
		tag,
		commit,
		request,
	});
	return { client, state };
}

async function fixtures(t) {
	const directory = await mkdtemp(join(tmpdir(), 'forge-release-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	for (const name of assetNames(tag).filter(
		(name) => !name.endsWith('.sha256'),
	)) {
		const bytes = Buffer.from(`payload ${name}`);
		await writeFile(join(directory, name), bytes);
		await writeFile(
			join(directory, `${name}.sha256`),
			`${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`,
		);
	}
	return directory;
}

test('independent two-platform release verifies remote bytes and publishes; identical retries do not upload again', async (t) => {
	const { client, state } = harness();
	const directory = await fixtures(t);
	await client.prepare();
	assert.equal(state.release.draft, true);
	await client.upload('mac', directory);
	await assert.rejects(client.publish(notes), /inventory/);
	assert.equal(state.release.draft, true);
	await client.upload('linux', directory);
	const writes = state.writes;
	await client.prepare();
	await client.upload('mac', directory);
	assert.equal(state.writes, writes);
	await client.publish(notes);
	assert.equal(state.release.draft, false);
	assert.match(state.release.body, /GitHub release feed/);
	assert.ok(state.release.body.includes(notes.trim()));
	assert.equal(state.release.body.split('\n')[0], `Source commit: ${commit}`);
	await assert.rejects(client.prepare(), /immutable/);
	await assert.rejects(client.upload('linux', directory), /immutable/);
});

test('conflicting source tags and foreign drafts are rejected without writes', async () => {
	const { client, state } = harness();
	state.tag = 'b'.repeat(40);
	await assert.rejects(client.prepare(), /source commit/);
	assert.equal(state.writes, 0);
	state.tag = commit;
	state.release = { id: 1, draft: true, body: 'A different release' };
	await assert.rejects(client.prepare(), /workflow-owned/);
	assert.equal(state.writes, 0);
});

test('missing, blank or oversized release notes cannot publish or mutate a draft', async () => {
	const { client, state } = harness();
	await client.prepare();
	const writes = state.writes;
	for (const notes of [undefined, '', ' \n', 'a'.repeat(128 * 1024 + 1)]) {
		await assert.rejects(client.publish(notes), /release notes/);
		assert.equal(state.writes, writes);
		assert.equal(state.release.draft, true);
	}
});

test('publication consumes the exact notes saved before builds and refuses drafts without them', async (t) => {
	const { client, state } = harness();
	await client.prepare();
	await assert.rejects(client.publishSavedNotes(), /no saved release notes/);
	await client.saveNotes(notes);
	const directory = await fixtures(t);
	await client.upload('mac', directory);
	await client.upload('linux', directory);
	await client.publishSavedNotes();
	assert.equal(state.release.draft, false);
	assert.ok(state.release.body.includes(notes.trim()));
});

test('the actual preflight fails on HTTP 401 and saves Markdown only on provider success', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'forge-ai-preflight-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const execute = promisify(execFile);
	const git = (...args) => execute('git', args, { cwd: directory });
	await git('init');
	await git('config', 'user.name', 'Release Test');
	await git('config', 'user.email', 'release@example.test');
	await git(
		'-c',
		'commit.gpgsign=false',
		'commit',
		'--allow-empty',
		'-m',
		'fix: verify the credential first',
	);
	const revision = (await git('rev-parse', 'HEAD')).stdout.trim();
	await mkdir(join(directory, '.github/prompts'), { recursive: true });
	await writeFile(
		join(directory, '.github/prompts/github-create-release.md'),
		'Generate release notes.',
	);
	const script = new URL('./prepare-forge-release-notes.mjs', import.meta.url)
		.pathname;
	const env = {
		...process.env,
		RELEASE_COMMIT: revision,
		OPENROUTER_API_KEY: 'test-key',
	};
	const preload = (status) =>
		`--import=data:text/javascript,${encodeURIComponent(`globalThis.fetch = async () => new Response(JSON.stringify({choices:[{message:{content:${JSON.stringify(notes)}}}]}), {status:${status}});`)}`;
	await assert.rejects(
		execute(process.execPath, [script], {
			cwd: directory,
			env: { ...env, NODE_OPTIONS: preload(401) },
		}),
		(error) => {
			assert.match(error.stderr, /HTTP 401/);
			return true;
		},
	);
	await assert.rejects(readFile(join(directory, 'RELEASE.md')), /ENOENT/);
	await execute(process.execPath, [script], {
		cwd: directory,
		env: { ...env, NODE_OPTIONS: preload(200) },
	});
	assert.equal(await readFile(join(directory, 'RELEASE.md'), 'utf8'), notes);
});

test('desktop fallback describes shipped downloads while preserving the GitHub default', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'forge-fallback-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const execute = promisify(execFile);
	const git = (...args) => execute('git', args, { cwd: directory });
	await git('init');
	await git('config', 'user.name', 'Release Test');
	await git('config', 'user.email', 'release@example.test');
	await git(
		'-c',
		'commit.gpgsign=false',
		'commit',
		'--allow-empty',
		'-m',
		'fix: clarify releases',
	);
	await git('tag', tag);
	const script = new URL(
		'./generate-fallback-release-notes.mjs',
		import.meta.url,
	).pathname;
	await execute(process.execPath, [script, tag, '--desktop-only'], {
		cwd: directory,
	});
	const desktop = await readFile(join(directory, 'RELEASE.md'), 'utf8');
	assert.match(desktop, /### Included work/);
	assert.match(desktop, /fix: clarify releases/);
	assert.match(desktop, /notarized macOS.*Linux/);
	assert.doesNotMatch(desktop, /standalone server/);
	await execute(process.execPath, [script, tag], { cwd: directory });
	assert.match(
		await readFile(join(directory, 'RELEASE.md'), 'utf8'),
		/Desktop and standalone server/,
	);
});

test('automatic preparation resumes drafts and skips only matching published releases', async () => {
	const { client, state } = harness();
	assert.equal(await client.prepareAutomatic(), true);
	const writes = state.writes;
	assert.equal(await client.prepareAutomatic(), true);
	assert.equal(state.writes, writes);
	state.release.draft = false;
	assert.equal(await client.prepareAutomatic(), false);
	assert.equal(state.writes, writes);
	state.tag = 'b'.repeat(40);
	await assert.rejects(client.prepareAutomatic(), /source commit/);
	state.tag = commit;
	state.release.body = 'Some other workflow';
	await assert.rejects(client.prepareAutomatic(), /workflow-owned/);
});

test('automatic versions use GitHub commit rules and reuse tags at the selected commit', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'forge-version-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const execute = promisify(execFile);
	const git = async (...args) =>
		(await execute('git', args, { cwd: directory })).stdout.trim();
	await git('init');
	await git('config', 'user.name', 'Release Test');
	await git('config', 'user.email', 'release@example.test');
	await git(
		'-c',
		'commit.gpgsign=false',
		'commit',
		'--allow-empty',
		'-m',
		'feat: initial release',
	);
	let revision = await git('rev-parse', 'HEAD');
	assert.equal(
		await selectForgeReleaseTag({ cwd: directory, commit: revision }),
		'v0.1.0',
	);
	await git('tag', 'v1.2.3');
	for (const [message, expected] of [
		['fix: repair startup', 'v1.2.4'],
		['feat: add a command', 'v1.3.0'],
		['feat!: replace protocol', 'v2.0.0'],
	]) {
		await git(
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--allow-empty',
			'-m',
			message,
		);
		revision = await git('rev-parse', 'HEAD');
		assert.equal(
			await selectForgeReleaseTag({ cwd: directory, commit: revision }),
			expected,
		);
	}
	await git('tag', 'v2.0.0');
	await git('tag', 'v999.0.0-beta.1');
	assert.equal(
		await selectForgeReleaseTag({ cwd: directory, commit: revision }),
		'v2.0.0',
	);
});

test('corrupted remote bytes and unexpected assets keep release draft', async (t) => {
	const { client, state } = harness();
	const directory = await fixtures(t);
	await client.prepare();
	await client.upload('mac', directory);
	await client.upload('linux', directory);
	const name = assetNames(tag)[0];
	state.bytes.set(name, Buffer.from('corrupted'));
	await assert.rejects(client.publish(notes), /checksum mismatch/);
	await assert.rejects(client.upload('mac', directory), /different bytes/);
	assert.equal(state.release.draft, true);
	state.assets.push({ name: 'unexpected.exe' });
	await assert.rejects(client.publish(notes), /inventory/);
});

test('invalid local checksums and symlinks never upload', async (t) => {
	const { client, state } = harness();
	const directory = await fixtures(t);
	await client.prepare();
	await writeFile(join(directory, assetNames(tag, 'linux')[1]), 'bad checksum');
	await assert.rejects(client.upload('linux', directory), /Local checksum/);
	assert.equal(state.assets.length, 0);
	const name = assetNames(tag, 'mac')[0];
	await rm(join(directory, name));
	await symlink(
		join(directory, assetNames(tag, 'mac')[2]),
		join(directory, name),
	);
	await assert.rejects(client.upload('mac', directory), /regular file/);
	assert.equal(state.assets.length, 0);
});

test('invalid versions, revisions, repositories, platforms and external download origins fail closed', async () => {
	assert.throws(() => assetNames('main'), /stable/);
	assert.throws(() => assetNames(tag, 'win'), /platform/);
	assert.throws(() => new ForgeRelease({ tag, commit: 'main' }), /full source/);
	const { client } = harness();
	await assert.rejects(
		client.download({ browser_download_url: 'https://other.test/file' }),
		/outside/,
	);
});

test('asset redirects stay on the authenticated forge and API errors fail closed', async () => {
	const { client } = harness();
	const visited = [];
	client.request = async (url, options) => {
		visited.push(String(url));
		assert.equal(options.headers.Authorization, 'token secret');
		return visited.length === 1
			? new Response(null, {
					status: 302,
					headers: { location: '/attachment/file' },
				})
			: new Response('payload');
	};
	assert.equal(
		await (
			await client.download({
				browser_download_url: 'https://forge.test/download/file',
			})
		).text(),
		'payload',
	);
	assert.deepEqual(visited, [
		'https://forge.test/download/file',
		'https://forge.test/attachment/file',
	]);
	client.request = async () =>
		new Response(null, {
			status: 302,
			headers: { location: 'https://other.test/file' },
		});
	await assert.rejects(
		client.download({ browser_download_url: 'https://forge.test/file' }),
		/outside/,
	);
	client.request = async () => new Response('failure', { status: 403 });
	await assert.rejects(client.prepare(), /403/);
});

test('forge workflow retains platform verification and no Windows build or GitHub release transport', async () => {
	const forge = await readFile(
		new URL('../.gitea/workflows/trigger-release.yml', import.meta.url),
		'utf8',
	);
	const github = await readFile(
		new URL('../.github/workflows/trigger-release.yml', import.meta.url),
		'utf8',
	);
	for (const name of [
		'Verify immutable release tag source',
		'Check macOS signing secrets',
		'Verify macOS microphone entitlement',
		'Verify macOS signed and notarized release DMG',
		'Verify macOS signed and notarized update zip',
		'Check the Linux AppImage against the glibc floor and run terminals from it there',
		'Verify release asset checksums before upload',
	]) {
		assert.ok(forge.includes(name), name);
		assert.ok(github.includes(name), name);
	}
	assert.match(forge, /darwin:arm64/);
	assert.match(forge, /linux:x64/);
	assert.doesNotMatch(forge, /inputs\.tag|required: true/);
	assert.match(
		forge,
		/no_release: \$\{\{ steps\.prepare\.outputs\.no_release \}\}/,
	);
	assert.match(forge, /needs:\n\s+- release\n\s+- build-binaries/);
	assert.doesNotMatch(
		forge,
		/windows-latest|npm run build:win|gh release|actions\/(?:upload|download)-artifact/,
	);
	assert.match(github, /windows-latest/);
	assert.match(github, /npm run build:win/);
	assert.match(
		forge,
		/OPENROUTER_API_KEY: \$\{\{ secrets\.OPENROUTER_API_KEY \}\}/,
	);
	assert.doesNotMatch(forge, /continue-on-error: true/);
	assert.match(forge, /prepare-forge-release-notes\.mjs/);
	assert.doesNotMatch(forge, /generate-fallback-release-notes\.mjs/);
	assert.ok(
		forge.indexOf('name: Generate AI release notes before builds') <
			forge.indexOf('name: Install dependencies'),
	);
	const publication = forge.slice(forge.indexOf('  publish:'));
	assert.doesNotMatch(publication, /OPENROUTER_API_KEY|generate-release-notes/);
});
