import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
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
