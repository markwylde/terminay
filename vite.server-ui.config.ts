import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	base: '/',
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
