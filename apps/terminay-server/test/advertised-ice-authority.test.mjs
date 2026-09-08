import assert from 'node:assert/strict';
import test from 'node:test';
import { parseServerCliOptions } from '../src/cliOptions.ts';
import { hostedPeerConfiguration } from '../src/remote/hostedPeerLifecycle.ts';

/**
 * The advertised ICE address is a routing hint. "Advertise an address" sounds
 * like it could redirect a peer somewhere, so these assert the boundary it does
 * not cross: it changes which addresses a peer may try, and nothing about what
 * authenticates the server once a peer arrives.
 */

const BASE = ['--data-root', '/tmp/advertise-authority', '--server-id', 'box'];

test('an advertised address changes nothing else about the parsed configuration', () => {
	const without = parseServerCliOptions(BASE, {});
	const with_ = parseServerCliOptions(
		[...BASE, '--advertise-address', '127.0.0.1:51000'],
		{},
	);

	const { advertiseAddress, ...rest } = with_;
	assert.deepEqual(
		{ ...rest },
		{ ...without },
		'only the advertised address may differ',
	);
	assert.deepEqual({ ...advertiseAddress }, { host: '127.0.0.1', port: 51000 });
});

test('an advertised address does not touch the session or remote origin', () => {
	const without = parseServerCliOptions(BASE, {});
	const with_ = parseServerCliOptions(
		[...BASE, '--advertise-address', '198.51.100.9:51000'],
		{},
	);

	// The pairing URL is built from these; if the advertised address reached
	// them, it would be handed to a client as somewhere to go rather than
	// somewhere to send connectivity checks.
	assert.equal(with_.remoteOrigin, without.remoteOrigin);
	assert.equal(with_.hostedDomain, without.hostedDomain);
	assert.equal(with_.directOrigin, without.directOrigin);
	assert.deepEqual([...with_.exposeModes], [...without.exposeModes]);
});

test('an advertised address does not change the ICE servers or message limits', () => {
	const without = hostedPeerConfiguration('example.terminay.com', undefined, [
		'192.168.1.20',
	]);
	const with_ = hostedPeerConfiguration(
		'example.terminay.com',
		undefined,
		['192.168.1.20'],
		{
			host: '127.0.0.1',
			port: 51000,
		},
	);
	assert.deepEqual(with_.iceServers, without.iceServers);
	assert.equal(with_.maxMessageSize, without.maxMessageSize);
});

test('the peer configuration carries no credential, key, or identity', () => {
	const config = hostedPeerConfiguration(
		'example.terminay.com',
		undefined,
		[],
		{
			host: '127.0.0.1',
			port: 51000,
		},
	);
	// Whatever answers on the advertised address still has to prove the host
	// key over the transport transcript; nothing here can stand in for that.
	const serialized = JSON.stringify(config);
	assert.doesNotMatch(
		serialized,
		/hostKey|privateKey|token|secret|fingerprint|transcript/iu,
	);
	assert.deepEqual(Object.keys(config).sort(), [
		'iceAdditionalHostAddresses',
		'icePortRange',
		'iceServers',
		'iceUseIpv4',
		'iceUseIpv6',
		'maxMessageSize',
	]);
});
