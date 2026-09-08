import assert from 'node:assert/strict';
import test from 'node:test';

import { HELP_TEXT, UsageError, parseCommandLine } from '../dist/args.js';

function parse(...argv) {
	return parseCommandLine(argv);
}

function usage(...argv) {
	return assert.throws(() => parseCommandLine(argv), UsageError);
}

test('every daemon command parses', () => {
	for (const command of [
		'install',
		'uninstall',
		'start',
		'stop',
		'status',
		'upgrade',
		'qr-code',
		'approvals',
		'reset-identity',
	]) {
		assert.equal(parse('daemon', command).command, command, command);
	}
	assert.equal(parse('daemon', 'approve', 'abc').command, 'approve');
	assert.equal(parse('daemon', 'deny', 'abc').command, 'deny');
});

test('pairing-url is an alias for qr-code', () => {
	assert.equal(parse('daemon', 'pairing-url').command, 'qr-code');
	assert.equal(parse('daemon', 'pairing-url', '--no-wait').options.wait, false);
});

test('help is reachable with no arguments, `help`, and --help anywhere', () => {
	assert.equal(parse().command, 'help');
	assert.equal(parse('help').command, 'help');
	assert.equal(parse('--help').command, 'help');
	assert.equal(parse('daemon').command, 'help');
	assert.equal(parse('daemon', 'install', '--help').command, 'help');
	assert.match(HELP_TEXT, /npx terminay daemon <command>/u);
});

test('install takes an optional reference', () => {
	assert.equal(parse('daemon', 'install').ref, undefined);
	assert.equal(parse('daemon', 'install', 'v4.1.1').ref, 'v4.1.1');
	assert.equal(parse('daemon', 'install', 'main').ref, 'main');
	assert.equal(parse('daemon', 'upgrade', 'feature/branch').ref, 'feature/branch');
	usage('daemon', 'install', 'v4.1.1', 'extra');
});

test('approve and deny require exactly one valid approval id', () => {
	assert.equal(parse('daemon', 'approve', 'device-7').approvalId, 'device-7');
	usage('daemon', 'approve');
	usage('daemon', 'deny');
	usage('daemon', 'approve', 'a', 'b');
	usage('daemon', 'approve', '../escape');
});

test('commands that take no arguments reject them', () => {
	usage('daemon', 'status', 'extra');
	usage('daemon', 'approvals', 'extra');
});

test('value flags accept both spellings and reject a missing value', () => {
	assert.equal(parse('daemon', 'install', '--run-as', 'ci').options.runAs, 'ci');
	assert.equal(parse('daemon', 'install', '--run-as=ci').options.runAs, 'ci');
	usage('daemon', 'install', '--run-as');
	usage('daemon', 'install', '--run-as', '--system');
	usage('daemon', 'install', '--run-as=');
	usage('daemon', 'install', '--run-as', 'a', '--run-as', 'b');
});

test('unknown flags are rejected', () => {
	usage('daemon', 'install', '--nope');
	usage('daemon', 'install', '--force');
});

test('flags are rejected by commands that do not accept them', () => {
	usage('daemon', 'upgrade', '--purge');
	usage('daemon', 'status', '--mode', 'direct');
	usage('daemon', 'install', '--allow-downgrade');
	usage('daemon', 'start', '--no-wait');
});

test('unknown commands are rejected', () => {
	usage('daemon', 'reinstall');
	usage('service', 'install');
});

test('scope flags are exclusive', () => {
	assert.equal(parse('daemon', 'install', '--system').options.scope, 'system');
	assert.equal(parse('daemon', 'install', '--user').options.scope, 'user');
	assert.equal(parse('daemon', 'install').options.scope, undefined);
	usage('daemon', 'install', '--system', '--user');
});

test('boolean flags do not take values', () => {
	usage('daemon', 'uninstall', '--purge=true');
	assert.equal(parse('daemon', 'uninstall', '--purge', '--yes').options.purge, true);
	assert.equal(parse('daemon', 'uninstall', '--purge', '--yes').options.yes, true);
});

test('port and mode are validated', () => {
	assert.equal(parse('daemon', 'install', '--port', '8443').options.port, 8443);
	usage('daemon', 'install', '--port', '0');
	usage('daemon', 'install', '--port', '70000');
	usage('daemon', 'install', '--port', 'https');
	assert.equal(parse('daemon', 'qr-code', '--mode', 'direct').options.mode, 'direct');
	usage('daemon', 'qr-code', '--mode', 'sideways');
});

test('remaining install flags reach the options', () => {
	const parsed = parse(
		'daemon',
		'install',
		'--direct-origin',
		'https://box.example.com:8443',
		'--hosted-domain',
		'terminay.com',
		'--expose',
		'hosted,direct',
		'--project-root',
		'/srv/projects',
	);
	assert.equal(parsed.options.directOrigin, 'https://box.example.com:8443');
	assert.equal(parsed.options.hostedDomain, 'terminay.com');
	assert.equal(parsed.options.expose, 'hosted,direct');
	assert.equal(parsed.options.projectRoot, '/srv/projects');
});
