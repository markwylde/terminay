import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dockerfile = await readFile(
	new URL('../Dockerfile', import.meta.url),
	'utf8',
);
const ignore = await readFile(
	new URL('../.dockerignore', import.meta.url),
	'utf8',
);
const workflow = await readFile(
	new URL('../.github/workflows/server-image.yml', import.meta.url),
	'utf8',
);
const releaseWorkflow = await readFile(
	new URL('../.github/workflows/trigger-release.yml', import.meta.url),
	'utf8',
);
const operatorGuide = await readFile(
	new URL('../specs/operations/docker-image-release.md', import.meta.url),
	'utf8',
);
const workflows = new Map(
	await Promise.all(
		['ci.yml', 'trigger-release.yml'].map(async (name) => [
			name,
			await readFile(
				new URL(`../.github/workflows/${name}`, import.meta.url),
				'utf8',
			),
		]),
	),
);
workflows.set(
	'gitea-ci.yml',
	await readFile(new URL('../.gitea/workflows/ci.yml', import.meta.url), 'utf8'),
);

test('server Dockerfile builds the standalone server and runs as a non-root user', () => {
	assert.match(dockerfile, /^FROM node:24\.15\.0-bookworm-slim AS build/m);
	assert.match(dockerfile, /npm install --global npm@12\.0\.2/u);
	assert.match(
		dockerfile,
		/apt-get install --yes --no-install-recommends python3 make g\+\+/u,
	);
	assert.match(dockerfile, /npm ci/u);
	assert.match(
		dockerfile,
		/npm run build --workspace @terminay\/protocol[\s\S]*npm run build --workspace @terminay\/server/u,
	);
	assert.match(dockerfile, /npm run build --workspace @terminay\/server/u);
	assert.match(dockerfile, /npm prune --omit=dev/u);
	assert.match(dockerfile, /org\.opencontainers\.image\.source/u);
	assert.match(dockerfile, /org\.opencontainers\.image\.revision/u);
	assert.match(dockerfile, /USER terminay/u);
	assert.match(
		dockerfile,
		/ENTRYPOINT \["node", "apps\/terminay-server\/dist\/cli\.js"\]/u,
	);
	assert.match(
		dockerfile,
		/CMD \["--data-root", "\/var\/lib\/terminay", "--endpoint", "loopback"\]/u,
	);
	assert.match(ignore, /^node_modules$/mu);
	assert.match(ignore, /^\.git$/mu);
});

test('GHCR workflow smokes the repository Dockerfile before publishing', () => {
	assert.match(workflow, /docker buildx build[\s\S]*--file \.\/Dockerfile/u);
	assert.match(workflow, /--tag terminay-server:ci/u);
	assert.match(workflow, /docker run --rm terminay-server:ci --version/u);
	assert.match(workflow, /--status --data-root \/tmp\/terminay-status/u);
	assert.match(
		workflow,
		/docker\/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0/u,
	);
	assert.match(
		workflow,
		/images: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/terminay-server/u,
	);
	assert.match(workflow, /type=sha,format=long,prefix=sha-/u);
	assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
	assert.match(
		workflow,
		/type=raw,value=latest,enable=\{\{is_default_branch\}\}/u,
	);
	assert.match(
		workflow,
		/docker\/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0/u,
	);
	assert.match(
		workflow,
		/docker\/setup-qemu-action@96fe6ef7f33517b61c61be40b68a1882f3264fb8 # v4.2.0/u,
	);
	assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/u);
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /sbom: true/u);
	assert.match(workflow, /packages: write/u);
	assert.match(workflow, /id-token: write/u);
	assert.match(workflow, /if: \$\{\{ github\.event_name == 'push'/u);
	assert.doesNotMatch(workflow, /terminay\.com/u);
	assert.doesNotMatch(workflow, /docker push /u);
});

test('server GHCR release retains its metadata contract', () => {
	assert.match(
		workflow,
		/images: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/terminay-server/u,
	);
	assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
	assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/u);
	assert.match(workflow, /type=sha,format=long,prefix=sha-/u);
	assert.match(
		workflow,
		/type=raw,value=latest,enable=\{\{is_default_branch\}\}/u,
	);
	assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/u);
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /sbom: true/u);
	assert.match(workflow, /github\.event_name == 'push'/u);

	assert.doesNotMatch(releaseWorkflow, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
});

test('Docker image operator guide requires digest-pinned controlled deployments', () => {
	assert.match(operatorGuide, /ghcr\.io\/<owner>\/terminay-server/u);
	assert.match(operatorGuide, /@sha256:<manifest-digest>/u);
	assert.match(operatorGuide, /docker buildx imagetools inspect/u);
	assert.match(
		operatorGuide,
		/`latest`.*must not be used for a controlled rollout/su,
	);
	assert.match(
		operatorGuide,
		/Signature\s+publication and verification remain a Task 20 operational release follow-up/u,
	);
});

test('GHCR publication actions are pinned to immutable reviewed revisions', () => {
	const expected = new Map([
		['actions/checkout', 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09'],
		['docker/setup-buildx-action', 'bb05f3f5519dd87d3ba754cc423b652a5edd6d2c'],
		['docker/setup-qemu-action', '96fe6ef7f33517b61c61be40b68a1882f3264fb8'],
		['docker/metadata-action', 'dc802804100637a589fabce1cb79ff13a1411302'],
		['docker/login-action', 'dbcb813823bdd20940b903addbd779551569679f'],
		['docker/build-push-action', '53b7df96c91f9c12dcc8a07bcb9ccacbed38856a'],
	]);
	const references = [
		...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#.*)?$/gmu),
	];

	assert.equal(
		references.length,
		8,
		'every external action in the server-image workflow must be reviewed',
	);
	for (const [, action, revision] of references) {
		assert.equal(
			revision.length,
			40,
			`${action} must use a full immutable commit SHA`,
		);
		assert.match(
			revision,
			/^[0-9a-f]{40}$/u,
			`${action} must use a commit SHA`,
		);
		assert.equal(
			revision,
			expected.get(action),
			`${action} revision must match the reviewed pin`,
		);
	}
});

test('other project workflows pin every third-party action to a reviewed immutable revision', () => {
	const expected = new Map([
		['actions/checkout', new Set(['fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09'])],
		['actions/setup-node', new Set(['a0853c24544627f65ddf259abe73b1d18a591444'])],
		['actions/upload-artifact', new Set([
			'ea165f8d65b6e75b540449e92b4886f43607fa02',
			'ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5',
		])],
		['actions/download-artifact', new Set([
			'd3f86a106a0bac45b974a628896c90dbdf5c8093',
			'9bc31d5ccc31df68ecc42ccf4149144866c47d8a',
		])],
		[
			'apple-actions/import-codesign-certs',
			new Set(['2dbeb2d7c37642111f938c56ef0feb5d51dad55d']),
		],
		['docker/setup-buildx-action', new Set(['bb05f3f5519dd87d3ba754cc423b652a5edd6d2c'])],
		['docker/metadata-action', new Set(['dc802804100637a589fabce1cb79ff13a1411302'])],
		['docker/login-action', new Set(['dbcb813823bdd20940b903addbd779551569679f'])],
		['docker/build-push-action', new Set(['53b7df96c91f9c12dcc8a07bcb9ccacbed38856a'])],
	]);

	for (const [name, contents] of workflows) {
		const references = [
			...contents.matchAll(
				/^\s*(?:-\s*)?uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#.*)?$/gmu,
			),
		];
		assert.ok(references.length > 0, `${name} must be scanned for action pins`);
		for (const [, action, revision] of references) {
			assert.match(
				revision,
				/^[0-9a-f]{40}$/u,
				`${name}: ${action} must use a full immutable commit SHA`,
			);
			assert.ok(
				expected.get(action)?.has(revision),
				`${name}: ${action} revision must match a reviewed pin`,
			);
		}
	}
});

test('provider-specific workflow folders resolve only their compatible artifact action generation', () => {
	const githubCi = workflows.get('ci.yml');
	const giteaCi = workflows.get('gitea-ci.yml');
	assert.ok(githubCi, '.github/workflows/ci.yml must exist');
	assert.ok(giteaCi, '.gitea/workflows/ci.yml must exist');
	const job = (workflow, name) => {
		const header = `  ${name}:\n`;
		const start = workflow.indexOf(header);
		assert.notEqual(start, -1, `CI must declare ${name}`);
		const remainder = workflow.slice(start + header.length);
		const next = remainder.search(/^  [a-z][a-z0-9-]+:\n/mu);
		return next === -1 ? workflow.slice(start) : workflow.slice(start, start + header.length + next);
	};

	const github = `${job(githubCi, 'e2e-image')}\n${job(githubCi, 'e2e-test')}`;
	const gitea = `${job(giteaCi, 'e2e-image')}\n${job(giteaCi, 'e2e-test')}`;
	assert.match(github, /(?:ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093)/u);
	assert.doesNotMatch(github, /(?:ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a)/u);
	assert.match(gitea, /(?:ff15f0306b3f739f7b6fd43fb5d26cd321bd4de5|9bc31d5ccc31df68ecc42ccf4149144866c47d8a)/u);
	assert.doesNotMatch(gitea, /(?:ea165f8d65b6e75b540449e92b4886f43607fa02|d3f86a106a0bac45b974a628896c90dbdf5c8093)/u);
});
