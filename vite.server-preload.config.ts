import path from 'node:path';
import { defineConfig } from 'vite';
import { developmentWorkspaceAliases } from './scripts/development-workspace-aliases.mjs';

const useDevelopmentWorkspaceSources =
	process.env.TERMINAY_DEVELOPMENT_SOURCE_WORKSPACES === '1';

export default defineConfig({
	resolve: {
		alias: useDevelopmentWorkspaceSources
			? developmentWorkspaceAliases(__dirname)
			: [],
	},
	build: {
		lib: {
			entry: path.resolve(__dirname, 'electron/serverUiPreload.ts'),
			formats: ['cjs'],
			fileName: () => 'serverUiPreload.cjs',
		},
		outDir: 'dist-electron',
		emptyOutDir: false,
		rollupOptions: {
			external: ['electron'],
		},
	},
});
