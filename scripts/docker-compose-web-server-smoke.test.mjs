import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	extractPairingToken,
	inspectBoundedExplorerRequests,
	inspectComposeBrowserStability,
	inspectComposeReadiness,
	inspectComposeWebHardening,
	inspectProtocolApplicationFailure,
	inspectReconnectSurface,
	pairingUrlForOrigin,
	parseComposeReadinessLogs,
	redactPairingUrl,
} from './docker-compose-web-server-smoke.mjs';

const STABLE_BROWSER = {
	appRenders: 4,
	projectWorkspaceRenders: 6,
	protocolStarted: 20,
	protocolCompleted: 20,
	protocolPending: 0,
	protocolForbiddenResponses: 0,
	unknownFilesWatchResponses: 0,
	mainFrameNavigations: 1,
	failedModuleLoads: 0,
	protocolOperationCounts: { stream: 1 },
	protocolPathCounts: { '/protocol/stream': 1 },
	pendingRequests: [],
	resourceErrors: 0,
	consoleErrors: 0,
	cspErrors: 0,
	longTaskCount: 2,
	longTaskTotalMs: 120,
	longTaskMaximumMs: 80,
};

test('compose browser stability budget accepts bounded completed work', () => {
	assert.equal(
		inspectComposeBrowserStability(STABLE_BROWSER).protocolCompletionDeficit,
		0,
	);
});

test('compose browser stability budget fails closed on every monitored resource', () => {
	for (const [field, value] of [
		['appRenders', 97],
		['projectWorkspaceRenders', 129],
		['protocolStarted', 129],
		['protocolPending', 25],
		['protocolForbiddenResponses', 2],
		['unknownFilesWatchResponses', 1],
		['mainFrameNavigations', 4],
		['failedModuleLoads', 1],
		['resourceErrors', 1],
		['consoleErrors', 1],
		['cspErrors', 1],
		['longTaskCount', 9],
		['longTaskTotalMs', 2_001],
		['longTaskMaximumMs', 751],
	]) {
		assert.throws(
			() =>
				inspectComposeBrowserStability({ ...STABLE_BROWSER, [field]: value }),
			new RegExp(field, 'u'),
		);
	}
	assert.throws(
		() =>
			inspectComposeBrowserStability({
				...STABLE_BROWSER,
				protocolStarted: 50,
				protocolCompleted: 20,
				protocolPending: 0,
			}),
		/protocolCompletionDeficit/u,
	);
	assert.throws(
		() =>
			inspectComposeBrowserStability({
				...STABLE_BROWSER,
				protocolOperationCounts: { 'workspace.snapshot': 17 },
			}),
		/protocolOperationCounts\.workspace\.snapshot/u,
	);
	assert.throws(
		() =>
			inspectComposeBrowserStability({
				...STABLE_BROWSER,
				pendingRequests: [
					{
						id: 'request-old',
						operation: 'stream',
						path: '/protocol/stream',
						ageMs: 5_001,
					},
				],
			}),
		/pendingRequestAge\.request-old\.stream/u,
	);
});

test('compose browser reconnect surface rejects fresh pairing and black screens', () => {
	assert.deepEqual(
		inspectReconnectSurface({
			canonicalAppVisible: true,
			freshPairingDialogVisible: false,
		}),
		{ canonicalAppVisible: true, freshPairingDialogVisible: false },
	);
	assert.throws(
		() =>
			inspectReconnectSurface({
				canonicalAppVisible: false,
				freshPairingDialogVisible: false,
			}),
		/canonical App disappeared/u,
	);
	assert.throws(
		() =>
			inspectReconnectSurface({
				canonicalAppVisible: false,
				freshPairingDialogVisible: true,
			}),
		/fresh pairing/u,
	);
});

test('compose browser detects an unknown files.watch.start application response', () => {
	assert.deepEqual(
		inspectProtocolApplicationFailure('files.watch.start', {
			ok: false,
			error: { message: 'unknown operation files.watch.start' },
		}),
		{
			unknownFilesWatch: true,
			message: 'unknown operation files.watch.start',
		},
	);
	assert.equal(
		inspectProtocolApplicationFailure('workspace.snapshot', {
			ok: false,
			error: { message: 'unknown operation workspace.snapshot' },
		}).unknownFilesWatch,
		false,
	);
});

test('compose browser explorer requests remain bounded and redact query data from evidence', () => {
	const report = inspectBoundedExplorerRequests(
		[
			'http://127.0.0.1:8080/protocol/stream',
			'http://127.0.0.1:8080/assets/web.js',
		],
		4,
	);
	assert.deepEqual(report, {
		maximum: 4,
		count: 1,
		paths: ['/protocol/stream'],
	});
	assert.throws(
		() =>
			inspectBoundedExplorerRequests(
				Array.from(
					{ length: 5 },
					(_, index) => `http://127.0.0.1:8080/protocol/stream?n=${index}`,
				),
				4,
			),
		/maximum is 4/u,
	);
});

const PAIRING_URL =
	'http://localhost:4317/#pairingExpiresAt=2026-07-27T20%3A00%3A00.000Z&pairingSessionId=pair-compose&pairingToken=compose-secret-token-123456';

const READINESS = {
	ready: true,
	serverId: 'compose-local',
	version: '1.0.0',
	endpoint: 'loopback',
	protocolEndpoint: 'http://0.0.0.0:4317',
	healthEndpoint: 'http://0.0.0.0:4318',
	pairing: {
		pairingSessionId: 'pair-compose',
		pairingExpiresAt: '2026-07-27T20:00:00.000Z',
		pairingUrl: PAIRING_URL,
		expiresInSeconds: 300,
		requiresApproval: true,
	},
};

test('compose readiness log parser accepts prefixed compose JSON records', () => {
	const records = parseComposeReadinessLogs(
		[
			'terminay-server-1  | building...',
			`terminay-server-1  | ${JSON.stringify(READINESS)}`,
			'terminay-server-1  | not json',
		].join('\n'),
	);
	assert.equal(records.length, 1);
	assert.equal(records[0].pairing.pairingSessionId, 'pair-compose');
});

test('compose readiness inspection redacts pairing fragments and keeps tokens out of evidence', () => {
	const inspected = inspectComposeReadiness(READINESS);
	assert.equal(inspected.serverId, 'compose-local');
	assert.equal(inspected.protocolEndpoint, 'http://0.0.0.0:4317');
	assert.equal(inspected.pairingUrl, redactPairingUrl(PAIRING_URL));
	assert.equal(inspected.tokenLength, 'compose-secret-token-123456'.length);
	assert.equal(
		JSON.stringify(inspected).includes('compose-secret-token'),
		false,
	);
	assert.throws(
		() =>
			inspectComposeReadiness({
				...READINESS,
				pairing: { ...READINESS.pairing, pairingToken: 'leaked' },
			}),
		/must not expose/u,
	);
	assert.throws(
		() =>
			inspectComposeReadiness({
				...READINESS,
				pairing: {
					...READINESS.pairing,
					pairingUrl: PAIRING_URL.replace('localhost:4317', 'localhost:9999'),
				},
			}),
		/origin/u,
	);
});

test('compose token extraction is explicit and isolated from public reports', () => {
	assert.equal(extractPairingToken(PAIRING_URL), 'compose-secret-token-123456');
	assert.throws(
		() =>
			extractPairingToken(
				'http://localhost:4317/#pairingSessionId=pair-compose',
			),
		/token/u,
	);
});

test('compose browser pairing URL uses the web proxy origin without changing credentials', () => {
	const url = pairingUrlForOrigin(PAIRING_URL, 'http://127.0.0.1:8080');
	const parsed = new URL(url);
	assert.equal(parsed.origin, 'http://127.0.0.1:8080');
	assert.equal(parsed.hash, new URL(PAIRING_URL).hash);
});

test('root compose contract exposes local ports and hardens both server and static web services', async () => {
	const compose = await readFile(
		new URL('../docker-compose.yaml', import.meta.url),
		'utf8',
	);
	assert.match(compose, /127\.0\.0\.1:4317:4317/u);
	assert.match(compose, /127\.0\.0\.1:8080:8080/u);
	assert.match(compose, /TERMINAY_PUBLIC_ORIGIN: http:\/\/localhost:4317/u);
	assert.match(compose, /TERMINAY_PROJECT_ROOT: \$\{PWD\}/u);
	assert.match(compose, /- \.\.:\$\{PWD\}\/\.\./u);
	assert.match(compose, /GIT_CONFIG_KEY_0: safe\.directory/u);
	assert.match(compose, /GIT_CONFIG_VALUE_0: \$\{PWD\}/u);
	assert.match(compose, /read_only: true/u);
	assert.match(compose, /\/tmp:rw,noexec,nosuid,size=64m/u);
	assert.match(compose, /no-new-privileges:true/u);
	assert.match(compose, /cap_drop:\n\s+- ALL/u);
	assert.match(compose, /\/readyz/u);
	const webSection = compose.slice(
		compose.indexOf('  terminay-web:'),
		compose.indexOf('\nvolumes:'),
	);
	assert.match(webSection, /read_only: true/u);
	assert.match(webSection, /user: "101:101"/u);
	assert.match(webSection, /\/tmp:rw,noexec,nosuid,mode=1777,size=32m/u);
	assert.match(webSection, /no-new-privileges:true/u);
	assert.match(webSection, /cap_drop:\n\s+- ALL/u);
	assert.match(webSection, /healthcheck:[\s\S]*?\/healthz/u);
});

test('server runtime image includes Git for the shared Git service', async () => {
	const dockerfile = await readFile(
		new URL('../Dockerfile', import.meta.url),
		'utf8',
	);
	assert.match(
		dockerfile,
		/FROM node:24\.14\.0-bookworm-slim AS runtime[\s\S]*?apt-get install --yes --no-install-recommends git/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-apt-cache-bookworm,target=\/var\/cache\/apt,sharing=locked/u,
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-apt-lists-bookworm,target=\/var\/lib\/apt\/lists,sharing=locked/u,
	);
	assert.match(dockerfile, /USER terminay/u);
});

test('root server image caches apt and npm dependency layers before copying source', async () => {
	const dockerfile = await readFile(
		new URL('../Dockerfile', import.meta.url),
		'utf8',
	);
	const sourceCopyIndex = dockerfile.indexOf('COPY . .');
	const npmCiIndex = dockerfile.indexOf('npm ci');
	const aptIndex = dockerfile.indexOf(
		'apt-get install --yes --no-install-recommends python3 make g++',
	);
	assert.ok(aptIndex >= 0, 'build toolchain apt install should exist');
	assert.ok(npmCiIndex >= 0, 'npm ci should exist');
	assert.ok(sourceCopyIndex >= 0, 'source copy should exist');
	assert.ok(
		aptIndex < sourceCopyIndex,
		'apt install should not be invalidated by source edits',
	);
	assert.ok(
		npmCiIndex < sourceCopyIndex,
		'npm ci should not be invalidated by source edits',
	);
	assert.match(
		dockerfile,
		/--mount=type=cache,id=terminay-npm-cache-node24,target=\/root\/\.npm,sharing=locked/u,
	);
	assert.match(dockerfile, /COPY package\.json package-lock\.json/u);
	assert.match(dockerfile, /COPY apps\/terminay-server\/package\.json/u);
	assert.match(dockerfile, /COPY packages\/server-core\/package\.json/u);
	assert.doesNotMatch(dockerfile, /npm cache clean --force/u);
});

test('compose web hardening inspection requires a read-only, capability-free nginx runtime', () => {
	const inspected = inspectComposeWebHardening({
		ReadonlyRootfs: true,
		SecurityOpt: ['no-new-privileges'],
		CapDrop: ['ALL'],
		User: '101:101',
		Tmpfs: { '/tmp': 'rw,noexec,nosuid,mode=1777,size=32m' },
	});
	assert.deepEqual(inspected, {
		readOnlyRootfs: true,
		noNewPrivileges: true,
		capDropAll: true,
		unprivilegedUser: true,
		nginxRuntimeTmpfs: true,
	});
	assert.equal(
		inspectComposeWebHardening({
			ReadonlyRootfs: true,
			SecurityOpt: ['no-new-privileges'],
			CapDrop: [
				'CAP_CHOWN',
				'CAP_DAC_OVERRIDE',
				'CAP_FOWNER',
				'CAP_FSETID',
				'CAP_KILL',
				'CAP_NET_BIND_SERVICE',
				'CAP_SETFCAP',
				'CAP_SETGID',
				'CAP_SETPCAP',
				'CAP_SETUID',
				'CAP_SYS_CHROOT',
			],
			User: '101:101',
			Tmpfs: { '/tmp': 'rw,noexec,nosuid,mode=1777,size=32m' },
		}).capDropAll,
		true,
	);
	assert.throws(
		() =>
			inspectComposeWebHardening({
				ReadonlyRootfs: true,
				SecurityOpt: ['no-new-privileges'],
				CapDrop: ['ALL'],
				User: '101:101',
				Tmpfs: {},
			}),
		/\/tmp tmpfs/u,
	);
});
