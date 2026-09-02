import { chmod, mkdir, unlink } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';
import type { PendingEnrollmentApprovalSummary } from './serverExposure.js';

/**
 * Headless approval for standalone servers. The data root is the trust
 * boundary (owner-only permissions), so a stream socket inside it is the
 * operator's channel: `terminay-server approve <id>` connects, sends one
 * JSON line, and reads one JSON line back. No token crosses, no network
 * listener exists, and the payload never carries device keys or secrets.
 */

export const APPROVAL_SOCKET_FILENAME = 'approval.sock';
const MAX_FRAME_BYTES = 4 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export type ApprovalSocketRequest =
	| Readonly<{ op: 'list' }>
	| Readonly<{ op: 'approve'; approvalId: string }>
	| Readonly<{ op: 'deny'; approvalId: string }>;

export type ApprovalSocketResponse =
	| Readonly<{ ok: true; pending: readonly PendingEnrollmentApprovalSummary[] }>
	| Readonly<{ ok: true; approvalId: string; outcome: 'approved' | 'denied'; deviceName: string }>
	| Readonly<{ ok: false; error: string }>;

export interface ApprovalSocketAuthority {
	listPendingApprovals(): readonly PendingEnrollmentApprovalSummary[];
	approveEnrollment(approvalId: string): Readonly<{ deviceName: string }>;
	denyEnrollment(approvalId: string): Readonly<{ deviceName: string }>;
}

export function approvalSocketPath(dataRoot: string): string {
	return join(dataRoot, APPROVAL_SOCKET_FILENAME);
}

export function parseApprovalSocketRequest(value: unknown): ApprovalSocketRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('approval request is invalid');
	}
	const input = value as Record<string, unknown>;
	if (input.op === 'list') {
		if (Object.keys(input).length !== 1) throw new Error('approval request is invalid');
		return Object.freeze({ op: 'list' });
	}
	if (input.op === 'approve' || input.op === 'deny') {
		if (Object.keys(input).length !== 2 || typeof input.approvalId !== 'string' || !APPROVAL_ID.test(input.approvalId)) {
			throw new Error('approval request is invalid');
		}
		return Object.freeze({ op: input.op, approvalId: input.approvalId });
	}
	throw new Error('approval request is invalid');
}

export function handleApprovalSocketRequest(
	request: ApprovalSocketRequest,
	authority: ApprovalSocketAuthority,
): ApprovalSocketResponse {
	try {
		if (request.op === 'list') return Object.freeze({ ok: true, pending: authority.listPendingApprovals() });
		const resolved =
			request.op === 'approve'
				? authority.approveEnrollment(request.approvalId)
				: authority.denyEnrollment(request.approvalId);
		return Object.freeze({
			ok: true,
			approvalId: request.approvalId,
			outcome: request.op === 'approve' ? 'approved' : 'denied',
			deviceName: resolved.deviceName,
		});
	} catch (error) {
		return Object.freeze({ ok: false, error: error instanceof Error ? error.message : 'approval failed' });
	}
}

export async function startApprovalSocket(options: {
	readonly socketPath: string;
	readonly authority: ApprovalSocketAuthority;
}): Promise<{ close(): Promise<void> }> {
	await mkdir(dirname(options.socketPath), { recursive: true, mode: 0o700 });
	await unlink(options.socketPath).catch(() => undefined);
	const server: Server = createServer((socket) => serve(socket, options.authority));
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(options.socketPath, () => {
			server.off('error', reject);
			resolve();
		});
	});
	await chmod(options.socketPath, 0o600).catch(() => undefined);
	return {
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await unlink(options.socketPath).catch(() => undefined);
		},
	};
}

function serve(socket: Socket, authority: ApprovalSocketAuthority): void {
	let buffered = '';
	let done = false;
	const finish = (response: ApprovalSocketResponse) => {
		if (done) return;
		done = true;
		socket.end(`${JSON.stringify(response)}\n`);
	};
	const timer = setTimeout(() => finish({ ok: false, error: 'approval request timed out' }), REQUEST_TIMEOUT_MS);
	timer.unref?.();
	socket.setEncoding('utf8');
	socket.on('data', (chunk: string) => {
		if (done) return;
		buffered += chunk;
		if (buffered.length > MAX_FRAME_BYTES) {
			clearTimeout(timer);
			finish({ ok: false, error: 'approval request is too large' });
			return;
		}
		const newline = buffered.indexOf('\n');
		if (newline < 0) return;
		clearTimeout(timer);
		let request: ApprovalSocketRequest;
		try {
			request = parseApprovalSocketRequest(JSON.parse(buffered.slice(0, newline)));
		} catch {
			finish({ ok: false, error: 'approval request is invalid' });
			return;
		}
		finish(handleApprovalSocketRequest(request, authority));
	});
	socket.on('error', () => {
		clearTimeout(timer);
		done = true;
	});
}

/** Client side used by the `approve`, `deny`, and `approvals` subcommands. */
export function sendApprovalSocketRequest(
	socketPath: string,
	request: ApprovalSocketRequest,
): Promise<ApprovalSocketResponse> {
	return new Promise((resolve, reject) => {
		let buffered = '';
		let settled = false;
		const socket = createConnection(socketPath);
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.destroy();
			reject(new Error('the running server did not answer the approval request'));
		}, REQUEST_TIMEOUT_MS);
		socket.setEncoding('utf8');
		socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on('data', (chunk: string) => {
			buffered += chunk;
			if (buffered.length > MAX_FRAME_BYTES) {
				socket.destroy();
			}
		});
		socket.on('error', (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new Error(`no running server accepts approvals at this data root (${error.message})`));
		});
		socket.on('close', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				resolve(JSON.parse(buffered.trim()) as ApprovalSocketResponse);
			} catch {
				reject(new Error('the running server returned an invalid approval response'));
			}
		});
	});
}
