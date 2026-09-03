import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { createServerRemoteExposure } from '../dist/index.js';

const MATCH_CODE = 'K7Q2M';

function deviceKey() {
	return generateKeyPairSync('rsa', {
		modulusLength: 2048,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
}

function exposureWithRoom(clock = { now: 1_000_000 }) {
	const exposure = createServerRemoteExposure({
		serverId: 'server-a',
		sessionOrigin: 'https://server-a.terminay.com',
		pairingUrlFormat: 'hosted-compact',
		cleanupIntervalMs: 0,
		now: () => clock.now,
	});
	const handoff = exposure.start();
	return { exposure, handoff, clock };
}

function request(exposure, handoff, overrides = {}) {
	return exposure.requestEnrollment({
		pairingSessionId: handoff.pairingSessionId,
		pairingToken: handoff.pairingToken,
		deviceName: 'Phone',
		publicKeyPem: deviceKey().publicKey,
		matchCode: MATCH_CODE,
		peerId: 'peer-a',
		...overrides,
	});
}

test('approval enrolls the device, consumes the room, and mints a ticket bound to the requesting peer', () => {
	const { exposure, handoff } = exposureWithRoom();
	const resolutions = [];
	exposure.onApprovalResolved((resolution) => resolutions.push(resolution));
	const requested = [];
	exposure.onApprovalRequested((pending) => requested.push(pending));
	const pending = request(exposure, handoff);
	assert.deepEqual(requested, [pending]);
	assert.equal(pending.matchCode, MATCH_CODE);
	assert.equal(pending.deviceName, 'Phone');
	assert.equal('publicKeyPem' in pending, false, 'summaries never carry the device key');
	assert.equal(exposure.devices.list().length, 0, 'nothing is enrolled before approval');
	assert.equal(exposure.pairing.metadata(handoff.roomId).state, 'active');

	const approved = exposure.approveEnrollment(pending.approvalId);
	assert.equal(approved.outcome, 'approved');
	assert.equal(approved.deviceName, 'Phone');
	assert.equal(exposure.devices.list().length, 1);
	assert.equal(exposure.pairing.metadata(handoff.roomId).state, 'consumed');
	assert.deepEqual(resolutions, [approved]);
	assert.deepEqual(exposure.listPendingApprovals(), []);

	// The ticket answers only on the peer that asked; any other presentation spends it.
	assert.throws(() => exposure.consumeConnectionTicket(approved.ticket, 'peer-b'), /another peer/u);
	assert.throws(() => exposure.consumeConnectionTicket(approved.ticket, 'peer-a'), /invalid or already used/u);
	assert.throws(() => exposure.approveEnrollment(pending.approvalId), /no longer pending/u);
});

test('deny, expiry, rotation, and a closed peer discard the request and enroll nothing', () => {
	const { exposure, handoff, clock } = exposureWithRoom();
	const outcomes = [];
	exposure.onApprovalResolved((resolution) => outcomes.push(resolution.outcome));

	const denied = request(exposure, handoff);
	assert.equal(exposure.denyEnrollment(denied.approvalId).approvalId, denied.approvalId);
	assert.equal(exposure.devices.list().length, 0);
	assert.equal(exposure.pairing.metadata(handoff.roomId).state, 'active', 'deny leaves the room usable');

	const expiring = request(exposure, handoff);
	clock.now += 120_001;
	assert.deepEqual(exposure.listPendingApprovals(), []);
	assert.throws(() => exposure.approveEnrollment(expiring.approvalId), /no longer pending/u);

	request(exposure, handoff, { peerId: 'peer-closed' });
	assert.equal(exposure.cancelPendingApprovalsForPeer('peer-closed'), 1);

	request(exposure, handoff, { peerId: 'peer-rotated' });
	const rotated = exposure.rotateHostedPairing();
	assert.notEqual(rotated.pairingSessionId, handoff.pairingSessionId);
	assert.deepEqual(exposure.listPendingApprovals(), []);
	assert.deepEqual(outcomes, ['denied', 'expired', 'closed', 'replaced']);
	assert.equal(exposure.devices.list().length, 0);
});

test('one pending request per room: a racing second device is refused, and a wrong fragment fails fast', () => {
	const { exposure, handoff } = exposureWithRoom();
	request(exposure, handoff);
	assert.throws(() => request(exposure, handoff, { peerId: 'peer-b' }), /already waiting/u);
	assert.throws(
		() => request(exposure, handoff, { pairingToken: 'x'.repeat(43), peerId: 'peer-c' }),
		/pairing secret is invalid/u,
	);
	assert.throws(() => request(exposure, handoff, { matchCode: 'oops', peerId: 'peer-d' }), /match code/u);
	assert.throws(() => request(exposure, handoff, { publicKeyPem: 'nope', peerId: 'peer-e' }), /public key/u);
});

test('reset revokes every device and closes pending approvals; reconnect proofs then fail', () => {
	const { exposure, handoff } = exposureWithRoom();
	const key = deviceKey();
	const pending = request(exposure, handoff, { publicKeyPem: key.publicKey });
	const approved = exposure.approveEnrollment(pending.approvalId);
	const challenge = exposure.createDeviceChallenge(approved.deviceId);
	const signature = sign('sha256', Buffer.from(challenge.signingInput), { key: key.privateKey, padding: 6, saltLength: 32 }).toString('base64url');
	const ticket = exposure.verifyDeviceSignature({
		deviceId: approved.deviceId,
		challengeId: challenge.challenge.challengeId,
		deviceSignature: signature,
		peerId: 'peer-r',
	});
	assert.equal(exposure.consumeConnectionTicket(ticket.ticket, 'peer-r').deviceId, approved.deviceId);
	return exposure.revokeAllDevices().then((count) => {
		assert.equal(count, 1);
		assert.throws(() => exposure.createDeviceChallenge(approved.deviceId), /revoked/u);
	});
});
