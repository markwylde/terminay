import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('Docker server contract builds a non-root, read-only-root image with a bounded healthcheck', async () => {
	const dockerfile = await readFile(`${serverRoot}/Dockerfile`, 'utf8');
	const entrypoint = await readFile(`${serverRoot}/entrypoint.sh`, 'utf8');
	const compose = await readFile(
		`${serverRoot}/docker-compose.local.yml`,
		'utf8',
	);
	const dockerignore = await readFile(
		`${repositoryRoot}/.dockerignore`,
		'utf8',
	);

	assert.match(dockerfile, /node:22\.23\.1-bookworm-slim AS build/u);
	assert.match(
		dockerfile,
		/apt-get install --yes --no-install-recommends python3 make g\+\+/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-apt-cache-bookworm,target=\/var\/cache\/apt,sharing=locked/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-apt-lists-bookworm,target=\/var\/lib\/apt\/lists,sharing=locked/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-npm-cache-node22,target=\/root\/\.npm,sharing=locked/u,
	);
	assert.match(dockerfile, /npm ci/u);
	assert.ok(
		dockerfile.indexOf('npm ci') < dockerfile.indexOf('COPY apps ./apps'),
		'npm ci should run before source copies so source edits do not reinstall dependencies',
	);
	assert.doesNotMatch(dockerfile, /npm ci --ignore-scripts/u);
	assert.match(dockerfile, /npm run build --workspace @terminay\/server/u);
	assert.match(dockerfile, /npm prune --omit=dev/u);
	assert.doesNotMatch(dockerfile, /npm prune --omit=dev --ignore-scripts/u);
	assert.match(dockerfile, /USER 10001:10001/u);
	assert.match(dockerfile, /HOME=\/var\/lib\/terminay/u);
	assert.match(dockerfile, /TERMINAY_HTTP_HOST=0\.0\.0\.0/u);
	assert.match(dockerfile, /TERMINAY_HTTP_PORT=4317/u);
	assert.match(dockerfile, /EXPOSE 4317 8080/u);
	assert.match(dockerfile, /VOLUME \["\/var\/lib\/terminay"\]/u);
	assert.match(dockerfile, /HEALTHCHECK[^\n]+\/readyz/u);
	assert.match(dockerfile, /STOPSIGNAL SIGTERM/u);
	assert.match(dockerfile, /\/usr\/local\/bin\/terminay-mcp/u);
	assert.match(
		dockerfile,
		/exec node \/opt\/terminay\/apps\/terminay-server\/dist\/mcpEntry\.js "\$@"/u,
	);
	assert.match(
		entrypoint,
		/exec node \/opt\/terminay\/apps\/terminay-server\/dist\/cli\.js/gu,
	);
	assert.match(entrypoint, /TERMINAY_DATA_ROOT must be an absolute path/u);
	assert.match(compose, /read_only: true/u);
	assert.match(compose, /no-new-privileges:true/u);
	assert.match(compose, /127\.0\.0\.1:8080:8080/u);
	assert.match(compose, /127\.0\.0\.1:4317:4317/u);
	assert.match(compose, /TERMINAY_PUBLIC_ORIGIN: http:\/\/localhost:4317/u);
	assert.match(compose, /HOME: \/var\/lib\/terminay/u);
	assert.match(compose, /terminay-data:/u);
	assert.match(compose, /TERMINAY_HEALTH_HOST: 0\.0\.0\.0/u);
	assert.match(dockerignore, /\*\*\/node_modules/u);
	assert.match(dockerignore, /^build$/mu);
	assert.match(dockerignore, /\*\*\/dist/u);
	assert.match(dockerignore, /^\.task\*$/mu);
});
