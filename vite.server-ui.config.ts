import path from 'node:path';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import {
	buildUiBundleManifest,
	listRegularRelativeFiles,
} from './scripts/build-ui-bundle-manifest.mjs';

const packageVersion = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;
const watching = process.argv.includes('--watch');

let manifestPublication = Promise.resolve();

export default defineConfig({
	// The same verified server UI is served from HTTP and loaded from an
	// immutable file-backed cache by packaged Desktop. Relative asset URLs are
	// valid in both locations; `/assets` resolves to file:///assets when packed.
	base: './',
	plugins: [
		react(),
		{
			name: 'terminay-canonical-ui-manifest',
			apply: 'build',
			writeBundle(_options, bundle) {
				const emitted = Object.values(bundle)
					.map((entry) => entry.fileName)
					.filter((fileName) => typeof fileName === 'string');
				manifestPublication = manifestPublication.then(async () => {
					const copiedPublic = await listRegularRelativeFiles('public');
					await buildUiBundleManifest({
						rootDirectory: 'dist-web',
						serverVersion: packageVersion,
						protocolVersion: '1',
						entryFile: 'server.html',
						includeRelativePaths: [...new Set([...emitted, ...copiedPublic])],
					});
				});
				return manifestPublication;
			},
		},
	],
	build: {
		outDir: 'dist-web',
		// Production empties leftover hashed chunks. Watch keeps the last complete
		// inventory on disk so Electron can finish verifying while a rebuild writes
		// new hashes; the manifest still lists only this emission.
		emptyOutDir: !watching,
		rollupOptions: {
			input: {
				server: path.resolve(__dirname, 'server.html'),
			},
		},
	},
});
