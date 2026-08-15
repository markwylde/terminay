import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  RemoteDeviceAuthentication,
} from '../dist/remote/index.js';

const SERVER_ID = 'server-a';
const ORIGIN = 'https://server-a.terminay.com';

function keys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function signature(privateKey, signingInput) {
  return sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    padding: 6,
    saltLength: 32,
  }).toString('base64url');
}

test('a registered RSA-PSS device receives one short-lived ticket for a signed challenge', () => {
  let now = 1_000;
  const authority = new RemoteDeviceAuthentication({
    serverId: SERVER_ID,
    sessionOrigin: ORIGIN,
    now: () => now,
  });
  const key = keys();
  const device = authority.enroll({
    deviceId: 'device-a', deviceName: 'Mark browser', publicKeyPem: key.publicKey,
  });
  assert.equal(device.publicKeyPem, key.publicKey);
  const pending = authority.createChallenge(device.deviceId);
  assert.equal(pending.challenge.serverId, SERVER_ID);
  assert.equal(pending.challenge.sessionOrigin, ORIGIN);
  const ticket = authority.verify({
    deviceId: device.deviceId,
    challengeId: pending.challenge.challengeId,
    deviceSignature: signature(key.privateKey, pending.signingInput),
  });
  assert.equal(ticket.deviceId, device.deviceId);
  assert.equal(authority.consumeTicket(ticket.ticket).ticketId, ticket.ticketId);
  assert.throws(() => authority.consumeTicket(ticket.ticket), /used|invalid/);
  now += 1;
  assert.throws(() => authority.verify({
    deviceId: device.deviceId,
    challengeId: pending.challenge.challengeId,
    deviceSignature: signature(key.privateKey, pending.signingInput),
  }), /unavailable/);
});

test('revocation invalidates outstanding challenges and tickets without affecting another device', () => {
  const authority = new RemoteDeviceAuthentication({ serverId: SERVER_ID, sessionOrigin: ORIGIN });
  const first = keys();
  const second = keys();
  authority.enroll({ deviceId: 'device-a', deviceName: 'A', publicKeyPem: first.publicKey });
  authority.enroll({ deviceId: 'device-b', deviceName: 'B', publicKeyPem: second.publicKey });
  const a = authority.createChallenge('device-a');
  const b = authority.createChallenge('device-b');
  authority.revokeDevice('device-a');
  assert.throws(() => authority.verify({ deviceId: 'device-a', challengeId: a.challenge.challengeId, deviceSignature: signature(first.privateKey, a.signingInput) }), /unavailable|revoked/);
  assert.equal(authority.verify({ deviceId: 'device-b', challengeId: b.challenge.challengeId, deviceSignature: signature(second.privateKey, b.signingInput) }).deviceId, 'device-b');
});
