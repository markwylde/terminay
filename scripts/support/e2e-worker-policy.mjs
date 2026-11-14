// electron-builder can rebuild shared node_modules while packaging. That case
// must own its container; ordinary fixture profiles, ports and renderer copies
// are isolated per worker and can run concurrently.
export function shardWorkerPolicy(lines, requested = 2) {
	if (!Number.isInteger(requested) || requested < 1) throw new Error('workers must be a positive integer');
	const packagesNativeModules = lines.some((line) =>
		/^canonical-runtime-executable-parity\.spec\.ts(?:\s*›|$)/u.test(line),
	);
	return {
		workers: packagesNativeModules ? 1 : requested,
		reason: packagesNativeModules ? 'native packaging requires exclusive access' : 'isolated worker fixtures',
	};
}
