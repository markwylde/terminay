/** The workspace UI runs no language service in the client. Monaco's
 * TypeScript, CSS, HTML, and JSON language workers and their modes exist only
 * when something imports `vs/language/*`; this guard turns an accidental
 * import into a build failure instead of a 9 MB regression. */
const CLIENT_LANGUAGE_WORKER_PATTERN =
	/(?:^|\/)(?:ts|css|html|json)\.worker-[^/]*\.js$|(?:^|\/)(?:ts|css|html|json)Mode-[^/]*\.js$/u;

/** Returns every emitted file name that is a client language worker or mode. */
export function findClientLanguageWorkerChunks(fileNames) {
	return [...fileNames]
		.filter((name) => typeof name === 'string')
		.filter((name) => CLIENT_LANGUAGE_WORKER_PATTERN.test(name))
		.sort();
}

/** Throws when the emitted server UI carries a client language worker. */
export function assertNoClientLanguageWorkers(fileNames) {
	const offending = findClientLanguageWorkerChunks(fileNames);
	if (offending.length === 0) return;
	throw new Error(
		`The workspace UI bundle must not carry a client language worker or language mode; found ${offending.join(', ')}. Import Monaco through src/components/file-viewer/monacoRuntime.ts, never from vs/language/*.`,
	);
}
