import path from 'node:path';

/**
 * Development builds consume workspace source so Vite owns transformation and
 * watching. Release builds intentionally keep resolving each workspace's
 * published dist/ entry points.
 */
export function developmentWorkspaceAliases(repositoryRoot) {
	const source = (...segments) => path.join(repositoryRoot, ...segments);
	return [
		{
			find: '@terminay/ui-bundle/archive',
			replacement: source('packages', 'ui-bundle', 'src', 'archive.ts'),
		},
		{
			find: '@terminay/server-core/remote',
			replacement: source('packages', 'server-core', 'src', 'remote', 'index.ts'),
		},
		{
			find: '@terminay/server-core/ui-bundle',
			replacement: source('packages', 'server-core', 'src', 'uiBundle', 'index.ts'),
		},
		{
			find: '@terminay/protocol',
			replacement: source('packages', 'protocol', 'src', 'index.ts'),
		},
		{
			find: '@terminay/client-core',
			replacement: source('packages', 'client-core', 'src', 'index.ts'),
		},
		{
			find: '@terminay/responsive-ui',
			replacement: source('packages', 'responsive-ui', 'src', 'index.ts'),
		},
		{
			find: '@terminay/extension-api',
			replacement: source('packages', 'extension-api', 'src', 'index.ts'),
		},
		{
			find: '@terminay/ui-bundle',
			replacement: source('packages', 'ui-bundle', 'src', 'index.ts'),
		},
		{
			find: '@terminay/server-core',
			replacement: source('packages', 'server-core', 'src', 'index.ts'),
		},
		{
			find: '@terminay/server',
			replacement: source('apps', 'terminay-server', 'src', 'index.ts'),
		},
		{
			find: '@terminay/web',
			replacement: source('apps', 'terminay-web', 'src', 'index.ts'),
		},
	];
}
