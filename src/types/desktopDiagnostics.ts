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
