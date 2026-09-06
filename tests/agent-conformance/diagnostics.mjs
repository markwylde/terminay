/**
 * The extension child module installs handlers that exit the process on any
 * uncaught error or unhandled rejection, exactly as it does in production.
 * Inside a test that would hide the cause behind a bare "test failed", so this
 * module is imported first and reports the reason before those handlers run.
 */
for (const event of ['unhandledRejection', 'uncaughtException']) {
	process.on(event, (reason) => {
		const detail =
			reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
		process.stderr.write(`[agent-conformance] ${event}: ${detail}\n`);
	});
}
