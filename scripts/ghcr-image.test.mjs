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
const webImageWorkflow = await readFile(
	new URL('../.github/workflows/web-image.yml', import.meta.url),
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
		['ci.yml', 'trigger-release.yml', 'web-image.yml'].map(async (name) => [
			name,
			await readFile(
				new URL(`../.github/workflows/${name}`, import.meta.url),
				'utf8',
			),
		]),
	),
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
		/docker\/metadata-action@c299e40c65443455700f0fdfc63efafe5b349051 # v5/u,
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
		/docker\/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178e8 # v6/u,
	);
	assert.match(
		workflow,
		/docker\/setup-qemu-action@c7c53464625b32c7a7e944ae62b3e17d2b600130 # v3/u,
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

test('server and static-web GHCR releases retain their verified multi-architecture metadata contract', () => {
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

	assert.match(
		releaseWorkflow,
		/IMAGE_NAME: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/terminay-web/u,
	);
	assert.match(releaseWorkflow, /echo "\$IMAGE_NAME:\$VERSION"/u);
	assert.match(releaseWorkflow, /echo "\$IMAGE_NAME:\$MAJOR_MINOR"/u);
	assert.match(releaseWorkflow, /echo "\$IMAGE_NAME:sha-\$EXPECTED_COMMIT"/u);
	assert.match(releaseWorkflow, /platforms: linux\/amd64,linux\/arm64/u);
	assert.match(releaseWorkflow, /provenance: mode=max/u);
	assert.match(releaseWorkflow, /sbom: true/u);
	assert.match(
		releaseWorkflow,
		/push: true/u,
	);
	assert.match(webImageWorkflow, /workflow_dispatch:/u);
	assert.doesNotMatch(webImageWorkflow, /push:\s*\n\s+tags:/u);
});

test('Docker image operator guide requires digest-pinned controlled deployments', () => {
	assert.match(operatorGuide, /ghcr\.io\/<owner>\/terminay-server/u);
	assert.match(operatorGuide, /ghcr\.io\/<owner>\/terminay-web/u);
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
		['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
		['docker/setup-buildx-action', '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f'],
		['docker/setup-qemu-action', 'c7c53464625b32c7a7e944ae62b3e17d2b600130'],
		['docker/metadata-action', 'c299e40c65443455700f0fdfc63efafe5b349051'],
		['docker/login-action', 'c94ce9fb468520275223c153574b00df6fe4bcc9'],
		['docker/build-push-action', '10e90e3645eae34f1e60eeb005ba3a3d33f178e8'],
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
		['actions/checkout', '11d5960a326750d5838078e36cf38b85af677262'],
		['actions/setup-node', '49933ea5288caeca8642d1e84afbd3f7d6820020'],
		['actions/upload-artifact', 'ea165f8d65b6e75b540449e92b4886f43607fa02'],
		['actions/download-artifact', 'd3f86a106a0bac45b974a628896c90dbdf5c8093'],
		[
			'apple-actions/import-codesign-certs',
			'63fff01cd422d4b7b855d40ca1e9d34d2de9427d',
		],
		['docker/setup-buildx-action', '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f'],
		['docker/metadata-action', 'c299e40c65443455700f0fdfc63efafe5b349051'],
		['docker/login-action', 'c94ce9fb468520275223c153574b00df6fe4bcc9'],
		['docker/build-push-action', '10e90e3645eae34f1e60eeb005ba3a3d33f178e8'],
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
			assert.equal(
				revision,
				expected.get(action),
				`${name}: ${action} revision must match the reviewed pin`,
			);
		}
	}
});
