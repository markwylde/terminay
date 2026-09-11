import { resolve } from 'node:path'
import { stageBuiltInExtensions } from './stage-built-in-extensions.mjs'
import { verifyBuiltInExtensionArtifacts } from './verify-built-in-extension-artifacts.mjs'

/**
 * Materialize the exact immutable built-in tree used by development Electron
 * before Vite can launch it. `stageBuiltInExtensions` publishes through an
 * atomic rename; verification then re-reads the finished tree.  This keeps a
 * source checkout from silently reusing an old or absent `build/` directory.
 */
export async function prepareDevelopmentBuiltInExtensions(options = {}) {
	const root = resolve(options.root ?? new URL('..', import.meta.url).pathname)
	const outputDirectory = resolve(root, options.outputDirectory ?? 'build/built-in-extensions')
	const staged = await stageBuiltInExtensions({
		root,
		outputDirectory,
		// Package compilation is performed by staging.  Provider unit suites are
		// deliberately run by the normal test commands rather than every Vite
		// restart, which keeps a source edit/restart responsive.
		skipChecks: true,
	})
	const verified = await verifyBuiltInExtensionArtifacts(outputDirectory)
	if (verified.length !== 6 || staged.inventory.artifacts.length !== 6) {
		throw new Error('development built-in extension inventory is incomplete')
	}
	return Object.freeze({ outputDirectory, artifacts: verified })
}
