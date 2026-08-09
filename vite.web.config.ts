import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	base: '/',
	plugins: [react()],
	build: {
		outDir: 'dist-web',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				legacy: path.resolve(__dirname, 'legacy.html'),
				web: path.resolve(__dirname, 'web.html'),
			},
		},
	},
});
