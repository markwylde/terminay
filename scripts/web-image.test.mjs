import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function text(relativePath) {
	return readFile(new URL(relativePath, root), 'utf8');
}

test('web image packages only the browser manager without Electron', async () => {
	const manager = await text('dist-web/web.html');
	const managerBundles = await Promise.all(
		findJavaScriptAssets(manager).map((asset) => text(`dist-web/${asset}`)),
	);
	const managerModuleGraph = managerBundles.join('\n');

	assert.match(manager, /<title>Terminay Connections<\/title>/u);
	assert.match(managerModuleGraph, /Connections/u);
	assert.match(managerModuleGraph, /web\.terminay\.com/u);
	assert.doesNotMatch(
		managerModuleGraph,
		/ipcRenderer|electron\/|node:(?:fs|path|crypto|net)/u,
	);
	assert.doesNotMatch(
		manager,
		/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/iu,
		'the production entry must not require CSP-unsafe inline JavaScript',
	);
	await assert.rejects(
		access(new URL('../dist-web/remote.html', import.meta.url)),
	);
});

test('web image has an explicit static health and SPA fallback contract', async () => {
	const nginx = await text('docker/nginx.web.conf');
	const resolverEnv = await text('docker/05-terminay-resolver.envsh');
	const dockerfile = await text('Dockerfile.web');
	const workflow = await text('.github/workflows/web-image.yml');

	assert.match(nginx, /listen 8080/u);
	assert.match(nginx, /location = \/healthz/u);
	assert.match(nginx, /default_type application\/json/u);
	assert.match(nginx, /return 200 '\{"ok":true\}\\n';/u);
	assert.match(nginx, /location = \/\.well-known\/terminay-release\.json/u);
	assert.match(nginx, /web\.terminay\.com web\.html;/u);
	assert.match(nginx, /app\.terminay\.com legacy\.html;/u);
	assert.match(nginx, /localhost web\.html;/u);
	assert.match(nginx, /default "";/u);
	assert.match(
		nginx,
		/if \(\$terminay_entry_document = ""\) \{ return 421; \}/u,
	);
	assert.match(nginx, /location = \/web\.html \{ internal; \}/u);
	assert.match(nginx, /location = \/legacy\.html \{ internal; \}/u);
	assert.match(nginx, /try_files \/\$terminay_entry_document =404;/u);
	assert.match(nginx, /try_files \$uri \$uri\/ \/\$terminay_entry_document/u);
	assert.match(nginx, /location \/protocol\/[\s\S]*return 404/u);
	assert.match(nginx, /resolver \$\{NGINX_RESOLVER\}[^\n]*valid=5s/u);
	assert.match(
		nginx,
		/set \$terminay_protocol_origin http:\/\/terminay-server:4317/u,
	);
	assert.match(nginx, /proxy_pass \$terminay_protocol_origin\$request_uri/u);
	assert.match(nginx, /proxy_buffering off/u);
	assert.match(nginx, /add_header Cache-Control no-store always;/u);
	assert.match(
		nginx,
		/location \^~ \/assets\/ \{\s*try_files \$uri =404;\s*\}/u,
	);
	assert.match(
		nginx,
		/add_header Content-Security-Policy .*frame-ancestors 'none'.*object-src 'none'.*connect-src 'self' http: https: ws: wss:.* always;/u,
	);
	assert.match(
		nginx,
		/add_header Permissions-Policy "geolocation=\(\), payment=\(\), usb=\(\)" always;/u,
	);
	assert.match(
		nginx,
		/add_header Cross-Origin-Opener-Policy "same-origin" always;/u,
	);
	assert.match(nginx, /add_header Referrer-Policy "no-referrer" always;/u);
	assert.match(nginx, /add_header X-Content-Type-Options "nosniff" always;/u);
	assert.match(nginx, /add_header X-Frame-Options "DENY" always;/u);
	assert.match(
		nginx,
		/location = \/healthz[\s\S]*add_header Cache-Control no-store;[\s\S]*add_header Content-Security-Policy[\s\S]*add_header X-Frame-Options "DENY" always;/u,
	);
	assert.match(resolverEnv, /\/etc\/resolv\.conf/u);
	assert.match(resolverEnv, /export NGINX_RESOLVER/u);
	assert.match(
		dockerfile,
		/vite\.web\.config\.ts web\.html remote\.html legacy\.html/u,
	);
	assert.match(
		dockerfile,
		/COPY scripts\/build-ui-bundle-manifest\.mjs \.\/scripts\/build-ui-bundle-manifest\.mjs/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-npm-cache-node24,target=\/root\/\.npm,sharing=locked/u,
	);
	assert.ok(
		dockerfile.indexOf('npm ci --ignore-scripts') <
			dockerfile.indexOf('COPY src ./src'),
		'web npm ci should not be invalidated by source edits',
	);
	assert.match(dockerfile, /npm run build:web/u);
	assert.match(dockerfile, /FROM nginx:1\.27-alpine/u);
	assert.match(dockerfile, /05-terminay-resolver\.envsh/u);
	assert.match(
		dockerfile,
		/chmod \+x \/docker-entrypoint\.d\/05-terminay-resolver\.envsh/u,
	);
	assert.match(dockerfile, /\/etc\/nginx\/templates\/default\.conf\.template/u);
	assert.match(dockerfile, /HEALTHCHECK/u);
	assert.match(dockerfile, /TERMINAY_SOURCE_REVISION/u);
	assert.match(dockerfile, /write-web-release-marker\.mjs/u);
	assert.doesNotMatch(
		dockerfile,
		/apps\/terminay-web\/(Dockerfile|server\.mjs)/u,
	);
	assert.match(workflow, /Dockerfile\.web/u);
	assert.match(workflow, /tags: \['v\*\.\*\.\*'\]/u);
	assert.match(workflow, /workflow_dispatch:/u);
	assert.match(
		workflow,
		/IMAGE_NAME: ghcr\.io\/\$\{\{ github\.repository_owner \}\}\/terminay-web/u,
	);
	assert.match(workflow, /images: \$\{\{ env\.IMAGE_NAME \}\}/u);
	assert.match(workflow, /tags: \$\{\{ steps\.meta\.outputs\.tags \}\}/u);
	assert.match(workflow, /id: build/u);
	assert.match(workflow, /digest='\$\{\{ steps\.build\.outputs\.digest \}\}'/u);
	assert.match(workflow, /\^sha256:\[0-9a-f\]\{64\}\$/u);
	assert.match(workflow, /\$\{IMAGE_NAME\}@\$\{digest\}/u);
	assert.match(workflow, /\$\{GITHUB_SHA\}/u);
	assert.match(workflow, /sbom: true/u);
	assert.match(workflow, /provenance: mode=max/u);
	assert.match(workflow, /npm run test:web-image-integration/u);
	assert.match(workflow, /TERMINAY_SOURCE_REVISION=\$\{\{ github\.sha \}\}/u);
	await access(new URL('../web.html', import.meta.url));
});

function findJavaScriptAssets(html) {
	const assets = [
		...html.matchAll(/(?:src|href)="(?:\.\/|\/)?(assets\/[^"?]+\.js)"/gu),
	].map((match) => match[1]);
	assert.notEqual(
		assets.length,
		0,
		'built HTML must declare JavaScript assets',
	);
	return [...new Set(assets)];
}
