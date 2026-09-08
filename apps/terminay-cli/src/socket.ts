import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';

/**
 * The client side of the server's owner-only approval socket.
 *
 * The socket lives inside the data root, which is the trust boundary: it is
 * mode 0600 and owned by the account the server runs as, so being able to open
 * it is the authority. No token crosses it, and nothing it returns carries a
 * host key or a device key.
 *
 * The CLI speaks this protocol itself rather than importing the server,
 * because the published package must not pull a native addon along with it.
 */

const execFileAsync = promisify(execFile);

export const APPROVAL_SOCKET_FILENAME = 'approval.sock';
const MAX_FRAME_BYTES = 4 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export type ApprovalRequest =
	| Readonly<{ op: 'list' }>
	| Readonly<{ op: 'approve'; approvalId: string }>
	| Readonly<{ op: 'deny'; approvalId: string }>
	| Readonly<{ op: 'pairing'; rotate?: boolean }>;

export interface PendingApproval {
	readonly approvalId: string;
	readonly deviceName: string;
	readonly matchCode: string;
	readonly expiresAt: number;
}

export interface PairingHandoff {
	readonly mode: string;
	readonly pairingUrl: string;
	readonly pairingExpiresAt: string;
	readonly serverId: string;
}

export type ApprovalResponse =
	| Readonly<{ ok: true; pending: readonly PendingApproval[] }>
	| Readonly<{ ok: true; approvalId: string; outcome: 'approved' | 'denied'; deviceName: string }>
	| Readonly<{ ok: true; exposure: readonly string[] | 'off'; handoffs: readonly PairingHandoff[] }>
	| Readonly<{ ok: false; error: string }>;

export function approvalSocketPath(dataRoot: string): string {
	return join(dataRoot, APPROVAL_SOCKET_FILENAME);
}

export class SocketError extends Error {}

export function sendApprovalRequest(socketPath: string, request: ApprovalRequest): Promise<ApprovalResponse> {
	return new Promise((resolve, reject) => {
		let buffered = '';
		let settled = false;
		const socket = createConnection(socketPath);
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.destroy();
			reject(new SocketError('the running server did not answer'));
		}, REQUEST_TIMEOUT_MS);
		timer.unref?.();
		socket.setEncoding('utf8');
		socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on('data', (chunk: string) => {
			buffered += chunk;
			if (buffered.length > MAX_FRAME_BYTES) socket.destroy();
		});
		socket.on('error', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(new SocketError('no running server accepts commands at this data root. Start it with `terminay daemon start`.'));
		});
		socket.on('close', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				resolve(JSON.parse(buffered.trim()) as ApprovalResponse);
			} catch {
				reject(new SocketError('the running server returned an unreadable response'));
			}
		});
	});
}

/**
 * The socket is owner-only, so root cannot simply open a socket owned by the
 * run-as account without dropping to it first. Re-executing this one call
 * under `sudo -u` keeps the server's ownership check meaningful instead of
 * relaxing the socket's permissions to work around it.
 */
export async function sendAsUser(
	socketPath: string,
	request: ApprovalRequest,
	runAs: string,
	currentUid: number | undefined = process.getuid?.(),
): Promise<ApprovalResponse> {
	const needsDrop = currentUid === 0 && runAs !== 'root';
	if (!needsDrop) return sendApprovalRequest(socketPath, request);
	const script = new URL('./socketClient.js', import.meta.url).pathname;
	try {
		const { stdout } = await execFileAsync(
			'sudo',
			['-n', '-u', runAs, process.execPath, script, socketPath, JSON.stringify(request)],
			{ timeout: REQUEST_TIMEOUT_MS + 5_000, maxBuffer: MAX_FRAME_BYTES },
		);
		return JSON.parse(stdout.trim()) as ApprovalResponse;
	} catch (error) {
		throw new SocketError(
			`could not reach the server's socket as ${runAs}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export function requireOk(response: ApprovalResponse): Extract<ApprovalResponse, { ok: true }> {
	if (response.ok !== true) throw new SocketError(response.error);
	return response;
}
