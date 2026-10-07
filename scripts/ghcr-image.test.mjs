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
const prereleaseWorkflow = await readFile(
	new URL('../.github/workflows/main-prerelease.yml', import.meta.url),
	'utf8',
);
const operatorGuide = await readFile(
	new URL('../docs/operations/docker-image-release.md', import.meta.url),
	'utf8',
);
const workflows = new Map(
	await Promise.all(
		['server-image.yml', 'trigger-release.yml', 'main-prerelease.yml'].map(async (name) => [
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
	// The server's account is unprivileged; sudo is how its terminals reach root.
	assert.match(
		dockerfile,
		/apt-get install --yes --no-install-recommends [^\n]*\bsudo\b/u,
	);
	assert.match(dockerfile, /terminay ALL=\(ALL:ALL\) NOPASSWD:ALL/u);
	assert.match(dockerfile, /chmod 0440 \/etc\/sudoers\.d\/terminay/u);
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
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /sbom: true/u);
	assert.match(workflow, /packages: write/u);
	assert.match(workflow, /id-token: write/u);
	// Nothing is built for publication until the smoke passed, and nothing is
	// tagged until both architectures were built.
	assert.match(job('build'), /^ {4}needs: \[plan, smoke\]$/mu);
	assert.match(job('build'), /^ {4}if: \$\{\{ needs\.plan\.outputs\.mode != 'none' \}\}$/mu);
	assert.match(job('publish'), /^ {4}needs: \[plan, build\]$/mu);
	assert.doesNotMatch(workflow, /terminay\.com/u);
	assert.doesNotMatch(workflow, /docker push /u);
});

test('server GHCR release retains its metadata contract', () => {
	assert.match(workflow, /ghcr\.io\/\$\{GITHUB_REPOSITORY_OWNER\}\/terminay-server/u);
	assert.match(workflow, /type=semver,pattern=\{\{version\}\}/u);
	assert.match(workflow, /type=semver,pattern=\{\{major\}\}\.\{\{minor\}\}/u);
	assert.match(workflow, /type=sha,format=long,prefix=sha-/u);
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /sbom: true/u);

	assert.doesNotMatch(releaseWorkflow, /build-web-image|terminay-web|Dockerfile\.web|web-image-integration/u);
});

test('one build is published under both image names, and latest is a release', () => {
	// Both names come from one metadata step and one build-push step, so they
	// resolve to one manifest digest.
	assert.match(workflow, /docker\.io\/markwylde\/terminay/u);
	assert.match(workflow, /images: \$\{\{ steps\.registries\.outputs\.images \}\}/u);
	assert.equal(workflow.match(/docker\/build-push-action@/gu)?.length, 1);
	assert.equal(workflow.match(/docker buildx imagetools create /gu)?.length, 1);
	// Docker Hub is published only where its credential exists, and never from
	// a workflow that would fail for the lack of one.
	assert.match(workflow, /DOCKERHUB_TOKEN: \$\{\{ secrets\.DOCKERHUB_TOKEN \}\}/u);
	assert.match(
		workflow,
		/if: \$\{\{ steps\.registries\.outputs\.dockerhub == 'true' \}\}/u,
	);
	// `latest` only ever names a release, so the bare image name is always one.
	assert.match(
		workflow,
		/type=raw,value=latest,enable=\$\{\{ needs\.plan\.outputs\.mode == 'release' \}\}/u,
	);
	assert.match(workflow, /flavor: \|\n\s+latest=false/u);
	assert.doesNotMatch(workflow, /value=latest,enable=\{\{is_default_branch\}\}/u);
	assert.doesNotMatch(workflow, /^ {4}branches:/mu);
	assert.match(operatorGuide, /markwylde\/terminay/u);
});

function job(name) {
	const header = `\n  ${name}:\n`;
	const start = workflow.indexOf(header);
	assert.notEqual(start, -1, `the image workflow must declare ${name}`);
	const rest = workflow.slice(start + header.length);
	const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\n/mu);
	return next === -1 ? rest : rest.slice(0, next);
}

test('the image workflow publishes only a release tag or a validated beta version', () => {
	const plan = job('plan');
	// A release tag publishes its own version and takes no inputs.
	assert.match(plan, /if \[\[ "\$GITHUB_REF" == refs\/tags\/v\* \]\]/u);
	assert.match(plan, /echo "mode=release"/u);
	assert.match(plan, /echo "channel=tag"/u);
	// A beta is a dispatched version on the default branch, in the beta
	// grammar, for a commit that branch contains.
	assert.match(workflow, /^ {6}version:\n(?: {8}.*\n)*? {8}type: string$/mu);
	assert.match(workflow, /^ {6}revision:\n(?: {8}.*\n)*? {8}type: string$/mu);
	assert.match(plan, /"\$GITHUB_REF" != refs\/heads\/main/u);
	assert.match(
		plan,
		/"\$VERSION" =~ \^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+-beta\\\.\[1-9\]\[0-9\]\*\$/u,
	);
	assert.match(plan, /"\$REVISION" =~ \^\[0-9a-f\]\{40\}\$/u);
	assert.match(plan, /git merge-base --is-ancestor "\$REVISION" "\$GITHUB_SHA"/u);
	assert.match(plan, /echo "mode=beta"/u);
	assert.match(plan, /echo "channel=main"/u);
	// Inputs reach the shell as environment, never as script text.
	assert.doesNotMatch(plan, /run: \|[\s\S]*\$\{\{ inputs\./u);
	// The plan decides before anything is built, and holds no write token.
	assert.match(plan, /^ {4}permissions:\n {6}contents: read\n/mu);
	assert.match(job('smoke'), /^ {4}needs: plan$/mu);
	// Every build is of the planned commit and stamped with the planned version.
	assert.equal(
		workflow.match(/ref: \$\{\{ needs\.plan\.outputs\.revision \}\}/gu)?.length,
		2,
	);
	const build = job('build');
	assert.match(build, /OCI_VERSION=\$\{\{ needs\.plan\.outputs\.version \}\}/u);
	assert.match(build, /OCI_REVISION=\$\{\{ needs\.plan\.outputs\.revision \}\}/u);
	assert.match(build, /TERMINAY_CHANNEL=\$\{\{ needs\.plan\.outputs\.channel \}\}/u);
});

test('image tags: a release moves latest, a beta moves beta, and neither carries a v', () => {
	const publish = job('publish');
	const tags = [...publish.matchAll(/^ {12}(type=.*)$/gmu)].map((match) => match[1]);
	const expression = (text) => `\${{ ${text} }}`;
	const release = `enable=${expression("needs.plan.outputs.mode == 'release'")}`;
	const beta = `enable=${expression("needs.plan.outputs.mode == 'beta'")}`;
	assert.deepEqual(tags, [
		`type=semver,pattern={{version}},${release}`,
		`type=semver,pattern={{major}}.{{minor}},${release}`,
		`type=sha,format=long,prefix=sha-,${release}`,
		`type=raw,value=latest,${release}`,
		`type=raw,value=${expression('needs.plan.outputs.version')},${beta}`,
		`type=raw,value=sha-${expression('needs.plan.outputs.revision')},${beta}`,
		`type=raw,value=beta,${beta}`,
	]);
	// The planned version is the tag without its v.
	assert.match(job('plan'), /RELEASE="\$\{GITHUB_REF_NAME#v\}"/u);
});

test('each architecture is built natively and joined in one manifest', () => {
	const build = job('build');
	assert.doesNotMatch(workflow, /setup-qemu-action|linux\/amd64,linux\/arm64/u);
	assert.match(build, /- arch: amd64\n\s+runner: ubuntu-latest\n/u);
	assert.match(build, /- arch: arm64\n\s+runner: ubuntu-24\.04-arm\n/u);
	assert.match(build, /^ {4}runs-on: \$\{\{ matrix\.runner \}\}$/mu);
	assert.match(build, /fail-fast: true/u);
	assert.match(build, /platforms: linux\/\$\{\{ matrix\.arch \}\}/u);
	// Pushed by digest: a build alone creates and moves no tag.
	assert.match(build, /push-by-digest=true,name-canonical=true,push=true/u);
	assert.doesNotMatch(build, /^ {10}tags:/mu);
	const publish = job('publish');
	assert.match(publish, /test "\$\{#SOURCES\[@\]\}" = 2/u);
	assert.match(publish, /grep -F 'linux\/amd64'/u);
	assert.match(publish, /grep -F 'linux\/arm64'/u);
	// The manifest job builds nothing and needs no signing identity.
	assert.doesNotMatch(publish, /build-push-action|id-token/u);
});

test('the rolling prerelease publishes a beta image by dispatching the image workflow last', () => {
	const start = prereleaseWorkflow.indexOf('\n  publish-beta-image:\n');
	assert.notEqual(start, -1);
	const dispatch = prereleaseWorkflow.slice(start);
	// Last job in the file, after the assets it follows.
	assert.ok(start > prereleaseWorkflow.indexOf('\n  publish-main-prerelease:\n'));
	assert.doesNotMatch(dispatch.slice(1), /^ {2}[a-z][a-z0-9-]*:\n(?! {4})/mu);
	assert.match(dispatch, /needs: \[build-main-desktop, publish-main-prerelease\]/u);
	assert.match(
		dispatch,
		/needs\.publish-main-prerelease\.result == 'success' && needs\.build-main-desktop\.result == 'success' && github\.ref == 'refs\/heads\/main'/u,
	);
	assert.match(dispatch, /^ {4}permissions:\n {6}contents: read\n(?: {6}#.*\n)* {6}actions: write$/mu);
	assert.doesNotMatch(dispatch, /packages: write|contents: write|secrets\./u);
	assert.match(dispatch, /VERSION: \$\{\{ needs\.build-main-desktop\.outputs\.version \}\}/u);
	assert.match(dispatch, /REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(
		dispatch,
		/gh workflow run server-image\.yml --repo "\$GH_REPO" --ref main \\\n\s+-f "version=\$VERSION" -f "revision=\$REVISION"/u,
	);
	assert.match(
		prereleaseWorkflow,
		/^ {4}outputs:\n(?: {6}#.*\n)* {6}version: \$\{\{ steps\.beta_version\.outputs\.version \}\}$/mu,
	);
});

test('a release publishes the image by dispatching the image workflow at its tag', () => {
	// The release creates its tag with the workflow token. GitHub starts no
	// workflow for that push, so a tag trigger alone never publishes an image
	// for a release made by the release workflow.
	assert.match(workflow, /^ {2}workflow_dispatch:$/mu);
	assert.match(
		releaseWorkflow,
		/gh workflow run server-image\.yml --repo "\$GH_REPO" --ref "\$TAG"/u,
	);
	const job = releaseWorkflow.slice(
		releaseWorkflow.indexOf('\n  publish-server-image:\n'),
	);
	assert.match(job, /needs: \[release, publish-release-notes\]/u);
	assert.match(job, /if: needs\.release\.outputs\.no_release != 'true'/u);
	assert.match(job, /^ {6}actions: write$/mu);
	assert.match(job, /^ {6}contents: read$/mu);
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
		['docker/metadata-action', 'dc802804100637a589fabce1cb79ff13a1411302'],
		['docker/login-action', 'dbcb813823bdd20940b903addbd779551569679f'],
		['docker/build-push-action', '53b7df96c91f9c12dcc8a07bcb9ccacbed38856a'],
		['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
		['actions/download-artifact', 'd3f86a106a0bac45b974a628896c90dbdf5c8093'],
	]);
	const references = [
		...workflow.matchAll(/^\s*uses:\s+([^@\s]+)@([^\s#]+)(?:\s+#.*)?$/gmu),
	];

	assert.equal(
		references.length,
		13,
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
