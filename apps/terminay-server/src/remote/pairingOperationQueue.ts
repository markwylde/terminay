/** Serialize shared pairing-room mutations across hosted and direct modes. */
export function createPairingOperationQueue() {
	let chain = Promise.resolve();
	return Object.freeze({
		run<T>(operation: () => Promise<T>): Promise<T> {
			const next = chain.then(operation, operation);
			chain = next.then(
				() => undefined,
				() => undefined,
			);
			return next;
		},
	});
}

/**
 * Give hosted and direct signaling hosts the same room for each exposure
 * generation. A host rotates only after every exposure has adopted the prior
 * generation, so duplicate refreshes from one mode cannot skip a room another
 * mode is still registering.
 */
export function createSharedPairingHandoffRotator<T>(options: {
	readonly modes: readonly string[];
	readonly initialHandoff: T;
	readonly rotate: () => T | Promise<T>;
}): (mode: string) => Promise<T> {
	const modes = [...new Set(options.modes)];
	let generation = 0;
	let handoff = options.initialHandoff;
	const seenGeneration = new Map(modes.map((mode) => [mode, 0]));
	const rotations = createPairingOperationQueue();
	return (mode) =>
		rotations.run(async () => {
			if (!seenGeneration.has(mode))
				throw new Error(`unknown pairing exposure mode: ${mode}`);
			if (
				seenGeneration.get(mode) === generation &&
				modes.every((candidate) => seenGeneration.get(candidate) === generation)
			) {
				handoff = await options.rotate();
				generation += 1;
			}
			seenGeneration.set(mode, generation);
			return handoff;
		});
}
