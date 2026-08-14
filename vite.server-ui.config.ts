import path from 'node:path';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { buildUiBundleManifest } from './scripts/build-ui-bundle-manifest.mjs';

const packageVersion = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;

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
			writeBundle() {
				manifestPublication = manifestPublication.then(async () => {
					await buildUiBundleManifest({
						rootDirectory: 'dist-web',
						serverVersion: packageVersion,
						protocolVersion: '1',
						entryFile: 'server.html',
					});
				});
				return manifestPublication;
			},
		},
	],
	build: {
		outDir: 'dist-web',
		emptyOutDir: false,
		rollupOptions: {
			input: {
				server: path.resolve(__dirname, 'server.html'),
			},
		},
	},
});
