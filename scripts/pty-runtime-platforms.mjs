export const PTY_RUNTIME_NODE_VERSION = '22.23.1';
export const PTY_RUNTIME_NODE_PTY_VERSION = '1.1.0';

export const PTY_RUNTIME_PLATFORMS = Object.freeze({
	'linux-arm64': Object.freeze({
		architecture: 'arm64',
		elfMachine: 183,
		nodeArchive:
			'https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-arm64.tar.xz',
		nodeArchiveSha256:
			'0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1',
		spawnHelperRequired: false,
	}),
	'linux-x64': Object.freeze({
		architecture: 'x64',
		elfMachine: 62,
		nodeArchive:
			'https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz',
		nodeArchiveSha256:
			'9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578',
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
