import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Sends one request on the terminal's own control socket with its own
 * capability, framed as the stdio adapter frames it, so a notification is sent
 * by the same path an agent or a command-line tool uses.
 */
const CONTROL_SCRIPT = `
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
const [op, paramsFile] = process.argv.slice(2);
const params = JSON.parse(readFileSync(paramsFile, 'utf8'));
const socket = connect(process.env.TERMINAY_CONTROL_SOCKET);
let buffer = '';
socket.on('connect', () => {
	socket.write(JSON.stringify({ id: 'n-1', token: process.env.TERMINAY_CONTROL_TOKEN, version: 1, op, params }) + '\\n');
});
socket.on('data', (chunk) => {
	buffer += chunk;
	const end = buffer.indexOf('\\n');
	if (end < 0) return;
	const response = JSON.parse(buffer.slice(0, end));
	console.log(['RESULT', op, response.ok ? 'ok' : response.error.code].join(' '));
	socket.end();
});
socket.on('error', (error) => { console.error(error.message); process.exit(2); });
`

/** The shell command that sends one notification from the terminal it runs in. */
export async function sendNotificationCommand(
  userDataDir: string,
  params: { title?: string; body: string },
): Promise<string> {
  const script = path.join(userDataDir, 'send-notification-e2e.mjs')
  const paramsFile = path.join(userDataDir, 'send-notification-params.json')
  await writeFile(script, CONTROL_SCRIPT)
  await writeFile(paramsFile, JSON.stringify(params))
  return `'${process.execPath}' '${script}' send_notification '${paramsFile}'`
}
