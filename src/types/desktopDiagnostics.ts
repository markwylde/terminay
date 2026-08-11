export type RendererRootDiagnosticPhase = 'bootstrap-import' | 'react-root';

/**
 * The renderer may report only a root failure's bounded semantic fields. Main
 * remains responsible for validating and sanitizing this untrusted payload
 * before it reaches the Desktop diagnostic log.
 */
export interface RendererRootDiagnosticPayload {
	readonly version: 1;
	readonly phase: RendererRootDiagnosticPhase;
	readonly name: string;
	readonly message: string;
	readonly stack?: string;
	readonly componentStack?: string;
}

export type TerminalRecoveryDiagnosticPhase =
	| 'started'
	| 'retrying'
	| 'recovered'
	| 'failed';

/** Metadata-only terminal recovery progress. Identities and terminal bytes are
 * deliberately absent so the Desktop log cannot become terminal history. */
export interface TerminalRecoveryDiagnosticPayload {
	readonly version: 1;
	readonly phase: TerminalRecoveryDiagnosticPhase;
	readonly attempt: number;
	readonly durationMs?: number;
	readonly fromPosition?: number;
	readonly replayFrom?: number;
	readonly outputPosition?: number;
	readonly reason?: 'congestion' | 'attach-error' | 'deadline';
}
