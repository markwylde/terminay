import path from 'node:path';

export interface DesktopUserDataNamespaceInput {
	readonly appDataPath: string;
	readonly customPath?: string;
	/**
	 * A source build can be packaged by Electron Builder for smoke testing. It is
	 * still development software and must not take ownership of the installed
	 * release profile merely because Electron reports `isPackaged`.
	 */
	readonly isDevelopmentBuild?: boolean;
	readonly isPackaged: boolean;
}

/**
 * Keep source-development authority and persistence separate from an installed
 * Terminay release. An explicit path remains the escape hatch for isolated
 * tests and intentional migration tooling.
 */
export function resolveDesktopUserDataPath(
	input: DesktopUserDataNamespaceInput,
): string | undefined {
	const customPath = input.customPath?.trim();
	if (customPath) return path.resolve(customPath);
	if (input.isPackaged && !input.isDevelopmentBuild) return undefined;
	return path.join(input.appDataPath, 'Terminay Development');
}
