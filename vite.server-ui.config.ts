import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	// The same verified server UI is served from HTTP and loaded from an
	// immutable file-backed cache by packaged Desktop. Relative asset URLs are
	// valid in both locations; `/assets` resolves to file:///assets when packed.
	base: './',
	plugins: [react()],
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
