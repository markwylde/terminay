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
	new URL('../docs/operations/docker-image-release.md', import.meta.url),
	'utf8',
);
const workflows = new Map(
	await Promise.all(
		['server-image.yml', 'trigger-release.yml'].map(async (name) => [
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

test('server Dockerfile assembles the self-contained server and runs as a non-root user', () => {
	assert.match(dockerfile, /^FROM node:24\.15\.0-bookworm-slim AS build/m);
	assert.match(dockerfile, /npm install --global npm@12\.2\.0/u);
	assert.match(
		dockerfile,
		/apt-get install --yes --no-install-recommends python3 make g\+\+/u,
	);
	assert.match(dockerfile, /npm ci/u);
	// The image carries what the release archive carries: without the workspace
	// UI and the WebRTC runtime it starts, reports ready, and cannot be paired.
	assert.match(dockerfile, /npm run build:application-graph/u);
	assert.match(dockerfile, /npm run build:server-postcompile/u);
	assert.match(dockerfile, /npm run build:server-ui:bundle/u);
	assert.match(dockerfile, /stage-selected-secure-werift-runtime\.mjs/u);
	assert.match(dockerfile, /build-standalone-server-artifact\.mjs/u);
	assert.match(dockerfile, /org\.opencontainers\.image\.source/u);
	assert.match(dockerfile, /org\.opencontainers\.image\.revision/u);
	assert.match(dockerfile, /^FROM debian:bookworm-slim AS runtime/m);
	assert.match(dockerfile, /^USER terminay$/m);
	assert.match(dockerfile, /^VOLUME \["\/var\/lib\/terminay"\]$/m);
	assert.match(dockerfile, /^STOPSIGNAL SIGTERM$/m);
	assert.match(dockerfile, /^HEALTHCHECK /m);
	assert.match(
		dockerfile,
		/^ENTRYPOINT \["\/usr\/local\/bin\/terminay-server-entrypoint"\]$/m,
	);
	assert.match(ignore, /^node_modules$/mu);
	assert.match(ignore, /^\.git$/mu);
});

test('a bare run of the image is an exposed, pairable server', () => {
	// The defaults are the contract of `docker run <image>` with no arguments.
	for (const setting of [
		'TERMINAY_DATA_ROOT=/var/lib/terminay',
		'TERMINAY_EXPOSE=hosted,direct',
		'TERMINAY_HTTP_HOST=0.0.0.0',
		'TERMINAY_HTTP_PORT=8443',
		'TERMINAY_PUBLIC_HOST=localhost',
		'TERMINAY_ICE_PORT_SPAN=16',
		'TERMINAY_HEALTH_HOST=127.0.0.1',
		'TERMINAY_UI_RENDERER_DIRECTORY=/opt/terminay/ui',
		'TERMINAY_MANAGED_BY=container',
	]) {
		assert.ok(dockerfile.includes(setting), `image default missing: ${setting}`);
	}
	assert.match(dockerfile, /TERMINAY_SERVER_REVISION=\$\{OCI_REVISION\}/u);
	// Pinning the ICE range caps how many devices can connect, so the image
	// does not pin one until the operator asks for it.
	assert.doesNotMatch(dockerfile, /TERMINAY_ICE_PORT=/u);
	assert.doesNotMatch(dockerfile, /TERMINAY_WEBRTC_ADVERTISE_ADDRESS=/u);
	assert.match(dockerfile, /^EXPOSE 8443\/tcp 51000-51015\/udp$/m);
	// The CLI is on the default PATH, and nothing in the image is an init system.
	assert.match(dockerfile, /COPY docker\/terminay \/usr\/local\/bin\/terminay/u);
	assert.doesNotMatch(dockerfile, /systemd|tini|dumb-init/u);
	assert.doesNotMatch(dockerfile, /^USER (?:root|0)\b/m);
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
	assert.match(workflow, /ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER\}\/terminay-server/u);
	assert.match(workflow, /type=sha,format=long,prefix=sha-/u);
	assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
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
	assert.match(workflow, /ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER\}\/terminay-server/u);
	assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
	assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/u);
	assert.match(workflow, /type=sha,format=long,prefix=sha-/u);
	assert.match(workflow, /platforms: linux\/amd64,linux\/arm64/u);
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /sbom: true/u);
	assert.match(workflow, /github\.event_name == 'push'/u);

	assert.doesNotMatch(releaseWorkflow, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
});

test('one build is published under both image names, and latest is a release', () => {
	// Both names come from one metadata step and one build-push step, so they
	// resolve to one manifest digest.
	assert.match(workflow, /docker\.io\/markwylde\/terminay/u);
	assert.match(workflow, /images: \$\{\{ steps\.registries\.outputs\.images \}\}/u);
	assert.equal(workflow.match(/docker\/build-push-action@/gu)?.length, 1);
	// Docker Hub is published only where its credential exists, and never from
	// a workflow that would fail for the lack of one.
	assert.match(workflow, /DOCKERHUB_TOKEN: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/u);
	assert.match(
		workflow,
		/if: \$\{\{ steps\.registries\.outputs\.dockerhub == 'true' \}\}/u,
	);
	// Images are published for tagged releases only, so the bare image name is
	// always a release.
	assert.match(
		workflow,
		/type=raw,value=latest,enable=\$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/u,
	);
	assert.doesNotMatch(workflow, /value=latest,enable=\{\{is_default_branch\}\}/u);
	assert.doesNotMatch(workflow, /^ {4}branches:/mu);
	assert.match(workflow, /TERMINAY_CHANNEL=tag/u);
	assert.match(operatorGuide, /markwylde\/terminay/u);
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
		9,
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
		['docker/setup-qemu-action', new Set(['96fe6ef7f33517b61c61be40b68a1882f3264fb8'])],
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
