import path from 'node:path';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import {
	buildUiBundleManifest,
	listRegularRelativeFiles,
} from './scripts/build-ui-bundle-manifest.mjs';
import { developmentWorkspaceAliases } from './scripts/development-workspace-aliases.mjs';

const packageVersion = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).version as string;
const watching =
	process.argv.includes('--watch') ||
	process.env.TERMINAY_SERVER_UI_WATCH === '1';
const useDevelopmentWorkspaceSources =
	process.env.TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES === '1';

let manifestPublication = Promise.resolve();

export default defineConfig({
	// A watch rebuild may emit hundreds of Monaco language chunks. The runner
	// reports readiness itself; retain warnings/errors without burying it.
	logLevel: watching ? 'warn' : 'info',
	// The same verified server UI is served from HTTP and loaded from an
	// immutable file-backed cache by packaged Desktop. Relative asset URLs are
	// valid in both locations; `/assets` resolves to file:///assets when packed.
	base: './',
	resolve: {
		alias: useDevelopmentWorkspaceSources
			? developmentWorkspaceAliases(__dirname)
			: [],
	},
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
		reportCompressedSize: !watching,
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
