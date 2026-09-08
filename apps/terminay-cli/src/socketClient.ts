import { sendApprovalRequest } from './socket.js';

/**
 * The one-shot helper `sendAsUser` re-executes under `sudo -u <run-as>`.
 *
 * It exists so a root operator can reach a socket that only the run-as account
 * may open, without the CLI ever loosening the socket's permissions. It writes
 * exactly the server's response to stdout and nothing else.
 */

const [socketPath, encodedRequest] = process.argv.slice(2);

if (socketPath === undefined || encodedRequest === undefined) {
	process.stderr.write('usage: socketClient.js <socket-path> <json-request>\n');
	process.exit(2);
}

try {
	const response = await sendApprovalRequest(
		socketPath,
		JSON.parse(encodedRequest),
	);
	process.stdout.write(`${JSON.stringify(response)}\n`);
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
}
