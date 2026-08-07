export type DestructiveCloseKind = 'app' | 'project' | 'terminal';

export interface CloseEvent {
	preventDefault(): void;
}

export interface ConfirmableMainWindow {
	isDestroyed(): boolean;
	on(event: 'close', listener: (event: CloseEvent) => void): unknown;
}

export interface CloseConfirmationResult {
	response: number;
}

export interface CloseConfirmationDialogOptions {
	buttons: string[];
	cancelId: number;
	defaultId: number;
	detail: string;
	message: string;
	noLink: boolean;
	type: 'warning';
}

const destructiveLabels: Record<DestructiveCloseKind, string> = {
	app: 'Quit Terminay',
	project: 'Close Project',
	terminal: 'Close Terminal',
};

export function createCloseConfirmationDialog(
	kind: DestructiveCloseKind,
	runningTerminalCount: number,
): CloseConfirmationDialogOptions {
	const terminalLabel =
		runningTerminalCount === 1 ? 'terminal has' : 'terminals have';
	const scope =
		kind === 'terminal'
			? 'This terminal has'
			: `${runningTerminalCount} ${terminalLabel}`;
	return {
		type: 'warning',
		buttons: [destructiveLabels[kind], 'Keep Running'],
		defaultId: 1,
		cancelId: 1,
		noLink: true,
		message: `${scope} a process running`,
		detail: 'Closing it will stop the running process.',
	};
}

/** Protects a primary workspace window only while a non-shell process exists. */
export function bindMainWindowCloseConfirmation(options: {
	window: ConfirmableMainWindow;
	isQuitting: () => boolean;
	getRunningTerminalCount: () => number;
	showConfirmation: (
		window: ConfirmableMainWindow,
		options: CloseConfirmationDialogOptions,
	) => Promise<CloseConfirmationResult>;
	requestQuit: () => void;
	onError?: (error: unknown) => void;
}): void {
	let confirmationPending = false;

	options.window.on('close', (event) => {
		if (options.isQuitting()) return;
		const runningTerminalCount = options.getRunningTerminalCount();
		if (runningTerminalCount === 0) return;

		event.preventDefault();
		if (confirmationPending) return;
		confirmationPending = true;

		void options
			.showConfirmation(
				options.window,
				createCloseConfirmationDialog('app', runningTerminalCount),
			)
			.then(({ response }) => {
				if (response === 0 && !options.window.isDestroyed()) {
					options.requestQuit();
				}
			})
			.catch((error) => options.onError?.(error))
			.finally(() => {
				confirmationPending = false;
			});
	});
}
