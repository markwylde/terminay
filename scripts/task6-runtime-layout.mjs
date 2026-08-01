import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

/**
 * The three artifact shapes currently produced or consumed by the project.
 * This is deliberately a packaging contract, not a claim that every native
 * release target has been built or executed.
 */
export const RUNTIME_LAYOUTS = Object.freeze({
	development: Object.freeze({
		cli: 'apps/terminay-server/dist/cli.js',
		server: 'apps/terminay-server/dist/index.js',
		mcp: 'apps/terminay-server/dist/mcpEntry.js',
		ui: 'dist/index.html',
		desktopMcp: 'dist-electron/serverMcpEntry.js',
	}),
	standalone: Object.freeze({
		cli: 'dist/cli.js',
		server: 'dist/index.js',
		mcp: 'dist/mcpEntry.js',
	}),
	desktop: Object.freeze({
		ui: 'resources/app.asar/dist/index.html',
		desktopMcp: 'resources/app.asar.unpacked/dist-electron/serverMcpEntry.js',
	}),
});

function layoutOrThrow(layout) {
	const paths = RUNTIME_LAYOUTS[layout];
	if (paths === undefined)
		throw new TypeError(`unknown runtime layout: ${layout}`);
	return paths;
}

function safeRelativePath(path) {
	if (isAbsolute(path) || path.includes('\\'))
		throw new TypeError(`unsafe artifact path: ${path}`);
	const parts = path.split('/');
	if (
		parts.length === 0 ||
		parts.some((part) => part.length === 0 || part === '..')
	) {
		throw new TypeError(`unsafe artifact path: ${path}`);
	}
	return path;
}

/** Resolve every named entrypoint in a known artifact layout. */
export function resolveRuntimeLayout(root, layout) {
	const rootDirectory = resolve(root);
	const paths = layoutOrThrow(layout);
	return Object.fromEntries(
		Object.entries(paths).map(([name, path]) => [
			name,
			join(rootDirectory, safeRelativePath(path)),
		]),
	);
}

/**
 * Verify that a layout contains only regular files at its declared paths.
 * Returned evidence is stable across runs: it contains relative paths and
 * byte sizes, never host-specific absolute paths or timestamps.
 */
export async function inspectRuntimeLayout(root, layout) {
	const rootDirectory = resolve(root);
	const resolved = resolveRuntimeLayout(rootDirectory, layout);
	const files = [];
	for (const [name, path] of Object.entries(resolved)) {
		const info = await lstat(path).catch(() => undefined);
		if (info === undefined || !info.isFile()) {
			throw new Error(
				`runtime layout ${layout} is missing a regular file: ${RUNTIME_LAYOUTS[layout][name]}`,
			);
		}
		const relativePath = relative(rootDirectory, path).replaceAll('\\', '/');
		if (relativePath.startsWith('../') || relativePath === '..') {
			throw new Error(
				`runtime layout ${layout} escapes its root: ${relativePath}`,
			);
		}
		files.push({ name, path: relativePath, size: info.size });
	}
	return { layout, files };
}

/** Check the repository metadata that makes the contract buildable. */
export async function inspectRuntimeLayoutMetadata(root) {
	const rootDirectory = resolve(root);
	const packageJson = JSON.parse(
		await readFile(join(rootDirectory, 'package.json'), 'utf8'),
	);
	const serverPackage = JSON.parse(
		await readFile(
			join(rootDirectory, 'apps/terminay-server/package.json'),
			'utf8',
		),
	);
	const builder = await readFile(
		join(rootDirectory, 'electron-builder.json5'),
		'utf8',
	);

	if (!packageJson.scripts?.['build:app']?.includes('@terminay/server')) {
		throw new Error(
			'build:app must build the standalone server workspace before the renderer',
		);
	}
	if (
		!Array.isArray(serverPackage.files) ||
		!serverPackage.files.includes('dist')
	) {
		throw new Error(
			'standalone server package must publish its dist directory',
		);
	}
	if (
		serverPackage.bin?.['terminay-server'] !== 'dist/cli.js' ||
		serverPackage.bin?.['terminay-mcp'] !== 'dist/mcpEntry.js'
	) {
		throw new Error(
			'standalone server package bin entries do not match the runtime layout',
		);
	}
	if (!/"files"\s*:\s*\[\s*"dist"\s*,\s*"dist-electron"\s*\]/u.test(builder)) {
		throw new Error(
			'Desktop packaging must include the renderer and electron runtime directories',
		);
	}
	if (!/"asarUnpack"\s*:\s*\[\s*"dist-electron\/\*\*"\s*\]/u.test(builder)) {
		throw new Error(
			'Desktop packaging must unpack dist-electron runtime entries',
		);
	}
	return Object.freeze({
		buildsServerWorkspace: true,
		standaloneDist: true,
		serverBin: serverPackage.bin['terminay-server'],
		mcpBin: serverPackage.bin['terminay-mcp'],
		desktopUnpacked: 'dist-electron/**',
	});
}

/**
 * Verify the non-executing resolution contract for packaging-sensitive
 * runtime dependencies. This deliberately proves declarations and safe paths,
 * not native packaged execution.
 */
export async function inspectRuntimeDependencyResolution(root) {
	const rootDirectory = resolve(root);
	const packageJson = JSON.parse(
		await readFile(join(rootDirectory, 'package.json'), 'utf8'),
	);
	const serverPackage = JSON.parse(
		await readFile(
			join(rootDirectory, 'apps/terminay-server/package.json'),
			'utf8',
		),
	);
	const builder = await readFile(
		join(rootDirectory, 'electron-builder.json5'),
		'utf8',
	);
	const serverCli = await readFile(
		join(rootDirectory, 'apps/terminay-server/src/cli.ts'),
		'utf8',
	);
	const serverMcpCompatibility = await readFile(
		join(rootDirectory, 'apps/terminay-server/src/mcp/compatibility.ts'),
		'utf8',
	);
	const providerCli = await readFile(
		join(rootDirectory, 'packages/server-core/src/aiService/cliProvider.ts'),
		'utf8',
	);
	const managedHooks = await readFile(
		join(rootDirectory, 'packages/server-core/src/activity/managedHooks.ts'),
		'utf8',
	);

	if (packageJson.dependencies?.['node-pty'] !== '^1.1.0') {
		throw new Error('Desktop runtime must depend on the pinned node-pty range');
	}
	if (serverPackage.dependencies?.['node-pty'] !== '^1.1.0') {
		throw new Error(
			'standalone server runtime must depend on the pinned node-pty range',
		);
	}
	if (!/import \* as nodePty from ["']node-pty["']/u.test(serverCli)) {
		throw new Error('standalone CLI must resolve node-pty through server-core');
	}
	if (
		!/"asarUnpack"\s*:\s*\[\s*"dist-electron\/\*\*"\s*\]/u.test(builder)
	) {
		throw new Error(
			'Desktop packaging must unpack dist-electron runtime assets',
		);
	}
	if (
		!/artifact:\s*["']dist\/mcpEntry\.js["']/u.test(
			serverMcpCompatibility,
		) ||
		!/command:\s*["']terminay-mcp["']/u.test(serverMcpCompatibility) ||
		!/electronDependency:\s*false/u.test(serverMcpCompatibility) ||
		!/TERMINAY_CONTROL_SOCKET/u.test(serverMcpCompatibility) ||
		!/TERMINAY_CONTROL_TOKEN/u.test(serverMcpCompatibility)
	) {
		throw new Error(
			'server MCP metadata must name the standalone entry, command, and inherited control environment',
		);
	}
	if (
		!/TERMINAY_CODEX_COMMAND\?\.trim\(\) \|\| ['"]codex['"]/u.test(
			providerCli,
		) ||
		!/TERMINAY_CLAUDE_CODE_COMMAND\?\.trim\(\) \|\| ['"]claude['"]/u.test(
			providerCli,
		)
	) {
		throw new Error(
			'provider CLI commands must resolve from explicit env overrides or PATH defaults',
		);
	}
	if (
		!/const scriptName = `terminay-\$\{provider\}-agent-hook\.sh`/u.test(
			managedHooks,
		) ||
		!/join\(homeDir, "\.terminay", "agent-hooks"\)/u.test(managedHooks) ||
		!/MANAGED_HOOK_MARKER = "TERMINAY_MANAGED_AGENT_HOOK=1"/u.test(
			managedHooks,
		) ||
		!/await fs\.chmod\(path, 0o700\)/u.test(managedHooks) ||
		!/http:\/\/127\.0\.0\.1:\*\|http:\/\/localhost:\*\|http:\/\/\\\[::1\\\]:\*/u.test(
			managedHooks,
		)
	) {
		throw new Error(
			'managed hook scripts must resolve to server-owned hook paths and loopback-only delivery',
		);
	}

	return Object.freeze({
		nodePty: Object.freeze({
			desktopDependency: packageJson.dependencies['node-pty'],
			standaloneDependency: serverPackage.dependencies['node-pty'],
			standaloneImport: 'apps/terminay-server/src/cli.ts',
		}),
		providerCli: Object.freeze({
			codex: 'TERMINAY_CODEX_COMMAND || codex',
			claudeCode: 'TERMINAY_CLAUDE_CODE_COMMAND || claude',
			resolution: 'server PATH/env',
		}),
		hooks: Object.freeze({
			scriptDirectory: '.terminay/agent-hooks',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: provider is a documented runtime placeholder.
			scriptPattern: 'terminay-${provider}-agent-hook.sh',
			mode: '0700',
			delivery: 'loopback-http',
		}),
		mcp: Object.freeze({
			command: 'terminay-mcp',
			standaloneArtifact: 'dist/mcpEntry.js',
			requiredEnvironment: [
				'TERMINAY_CONTROL_SOCKET',
				'TERMINAY_CONTROL_TOKEN',
			],
		}),
		unpackedAssets: Object.freeze({
			desktop: 'dist-electron/**',
			desktopMcp: RUNTIME_LAYOUTS.desktop.desktopMcp,
		}),
	});
}
