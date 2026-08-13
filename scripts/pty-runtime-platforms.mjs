export const PTY_RUNTIME_NODE_VERSION = '24.15.0';
export const PTY_RUNTIME_NODE_PTY_VERSION = '1.1.0';

export const PTY_RUNTIME_PLATFORMS = Object.freeze({
	'linux-arm64': Object.freeze({
		architecture: 'arm64',
		elfMachine: 183,
		nodeArchive:
			'https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-arm64.tar.xz',
		nodeArchiveSha256:
			'f3d5a797b5d210ce8e2cb265544c8e482eaedcb8aa409a8b46da7e8595d0dda0',
		spawnHelperRequired: false,
	}),
	'linux-x64': Object.freeze({
		architecture: 'x64',
		elfMachine: 62,
		nodeArchive:
			'https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz',
		nodeArchiveSha256:
			'472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6',
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
