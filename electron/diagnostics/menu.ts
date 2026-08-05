import { dialog, type MenuItemConstructorOptions, shell } from 'electron';

export interface DiagnosticsHelpMenuOptions {
	/** Canonical directory returned by Electron's application logs path. */
	directory: string;
	/** Rotate the active segment and remove only managed diagnostics artifacts. */
	clearManagedArtifacts: () => Promise<void>;
	/** Record diagnostics.cleared after the previous history has been removed. */
	recordCleared: () => Promise<void>;
	/** Keep menu failures contained when the diagnostic writer itself is degraded. */
	reportFailure?: (operation: 'reveal' | 'clear', error: unknown) => void;
}

export interface DiagnosticsMenuNativeDependencies {
	openPath: (path: string) => Promise<string>;
	confirmClear: () => Promise<boolean>;
}

const nativeDependencies: DiagnosticsMenuNativeDependencies = {
	openPath: (path) => shell.openPath(path),
	confirmClear: async () => {
		const result = await dialog.showMessageBox({
			type: 'warning',
			buttons: ['Clear Diagnostics', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
			noLink: true,
			title: 'Clear Diagnostics?',
			message: 'Clear diagnostics from this device?',
			detail:
				'This removes Terminay diagnostic logs and local crash reports. Unrecognized files in the Diagnostics folder are preserved.',
		});
		return result.response === 0;
	},
};

function reportMenuFailure(
	options: DiagnosticsHelpMenuOptions,
	operation: 'reveal' | 'clear',
	error: unknown,
): void {
	if (options.reportFailure) {
		options.reportFailure(operation, error);
		return;
	}
	// The menu remains usable when the workspace and local server are unhealthy.
	// Do not let a native-shell or writer failure become an unhandled rejection.
	console.error(`[diagnostics] ${operation} action failed`, error);
}

export async function revealDiagnosticsFolder(
	directory: string,
	dependencies: DiagnosticsMenuNativeDependencies = nativeDependencies,
): Promise<void> {
	const errorMessage = await dependencies.openPath(directory);
	if (errorMessage.length > 0) {
		throw new Error(`could not reveal the Diagnostics folder: ${errorMessage}`);
	}
}

export async function clearDiagnosticsWithConfirmation(
	options: DiagnosticsHelpMenuOptions,
	dependencies: DiagnosticsMenuNativeDependencies = nativeDependencies,
): Promise<boolean> {
	if (!(await dependencies.confirmClear())) return false;
	await options.clearManagedArtifacts();
	await options.recordCleared();
	return true;
}

/** Desktop-owned Help items; no renderer, server, IPC, or BrowserWindow is needed. */
export function createDiagnosticsHelpMenuItems(
	options: DiagnosticsHelpMenuOptions,
	dependencies: DiagnosticsMenuNativeDependencies = nativeDependencies,
): MenuItemConstructorOptions[] {
	return [
		{
			label: 'Reveal Diagnostics Folder',
			click: () => {
				void revealDiagnosticsFolder(options.directory, dependencies).catch(
					(error) => reportMenuFailure(options, 'reveal', error),
				);
			},
		},
		{
			label: 'Clear Diagnostics…',
			click: () => {
				void clearDiagnosticsWithConfirmation(options, dependencies).catch(
					(error) => reportMenuFailure(options, 'clear', error),
				);
			},
		},
	];
}
