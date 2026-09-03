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

function authority() {
	const pending = new Map([
		['approval-1', { approvalId: 'approval-1', deviceName: 'Phone', matchCode: 'K7Q2M', expiresAt: 5_000 }],
	]);
	return {
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

test('handler never throws across the socket boundary', () => {
	assert.deepEqual(handleApprovalSocketRequest({ op: 'deny', approvalId: 'missing' }, authority()), {
		ok: false, error: 'pairing approval is no longer pending',
	});
});
