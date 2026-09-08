import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	approvalSocketPath,
	handleApprovalSocketRequest,
	parseApprovalSocketRequest,
	sendApprovalSocketRequest,
	startApprovalSocket,
} from '../dist/remote/approvalSocket.js';

function authority(exposure = {}) {
	const pending = new Map([
		['approval-1', { approvalId: 'approval-1', deviceName: 'Phone', matchCode: 'K7Q2M', expiresAt: 5_000 }],
	]);
	let room = 0;
	return {
		...(exposure.modes === undefined
			? {}
			: {
					exposureModes: () => exposure.modes,
					pairingHandoffs: (rotate) => {
						if (rotate) room += 1;
						return exposure.modes.map((mode) => ({
							mode,
							pairingUrl: `https://${mode}.example.test/v1/?hostName=box#secret-${room}`,
							pairingExpiresAt: '2026-07-27T19:00:00.000Z',
							serverId: 'server-a',
						}));
					},
				}),
		listPendingApprovals: () => [...pending.values()],
		approveEnrollment(approvalId) {
			const entry = pending.get(approvalId);
			if (!entry) throw new Error('pairing approval is no longer pending');
			pending.delete(approvalId);
			return { deviceName: entry.deviceName };
		},
		denyEnrollment(approvalId) {
			const entry = pending.get(approvalId);
			if (!entry) throw new Error('pairing approval is no longer pending');
			pending.delete(approvalId);
			return { deviceName: entry.deviceName };
		},
	};
}

test('approval requests are a closed shape', () => {
	assert.deepEqual(parseApprovalSocketRequest({ op: 'list' }), { op: 'list' });
	assert.deepEqual(parseApprovalSocketRequest({ op: 'approve', approvalId: 'approval-1' }), { op: 'approve', approvalId: 'approval-1' });
	assert.throws(() => parseApprovalSocketRequest({ op: 'approve' }), /invalid/u);
	assert.throws(() => parseApprovalSocketRequest({ op: 'approve', approvalId: 'bad id' }), /invalid/u);
	assert.throws(() => parseApprovalSocketRequest({ op: 'list', extra: true }), /invalid/u);
	assert.throws(() => parseApprovalSocketRequest({ op: 'drop' }), /invalid/u);
	assert.deepEqual(parseApprovalSocketRequest({ op: 'pairing' }), { op: 'pairing' });
	assert.deepEqual(parseApprovalSocketRequest({ op: 'pairing', rotate: true }), { op: 'pairing', rotate: true });
	assert.deepEqual(parseApprovalSocketRequest({ op: 'pairing', rotate: false }), { op: 'pairing', rotate: false });
	assert.throws(() => parseApprovalSocketRequest({ op: 'pairing', rotate: 'yes' }), /invalid/u);
	assert.throws(() => parseApprovalSocketRequest({ op: 'pairing', approvalId: 'approval-1' }), /invalid/u);
});

test('the pairing op reports one live handoff per exposure mode and can mint a fresh room', async () => {
	const exposed = authority({ modes: ['hosted', 'direct'] });
	const current = await handleApprovalSocketRequest({ op: 'pairing' }, exposed);
	assert.deepEqual(current.exposure, ['hosted', 'direct']);
	assert.deepEqual(current.handoffs.map((handoff) => handoff.mode), ['hosted', 'direct']);
	assert.equal(current.handoffs[0].serverId, 'server-a');
	assert.equal(current.handoffs[0].pairingExpiresAt, '2026-07-27T19:00:00.000Z');
	// Nothing but the URL, its expiry, and the mode crosses the socket.
	for (const handoff of current.handoffs) {
		assert.deepEqual(Object.keys(handoff).sort(), ['mode', 'pairingExpiresAt', 'pairingUrl', 'serverId']);
	}
	assert.equal(JSON.stringify(current).includes('hostKey'), false);

	const unchanged = await handleApprovalSocketRequest({ op: 'pairing', rotate: false }, exposed);
	assert.deepEqual(unchanged.handoffs, current.handoffs);
	const rotated = await handleApprovalSocketRequest({ op: 'pairing', rotate: true }, exposed);
	assert.notEqual(rotated.handoffs[0].pairingUrl, current.handoffs[0].pairingUrl);
});

test('a server nobody exposed answers the pairing op with no URL at all', async () => {
	assert.deepEqual(await handleApprovalSocketRequest({ op: 'pairing' }, authority()), {
		ok: true,
		exposure: 'off',
		handoffs: [],
	});
	assert.deepEqual(await handleApprovalSocketRequest({ op: 'pairing' }, authority({ modes: [] })), {
		ok: true,
		exposure: 'off',
		handoffs: [],
	});
});

test('the socket lists only metadata and applies approve and deny once', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-approval-socket-'));
	const socketPath = approvalSocketPath(directory);
	const server = await startApprovalSocket({ socketPath, authority: authority() });
	try {
		assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
		const listed = await sendApprovalSocketRequest(socketPath, { op: 'list' });
		assert.deepEqual(listed, { ok: true, pending: [{ approvalId: 'approval-1', deviceName: 'Phone', matchCode: 'K7Q2M', expiresAt: 5_000 }] });
		assert.equal(JSON.stringify(listed).includes('publicKey'), false);
		assert.deepEqual(await sendApprovalSocketRequest(socketPath, { op: 'approve', approvalId: 'approval-1' }), {
			ok: true, approvalId: 'approval-1', outcome: 'approved', deviceName: 'Phone',
		});
		assert.deepEqual(await sendApprovalSocketRequest(socketPath, { op: 'deny', approvalId: 'approval-1' }), {
			ok: false, error: 'pairing approval is no longer pending',
		});
	} finally {
		await server.close();
		await rm(directory, { force: true, recursive: true });
	}
	await assert.rejects(sendApprovalSocketRequest(socketPath, { op: 'list' }), /no running server/u);
});

test('handler never throws across the socket boundary', async () => {
	assert.deepEqual(await handleApprovalSocketRequest({ op: 'deny', approvalId: 'missing' }, authority()), {
		ok: false, error: 'pairing approval is no longer pending',
	});
});
