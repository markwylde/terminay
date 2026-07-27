export type TerminalExitMetadata = {
	exitCode: number;
	signal: number | null;
};

export function normalizeTerminalExit(exit: {
	exitCode?: number | null;
	signal?: number | null;
}): TerminalExitMetadata {
	return {
		exitCode: typeof exit.exitCode === 'number' ? exit.exitCode : 0,
		signal:
			typeof exit.signal === 'number' && exit.signal > 0 ? exit.signal : null,
	};
}
