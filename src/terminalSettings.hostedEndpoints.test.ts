import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultTerminalSettings,
	hostedEndpointsProblem,
	normalizeTerminalSettings,
	terminalSettingsSections,
} from './terminalSettings.ts';

const remote = (input: Record<string, unknown>) =>
	normalizeTerminalSettings({ remoteAccess: input }).remoteAccess;

test('the hosted endpoints default to production', () => {
	assert.equal(defaultTerminalSettings.remoteAccess.appServer, 'https://app.terminay.com');
	assert.equal(
		defaultTerminalSettings.remoteAccess.sessionServer,
		'https://<session>.terminay.com',
	);
	const normalized = remote({});
	assert.equal(normalized.appServer, 'https://app.terminay.com');
	assert.equal(normalized.sessionServer, 'https://<session>.terminay.com');
	assert.equal('webRtcHostedDomain' in normalized, false);
});

test('a stored production hosted domain moves to the production pair', () => {
	const normalized = remote({ webRtcHostedDomain: 'terminay.com' });
	assert.equal(normalized.appServer, 'https://app.terminay.com');
	assert.equal(normalized.sessionServer, 'https://<session>.terminay.com');
	assert.equal('webRtcHostedDomain' in normalized, false);
});

test('a stored loopback hosted domain moves to a loopback pair', () => {
	const normalized = remote({ webRtcHostedDomain: 'localhost:18080' });
	assert.equal(normalized.appServer, 'http://localhost:18080');
	assert.equal(normalized.sessionServer, 'http://<session>.localhost:18080');
});

test('a stored custom hosted domain moves to the pair it always meant', () => {
	const normalized = remote({ webRtcHostedDomain: 'remote.example.com' });
	assert.equal(normalized.appServer, 'https://app.remote.example.com');
	assert.equal(normalized.sessionServer, 'https://<session>.remote.example.com');
});

test('configured endpoints win over a leftover hosted domain', () => {
	const normalized = remote({
		appServer: 'https://app-pr123.dev.terminay.com',
		sessionServer: 'https://<session>-pr123.dev.terminay.com',
		webRtcHostedDomain: 'terminay.com',
	});
	assert.equal(normalized.appServer, 'https://app-pr123.dev.terminay.com');
	assert.equal(normalized.sessionServer, 'https://<session>-pr123.dev.terminay.com');
});

test('a half-edited value is kept as typed and reported beside its field', () => {
	const normalized = remote({
		appServer: 'https://app-pr123.dev.terminay.com',
		sessionServer: 'https://dev.<session>.terminay.com',
	});
	assert.equal(normalized.sessionServer, 'https://dev.<session>.terminay.com');
	assert.match(
		hostedEndpointsProblem(normalized, 'sessionServer') ?? '',
		/leftmost label/u,
	);
	assert.equal(hostedEndpointsProblem(normalized, 'appServer'), undefined);
	assert.equal(
		hostedEndpointsProblem(defaultTerminalSettings.remoteAccess, 'appServer'),
		undefined,
	);
});

test('Settings › Remote Access shows App Server and Session Server, validated', () => {
	const fields = terminalSettingsSections.flatMap((section) => section.fields);
	const keys = fields.map((field) => field.key);
	assert.equal(keys.includes('remoteAccess.webRtcHostedDomain'), false);
	for (const key of ['remoteAccess.appServer', 'remoteAccess.sessionServer']) {
		const field = fields.find((candidate) => candidate.key === key);
		assert.ok(field, key);
		assert.equal(field.input, 'text');
		assert.equal(field.validate?.(defaultTerminalSettings), undefined);
	}
	const sessionField = fields.find(
		(field) => field.key === 'remoteAccess.sessionServer',
	);
	const invalid = normalizeTerminalSettings({
		remoteAccess: { sessionServer: 'http://<session>.terminay.com' },
	});
	assert.match(sessionField?.validate?.(invalid) ?? '', /HTTPS/u);
});
