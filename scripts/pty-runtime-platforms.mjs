export const PTY_RUNTIME_NODE_VERSION = '24.14.0';
export const PTY_RUNTIME_NODE_PTY_VERSION = '1.1.0';

export const PTY_RUNTIME_PLATFORMS = Object.freeze({
	'linux-arm64': Object.freeze({
		architecture: 'arm64',
		elfMachine: 183,
		nodeArchive:
			'https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-arm64.tar.xz',
		nodeArchiveSha256:
			'e7adfca03d9173276114a6f2219df1a7d25e1bfd6bbd771d3f839118a2053094',
		spawnHelperRequired: false,
	}),
	'linux-x64': Object.freeze({
		architecture: 'x64',
		elfMachine: 62,
		nodeArchive:
			'https://nodejs.org/dist/v24.14.0/node-v24.14.0-linux-x64.tar.xz',
		nodeArchiveSha256:
			'41cd79bb7877c81605a9e68ec4c91547774f46a40c67a17e34d7179ef11729df',
		spawnHelperRequired: false,
	}),
});

export function getPtyRuntimePlatform(target) {
	const platform = PTY_RUNTIME_PLATFORMS[target];
	if (!platform) {
		throw new Error(
			`Unsupported PTY runtime target ${JSON.stringify(target)}. Expected one of: ${Object.keys(
				PTY_RUNTIME_PLATFORMS,
			).join(', ')}.`,
		);
	}
	return platform;
}
