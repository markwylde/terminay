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
	| Readonly<{
			ok: true;
			approvalId: string;
			outcome: 'approved' | 'denied';
			deviceName: string;
	  }>
	| Readonly<{
			ok: true;
			exposure: readonly string[] | 'off';
			handoffs: readonly PairingHandoff[];
	  }>
	| Readonly<{ ok: false; error: string }>;

export function approvalSocketPath(dataRoot: string): string {
	return join(dataRoot, APPROVAL_SOCKET_FILENAME);
}

export class SocketError extends Error {}

const NO_SERVER_MESSAGE =
	'no running server accepts commands at this data root. Start it with `terminay daemon start`.';

/**
 * Name the failures of the privilege drop that an operator can fix themselves:
 * no `sudo` to drop with, or a Node.js binary the service account cannot
 * execute (one installed under root's home). Anything else is left to the
 * caller's generic message, so an unrelated permission error is not
 * misattributed.
 */
export function explainPrivilegeLaunchError(
	error: unknown,
	nodePath: string = process.execPath,
): string | undefined {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'object' && error !== null && 'message' in error
				? String(error.message)
				: String(error ?? '');
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code?: unknown }).code)
			: '';
	if (code === 'ENOENT')
		return 'sudo is required to contact the system server approval socket but is not installed. Install sudo, or run the pairing command as the server service account.';
	if (
		message.includes(nodePath) &&
		/permission denied|command not found|EACCES|EPERM/iu.test(message)
	)
		return `the service account cannot run Node.js at ${nodePath}. Install Node.js system-wide (not under a home directory), then retry.`;
	return undefined;
}

export function sendApprovalRequest(
	socketPath: string,
	request: ApprovalRequest,
): Promise<ApprovalResponse> {
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
			reject(
				new SocketError(NO_SERVER_MESSAGE),
			);
		});
		socket.on('close', () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				resolve(JSON.parse(buffered.trim()) as ApprovalResponse);
			} catch {
				reject(
					new SocketError('the running server returned an unreadable response'),
				);
			}
		});
	});
}

/**
 * The request, as a program small enough to hand to `node -e`.
 *
 * It is passed as source rather than as a script path because the account it
 * runs as may not be able to read this package at all: `sudo npx terminay`
 * unpacks the CLI under root's home, which a dedicated service account cannot
 * enter. It prints exactly the server's response and nothing else.
 */
export const SOCKET_CLIENT_SOURCE = [
	"const net = require('node:net');",
	'const [socketPath, request] = process.argv.slice(1);',
	"const fail = (message) => { process.stderr.write(message + '\\n'); process.exit(1); };",
	"let buffered = '';",
	'const socket = net.createConnection(socketPath);',
	`const timer = setTimeout(() => { socket.destroy(); fail('the running server did not answer'); }, ${REQUEST_TIMEOUT_MS});`,
	"socket.setEncoding('utf8');",
	"socket.on('connect', () => socket.write(request + '\\n'));",
	`socket.on('data', (chunk) => { buffered += chunk; if (buffered.length > ${MAX_FRAME_BYTES}) socket.destroy(); });`,
	`socket.on('error', () => fail(${JSON.stringify(NO_SERVER_MESSAGE)}));`,
	"socket.on('close', () => { clearTimeout(timer); process.stdout.write(buffered.trim() + '\\n'); });",
].join('\n');

type ExecFile = (
	file: string,
	args: readonly string[],
	options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

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
	exec: ExecFile = execFileAsync,
): Promise<ApprovalResponse> {
	const needsDrop = currentUid === 0 && runAs !== 'root';
	if (!needsDrop) return sendApprovalRequest(socketPath, request);
	let stdout: string;
	try {
		({ stdout } = await exec(
			'sudo',
			[
				'-n',
				'-u',
				runAs,
				process.execPath,
				'-e',
				SOCKET_CLIENT_SOURCE,
				socketPath,
				JSON.stringify(request),
			],
			{ timeout: REQUEST_TIMEOUT_MS + 5_000, maxBuffer: MAX_FRAME_BYTES },
		));
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		if (detail.includes(NO_SERVER_MESSAGE))
			throw new SocketError(NO_SERVER_MESSAGE);
		const hint = explainPrivilegeLaunchError(error);
		throw new SocketError(
			hint === undefined
				? `could not reach the server's socket as ${runAs}: ${lastLine(detail)}`
				: `${hint} (${lastLine(detail)})`,
		);
	}
	try {
		return JSON.parse(stdout.trim()) as ApprovalResponse;
	} catch {
		throw new SocketError('the running server returned an unreadable response');
	}
}

/** `execFile` puts the command line first and the child's stderr after it;
 * the last line is the part that says what went wrong. */
function lastLine(text: string): string {
	return text.trim().split('\n').at(-1)?.trim() ?? '';
}

export function requireOk(
	response: ApprovalResponse,
): Extract<ApprovalResponse, { ok: true }> {
	if (response.ok !== true) throw new SocketError(response.error);
	return response;
}
