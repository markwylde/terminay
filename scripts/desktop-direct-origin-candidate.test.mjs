import assert from 'node:assert/strict';
import test from 'node:test';
import {
	deriveDirectOriginCandidates,
	descriptionCandidates,
	directOriginAddresses,
} from '../electron/remote/directOriginCandidate.ts';

/**
 * A client that reached a server through direct signaling treats the host of
 * that origin as a place the server can be reached, on the UDP ports the server
 * offered. These tests pin what is derived, and what never is.
 */

const HOST_CANDIDATE =
	'candidate:1 1 udp 2130706431 10.88.0.88 51000 typ host generation 0';

const neverResolves = async () => {
	throw new Error('resolver must not be consulted');
};

test('a literal direct origin is its own address, with no lookup', async () => {
	assert.deepEqual(
		await directOriginAddresses('https://192.168.2.218:8443', neverResolves),
		['192.168.2.218'],
	);
	assert.deepEqual(
		await directOriginAddresses('https://[2001:db8::10]:8443', neverResolves),
		['2001:db8::10'],
	);
});

test('a named direct origin is resolved on the client', async () => {
	const asked = [];
	const addresses = await directOriginAddresses(
		'https://box.example.com:8443',
		async (host) => {
			asked.push(host);
			return ['203.0.113.7', '203.0.113.7', '2001:db8::7'];
		},
	);
	assert.deepEqual(asked, ['box.example.com']);
	assert.deepEqual(addresses, ['203.0.113.7', '2001:db8::7']);
});

test('a loopback direct origin derives nothing', async () => {
	// It carries signaling to a published listener and says nothing about where
	// media goes, and a remote loopback candidate is not worth offering.
	for (const origin of [
		'https://localhost:9443',
		'https://127.0.0.1:9443',
		'https://[::1]:9443',
		'https://server.localhost:9443',
	]) {
		assert.deepEqual(await directOriginAddresses(origin, neverResolves), []);
	}
	assert.deepEqual(
		await directOriginAddresses('https://box.example.com', async () => [
			'127.0.0.1',
			'::1',
		]),
		[],
	);
});

test('a name that does not resolve derives nothing rather than failing', async () => {
	assert.deepEqual(
		await directOriginAddresses('https://box.example.com:8443', async () => {
			throw new Error('ENOTFOUND');
		}),
		[],
	);
	assert.deepEqual(await directOriginAddresses('not an origin'), []);
});

test('an offered UDP host port is paired with the signaling host', () => {
	const seen = new Set();
	const derived = deriveDirectOriginCandidates(
		HOST_CANDIDATE,
		['192.168.2.218'],
		seen,
	);
	assert.equal(derived.length, 1);
	const fields = derived[0].split(' ');
	assert.match(fields[0], /^candidate:\S+$/u);
	assert.deepEqual(fields.slice(1), [
		'1',
		'udp',
		'2130706431',
		'192.168.2.218',
		'51000',
		'typ',
		'host',
	]);
});

test('the same address and port is derived once', () => {
	const seen = new Set();
	const addresses = ['192.168.2.218'];
	assert.equal(
		deriveDirectOriginCandidates(HOST_CANDIDATE, addresses, seen).length,
		1,
	);
	// A second local address of the server shares the published port.
	assert.equal(
		deriveDirectOriginCandidates(
			'candidate:2 1 udp 2130706431 172.17.0.2 51000 typ host',
			addresses,
			seen,
		).length,
		0,
	);
	// A different published port is a different destination.
	assert.equal(
		deriveDirectOriginCandidates(
			'candidate:3 1 udp 2130706431 10.88.0.88 51001 typ host',
			addresses,
			seen,
		).length,
		1,
	);
});

test('a candidate already at the signaling host is left alone', () => {
	assert.deepEqual(
		deriveDirectOriginCandidates(
			'candidate:1 1 udp 2130706431 192.168.2.218 51000 typ host',
			['192.168.2.218'],
			new Set(),
		),
		[],
	);
});

test('only UDP host candidates are used', () => {
	const addresses = ['192.168.2.218'];
	for (const candidate of [
		// A reflexive port is some other machine's mapping.
		'candidate:1 1 udp 1694498815 217.169.19.26 51000 typ srflx raddr 10.88.0.88 rport 51000',
		'candidate:1 1 udp 16777215 198.51.100.1 3478 typ relay raddr 0.0.0.0 rport 0',
		'candidate:1 1 tcp 2105458943 10.88.0.88 9 typ host tcptype active',
		'candidate:1 1 udp 2130706431 10.88.0.88 0 typ host',
		'candidate:1 1 udp 2130706431 10.88.0.88 notaport typ host',
		'not a candidate',
		'',
	]) {
		assert.deepEqual(
			deriveDirectOriginCandidates(candidate, addresses, new Set()),
			[],
			candidate,
		);
	}
});

test('no addresses derive nothing', () => {
	assert.deepEqual(
		deriveDirectOriginCandidates(HOST_CANDIDATE, [], new Set()),
		[],
	);
});

test('candidates in a description are read with their media id', () => {
	const sdp = [
		'v=0',
		'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
		'a=candidate:1 1 udp 2130706431 10.88.0.88 51000 typ host',
		'a=mid:data',
		'a=candidate:2 1 udp 1694498815 217.169.19.26 51000 typ srflx',
		'',
	].join('\r\n');
	assert.deepEqual(descriptionCandidates(sdp), [
		{
			candidate: 'candidate:1 1 udp 2130706431 10.88.0.88 51000 typ host',
			sdpMid: 'data',
		},
		{
			candidate: 'candidate:2 1 udp 1694498815 217.169.19.26 51000 typ srflx',
			sdpMid: 'data',
		},
	]);
	assert.deepEqual(descriptionCandidates('v=0\r\n'), []);
});
