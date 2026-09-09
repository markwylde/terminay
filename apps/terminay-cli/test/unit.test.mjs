import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { installLayout } from '../dist/layout.js';
import {
	parseEnvironmentFile,
	renderEnvironmentFile,
	renderUnit,
} from '../dist/unit.js';

const configuration = {
	serverId: 'build-box',
	dataRoot: '/var/lib/terminay',
	projectRoot: '/var/lib/terminay',
	port: 8443,
	healthPort: 8444,
	expose: 'hosted,direct',
	hostedDomain: 'terminay.com',
	directOrigin: 'https://198.51.100.7:8443',
	uiBundle: '/opt/terminay/current/ui',
};

test('the system unit is the runbook unit, hardened, and started from current', () => {
	const unit = renderUnit({
		layout: installLayout('system'),
		runAs: 'terminay',
		workingDirectory: '/var/lib/terminay',
	});
	assert.equal(
		unit,
		`[Unit]
Description=Terminay Server
Documentation=https://terminay.com/docs/installation
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=terminay
Group=terminay
WorkingDirectory=/var/lib/terminay
EnvironmentFile=/etc/terminay/server.env
ExecStart=/opt/terminay/current/bin/terminay-server
Restart=on-failure
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`,
	);
});

test('the user unit runs as its owner and never sets User=', () => {
	const unit = renderUnit({
		layout: installLayout('user', '/home/ada'),
		runAs: 'ada',
		workingDirectory: '/home/ada',
	});
	assert.doesNotMatch(unit, /^User=/mu, 'systemd rejects User= in a user unit');
	assert.doesNotMatch(unit, /^Group=/mu);
	assert.match(
		unit,
		/^ExecStart=\/home\/ada\/\.local\/share\/terminay\/current\/bin\/terminay-server$/mu,
	);
	assert.match(
		unit,
		/^EnvironmentFile=\/home\/ada\/\.config\/terminay\/server\.env$/mu,
	);
	assert.match(unit, /^WantedBy=default\.target$/mu);
});

test('every version is reached through current, never a versioned path', () => {
	for (const scope of ['system', 'user']) {
		const unit = renderUnit({
			layout: installLayout(scope, '/home/ada'),
			runAs: 'ada',
			workingDirectory: '/home/ada',
		});
		assert.doesNotMatch(
			unit,
			/\/versions\//u,
			'a unit pinned to a version could not be upgraded by switching current',
		);
	}
});

test('the environment file carries the documented defaults', () => {
	const environment = renderEnvironmentFile(configuration);
	assert.equal(
		environment,
		`# Written by \`terminay daemon install\`. Edit and restart the service to change it.
# No passphrase, device key, or pairing token belongs in this file.
TERMINAY_SERVER_ID=build-box
TERMINAY_DATA_ROOT=/var/lib/terminay
TERMINAY_PROJECT_ROOT=/var/lib/terminay
TERMINAY_HTTP_HOST=0.0.0.0
TERMINAY_HTTP_PORT=8443
TERMINAY_HEALTH_HOST=127.0.0.1
TERMINAY_HEALTH_PORT=8444
TERMINAY_EXPOSE=hosted,direct
TERMINAY_HOSTED_DOMAIN=terminay.com
TERMINAY_DIRECT_ORIGIN=https://198.51.100.7:8443
TERMINAY_AGENT_INTEGRATION=enabled
TERMINAY_AI_PROVIDERS=disabled
TERMINAY_LOG_SINK=journal
TERMINAY_UI_BUNDLE=/opt/terminay/current/ui
TERMINAY_UI_RENDERER_DIRECTORY=/opt/terminay/current/ui
`,
	);
});

test('the health endpoint stays on loopback', () => {
	const values = parseEnvironmentFile(renderEnvironmentFile(configuration));
	assert.equal(values.TERMINAY_HEALTH_HOST, '127.0.0.1');
});

test('a direct origin is omitted rather than left empty when it is not set', () => {
	const { directOrigin, ...withoutOrigin } = configuration;
	const environment = renderEnvironmentFile(withoutOrigin);
	assert.doesNotMatch(environment, /TERMINAY_DIRECT_ORIGIN/u);
});

test('no secret is ever written to the environment file or the unit', () => {
	const environment = renderEnvironmentFile(configuration);
	const unit = renderUnit({
		layout: installLayout('system'),
		runAs: 'terminay',
		workingDirectory: '/var/lib/terminay',
	});
	// Comments are stripped first: the file says in prose that no secret
	// belongs in it, and that sentence must not read as a secret.
	const withoutComments = (text) =>
		text
			.split('\n')
			.filter((line) => !line.trimStart().startsWith('#'))
			.join('\n');
	for (const text of [environment, unit]) {
		assert.doesNotMatch(
			withoutComments(text),
			/passphrase|\bPIN\b|token|secret|private[-_ ]?key|host[-_ ]?key|device[-_ ]?key|credential/iu,
		);
	}
	// The pairing PIN variable was removed from the server outright; writing it
	// would make the service refuse to start.
	assert.doesNotMatch(environment, /TERMINAY_REMOTE_PAIRING_PIN/u);
});

test('an existing environment file is parsed so a reinstall can keep its server id', () => {
	const existing = renderEnvironmentFile({
		...configuration,
		serverId: 'paired-already',
	});
	const values = parseEnvironmentFile(existing);
	assert.equal(values.TERMINAY_SERVER_ID, 'paired-already');

	// Rewriting with the preserved id leaves the identity devices paired with
	// unchanged, which is the whole point of reading it back.
	const rewritten = renderEnvironmentFile({
		...configuration,
		serverId: values.TERMINAY_SERVER_ID,
		port: 9000,
	});
	assert.match(rewritten, /^TERMINAY_SERVER_ID=paired-already$/mu);
	assert.match(rewritten, /^TERMINAY_HTTP_PORT=9000$/mu);
});

test('comments and blank lines are ignored when parsing', () => {
	const values = parseEnvironmentFile(
		'# comment\n\nA=1\n  B=two words  \nnot-a-pair\n',
	);
	assert.deepEqual({ ...values }, { A: '1', B: 'two words' });
});

test('the environment names both UI variables with one value', () => {
	const values = parseEnvironmentFile(renderEnvironmentFile(configuration));
	// Two settings that share a value: the local HTTP UI reads one, the archive
	// a paired device receives is built from the other.
	assert.equal(values.TERMINAY_UI_BUNDLE, '/opt/terminay/current/ui');
	assert.equal(values.TERMINAY_UI_RENDERER_DIRECTORY, '/opt/terminay/current/ui');
});

test('the renderer directory is the variable the server actually reads', async () => {
	// The defect this guards was writing the workspace UI under a name nothing
	// read, so the server served a placeholder to every paired device. Read the
	// server source rather than trusting the name to stay put.
	const cli = await readFile(
		resolve(
			new URL('../../..', import.meta.url).pathname,
			'apps/terminay-server/src/cli.ts',
		),
		'utf8',
	);
	assert.match(
		cli,
		/process\.env\.TERMINAY_UI_RENDERER_DIRECTORY/u,
		'the server must read the variable the CLI writes for the hosted archive',
	);

	const environment = renderEnvironmentFile(configuration);
	assert.match(environment, /^TERMINAY_UI_RENDERER_DIRECTORY=/mu);
});

test('an install without the renderer directory would serve a placeholder', async () => {
	// Named for the symptom, so a future reader knows what removing it costs.
	const host = await readFile(
		resolve(
			new URL('../../..', import.meta.url).pathname,
			'apps/terminay-server/src/remote/hostedPairingHost.ts',
		),
		'utf8',
	);
	assert.match(host, /createMinimalUiArchive\(\)/u);
	assert.match(host, /Terminay workspace is connected\./u);
	// The fallback is reached only when getUiArchive is absent, which is exactly
	// what a missing renderer directory produces.
	assert.match(host, /options\.getUiArchive\s*\n?\s*\?\s*await options\.getUiArchive\(\)/u);
});
