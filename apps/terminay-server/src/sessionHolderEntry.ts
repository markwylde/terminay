// The narrow entry, not the package root: a holder loads only what it runs.
import { runSessionHolderProcess } from '@terminay/server-core/session-holder';
import * as nodePty from 'node-pty';

// The detached session holder (ADR-0035). It is started by a Terminay Server,
// outlives it, and must never need this installation's files again once it is
// running: everything it uses is loaded here, before it holds a session.
runSessionHolderProcess(
	nodePty as unknown as Parameters<typeof runSessionHolderProcess>[0],
).catch((error: unknown) => {
	process.stderr.write(
		`terminay session holder failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exit(1);
});
