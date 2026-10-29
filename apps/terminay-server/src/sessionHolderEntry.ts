import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
// The narrow entry, not the package root: a holder loads only what it runs.
import {
	describeNativeModuleLoadFailure,
	reportSessionHolderStartupFailure,
	runSessionHolderProcess,
} from '@terminay/server-core/session-holder';

// The detached session holder (ADR-0035). It is started by a Terminay Server,
// outlives it, and must never need this installation's files again once it is
// running: everything it uses is loaded here, before it holds a session.
// The launch variables are cleared once start-up begins, so a failure is
// reported against the environment the holder was launched with.
const launchEnv = { ...process.env };
const requireFromEntry = createRequire(import.meta.url);

function fail(reason: string): never {
	process.stderr.write(`terminay session holder failed: ${reason}\n`);
	reportSessionHolderStartupFailure(reason, launchEnv);
	process.exit(1);
}

// node-pty is loaded here rather than imported, so a host that cannot load it
// reports why instead of dying before any of this file runs.
let nodePty: Parameters<typeof runSessionHolderProcess>[0];
try {
	nodePty = requireFromEntry('node-pty');
} catch (error) {
	let addons: string[] = [];
	try {
		const root = dirname(requireFromEntry.resolve('node-pty/package.json'));
		addons = ['build/Release/pty.node', 'build/Debug/pty.node']
			.map((addon) => join(root, addon))
			.filter((addon) => existsSync(addon));
	} catch {
		/* the package itself is missing; its error already says so */
	}
	fail(
		`node-pty could not be loaded: ${describeNativeModuleLoadFailure(error, requireFromEntry, addons)}`,
	);
}

runSessionHolderProcess(nodePty, launchEnv).catch((error: unknown) =>
	fail(
		error instanceof Error ? (error.stack ?? error.message) : String(error),
	),
);
