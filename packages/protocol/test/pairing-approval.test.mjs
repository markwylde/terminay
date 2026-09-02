import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, verify, constants } from 'node:crypto';
import test from 'node:test';
import {
	AUTHENTICATED_WEBRTC_TRANSPORT_VERSION,
	DEVICE_JOIN_PROOF_LABEL,
	MATCH_CODE_ALPHABET,
	deriveMatchCode,
	deviceJoinProofPayload,
	isDeviceJoinProof,
	isMatchCode,
	parseEnrollmentPushMessage,
	parsePendingEnrollmentResponse,
	pemToDer,
	renderMatchCode,
} from '../dist/index.js';

const SECRET = Buffer.alloc(32, 0x22).toString('base64url');
const NONCE = Buffer.alloc(32, 0x55).toString('base64url');
const HOST_KEY = Buffer.alloc(32, 0x11).toString('base64url');
const device = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { format: 'pem', type: 'spki' },
	privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
});

test('transport contract is version 2', () => {
	assert.equal(AUTHENTICATED_WEBRTC_TRANSPORT_VERSION, 2);
});

test('match code is deterministic, five symbols from the unambiguous alphabet, and bound to every input', async () => {
	const base = { pairingSecret: SECRET, clientNonce: NONCE, hostPublicKey: HOST_KEY, devicePublicKeyPem: device.publicKey };
	const code = await deriveMatchCode(base);
	assert.equal(code, await deriveMatchCode(base));
	assert.equal(code.length, 5);
	assert.ok(isMatchCode(code));
	for (const symbol of code) assert.ok(MATCH_CODE_ALPHABET.includes(symbol));
	assert.doesNotMatch(MATCH_CODE_ALPHABET, /[01IO]/u);
	const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { format: 'pem', type: 'spki' }, privateKeyEncoding: { format: 'pem', type: 'pkcs8' } });
	const variants = await Promise.all([
		deriveMatchCode({ ...base, pairingSecret: Buffer.alloc(32, 0x23).toString('base64url') }),
		deriveMatchCode({ ...base, clientNonce: Buffer.alloc(32, 0x56).toString('base64url') }),
		deriveMatchCode({ ...base, hostPublicKey: Buffer.alloc(32, 0x12).toString('base64url') }),
		deriveMatchCode({ ...base, devicePublicKeyPem: other.publicKey }),
	]);
	// 25 bits of entropy makes a coincidental collision across four variants vanishingly unlikely.
	assert.equal(variants.filter((variant) => variant === code).length, 0);
});

test('match code ignores PEM line wrapping but rejects non-PEM keys', async () => {
	const base = { pairingSecret: SECRET, clientNonce: NONCE, hostPublicKey: HOST_KEY, devicePublicKeyPem: device.publicKey };
	const rewrapped = device.publicKey.replace(/\n/gu, '\r\n');
	assert.equal(await deriveMatchCode({ ...base, devicePublicKeyPem: rewrapped }), await deriveMatchCode(base));
	assert.deepEqual(pemToDer(rewrapped), pemToDer(device.publicKey));
	await assert.rejects(deriveMatchCode({ ...base, devicePublicKeyPem: 'not a key' }), /PEM is invalid/u);
	await assert.rejects(deriveMatchCode({ ...base, pairingSecret: 'short' }), /Pairing secret is invalid/u);
	await assert.rejects(deriveMatchCode({ ...base, clientNonce: `${NONCE}A` }), /Client nonce is invalid/u);
});

test('match code rendering takes the first 25 bits most-significant first', () => {
	assert.equal(renderMatchCode(Uint8Array.from([0, 0, 0, 0])), 'AAAAA');
	assert.equal(renderMatchCode(Uint8Array.from([0xff, 0xff, 0xff, 0xff])), '99999');
	assert.equal(renderMatchCode(Uint8Array.from([0b00001000, 0b01000010, 0b00010000, 0b10000000])), 'BBBBB');
	assert.throws(() => renderMatchCode(Uint8Array.from([1, 2, 3])), /invalid/u);
});

test('device join proof payload is label, session id, and nonce, and verifies with the device key', () => {
	const payload = deviceJoinProofPayload({ sessionId: 'server123', clientNonce: NONCE });
	assert.equal(new TextDecoder().decode(payload), `${DEVICE_JOIN_PROOF_LABEL}\nserver123\n${NONCE}`);
	const proof = sign('sha256', Buffer.from(payload), { key: device.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString('base64url');
	assert.ok(isDeviceJoinProof(proof));
	assert.ok(verify('sha256', Buffer.from(payload), { key: device.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, Buffer.from(proof, 'base64url')));
	assert.throws(() => deviceJoinProofPayload({ sessionId: 'bad session', clientNonce: NONCE }), /session id/u);
	assert.throws(() => deviceJoinProofPayload({ sessionId: 'server123', clientNonce: 'short' }), /nonce/u);
	assert.equal(isDeviceJoinProof('x'.repeat(2049)), false);
});

test('enrollment response and push messages are closed shapes', () => {
	const pending = parsePendingEnrollmentResponse({ status: 'pending', approvalId: 'approval-1', expiresAt: 130_000 }, 10_000);
	assert.deepEqual(pending, { status: 'pending', approvalId: 'approval-1', expiresAt: 130_000 });
	assert.throws(() => parsePendingEnrollmentResponse({ status: 'pending', approvalId: 'approval-1', expiresAt: 5_000 }, 10_000), /invalid/u);
	assert.throws(() => parsePendingEnrollmentResponse({ status: 'pending', approvalId: 'approval-1', expiresAt: 130_000, extra: 1 }, 10_000), /invalid/u);
	assert.throws(() => parsePendingEnrollmentResponse({ status: 'ok', approvalId: 'approval-1', expiresAt: 130_000 }, 10_000), /invalid/u);
	const approved = parseEnrollmentPushMessage({ type: 'enrollment-approved', approvalId: 'approval-1', deviceId: 'device-1', deviceName: 'Phone', ticket: 'T'.repeat(43) });
	assert.equal(approved.ticket, 'T'.repeat(43));
	assert.throws(() => parseEnrollmentPushMessage({ type: 'enrollment-approved', approvalId: 'approval-1', deviceId: 'device-1', deviceName: 'Phone', ticket: 'short' }), /invalid/u);
	assert.throws(() => parseEnrollmentPushMessage({ type: 'enrollment-approved', approvalId: 'approval-1', deviceId: 'device-1', deviceName: 'x'.repeat(129), ticket: 'T'.repeat(43) }), /invalid/u);
	assert.deepEqual(parseEnrollmentPushMessage({ type: 'enrollment-denied', approvalId: 'approval-1', reason: 'expired' }), { type: 'enrollment-denied', approvalId: 'approval-1', reason: 'expired' });
	assert.throws(() => parseEnrollmentPushMessage({ type: 'enrollment-denied', approvalId: 'approval-1', reason: 'because' }), /invalid/u);
	assert.throws(() => parseEnrollmentPushMessage({ type: 'other' }), /invalid/u);
});
