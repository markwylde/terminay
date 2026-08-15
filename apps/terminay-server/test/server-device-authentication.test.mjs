import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { createServerRemoteExposure } from '../dist/index.js';

test('pairing enrollment creates a durable device identity and signed reconnect ticket', () => {
  const exposure = createServerRemoteExposure({ serverId: 'server-a', sessionOrigin: 'https://server-a.terminay.com' });
  const handoff = exposure.start();
  const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const device = exposure.enrollDevice({
    pairingSessionId: handoff.pairingSessionId,
    pairingToken: handoff.pairingToken,
    deviceName: 'Browser',
    publicKeyPem: key.publicKey,
  });
  assert.equal(exposure.pairing.metadata(handoff.roomId).state, 'consumed');
  const pending = exposure.createDeviceChallenge(device.deviceId);
  const deviceSignature = sign('sha256', Buffer.from(pending.signingInput), {
    key: key.privateKey, padding: 6, saltLength: 32,
  }).toString('base64url');
  const ticket = exposure.verifyDeviceSignature({
    deviceId: device.deviceId,
    challengeId: pending.challenge.challengeId,
    deviceSignature,
  });
  assert.equal(exposure.consumeConnectionTicket(ticket.ticket).deviceId, device.deviceId);
});
