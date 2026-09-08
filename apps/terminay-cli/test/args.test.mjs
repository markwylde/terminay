import assert from 'node:assert/strict';
import test from 'node:test';

import { HELP_TEXT, parseCommandLine, UsageError } from '../dist/args.js';

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
	assert.equal(
		parse('daemon', 'upgrade', 'feature/branch').ref,
		'feature/branch',
	);
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
	assert.equal(
		parse('daemon', 'install', '--run-as', 'ci').options.runAs,
		'ci',
	);
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
	assert.equal(
		parse('daemon', 'uninstall', '--purge', '--yes').options.purge,
		true,
	);
	assert.equal(
		parse('daemon', 'uninstall', '--purge', '--yes').options.yes,
		true,
	);
});

test('port and mode are validated', () => {
	assert.equal(parse('daemon', 'install', '--port', '8443').options.port, 8443);
	usage('daemon', 'install', '--port', '0');
	usage('daemon', 'install', '--port', '70000');
	usage('daemon', 'install', '--port', 'https');
	assert.equal(
		parse('daemon', 'qr-code', '--mode', 'direct').options.mode,
		'direct',
	);
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

test('install and upgrade accept an advertised address', () => {
	assert.equal(
		parse('daemon', 'install', '--advertise-address', '127.0.0.1:51000').options
			.advertiseAddress,
		'127.0.0.1:51000',
	);
	assert.equal(
		parse('daemon', 'upgrade', '--advertise-address=[::1]:51000').options
			.advertiseAddress,
		'[::1]:51000',
	);
});

test('an empty advertised address is the clearing form, not a usage error', () => {
	// Every other value flag rejects an empty value; this one is how an operator
	// removes an address they set earlier.
	assert.equal(
		parse('daemon', 'upgrade', '--advertise-address', '').options
			.advertiseAddress,
		'',
	);
	assert.equal(
		parse('daemon', 'upgrade', '--advertise-address=').options.advertiseAddress,
		'',
	);
	usage('daemon', 'install', '--run-as=');
});

test('a hostname is refused, and the message says why', () => {
	assert.throws(
		() =>
			parseCommandLine([
				'daemon',
				'install',
				'--advertise-address',
				'box.example.com:51000',
			]),
		(error) =>
			error instanceof UsageError &&
			/literal address and port/u.test(error.message),
	);
	usage('daemon', 'install', '--advertise-address', 'localhost:51000');
});

test('a malformed or out-of-range advertised address is refused', () => {
	for (const value of [
		'127.0.0.1',
		'51000',
		'127.0.0.1:',
		'127.0.0.1:0',
		'127.0.0.1:70000',
		'300.0.0.1:51000',
	]) {
		usage('daemon', 'install', '--advertise-address', value);
	}
});

test('commands that do not configure the server reject the flag', () => {
	usage('daemon', 'status', '--advertise-address', '127.0.0.1:51000');
	usage('daemon', 'qr-code', '--advertise-address', '127.0.0.1:51000');
	usage('daemon', 'uninstall', '--advertise-address', '127.0.0.1:51000');
});

test('the help text documents the flag and that the port must be forwarded', () => {
	assert.match(HELP_TEXT, /--advertise-address/u);
	assert.match(HELP_TEXT, /forwarded/u);
});
