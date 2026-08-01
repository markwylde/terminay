export function getOrCreateDirectoryLoad(
	loads: Map<string, Promise<void>>,
	path: string,
	create: () => Promise<void>,
): Promise<void> {
	const existing = loads.get(path);
	if (existing !== undefined) return existing;
	const request = create();
	loads.set(path, request);
	void request.finally(() => {
		if (loads.get(path) === request) loads.delete(path);
	});
	return request;
}
