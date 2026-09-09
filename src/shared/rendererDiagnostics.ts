export type RendererDiagnostic =
	| {
			readonly kind: 'bootstrap';
			readonly phase: string;
			readonly count?: number;
	  }
	| {
			readonly kind: 'terminal-recovery';
			readonly phase: 'started' | 'retrying' | 'recovered' | 'failed';
			readonly attempt: number;
			readonly durationMs?: number;
			readonly reason?: 'congestion' | 'attachment_closed' | 'hydration' | 'attach-error' | 'deadline';
	  }
	| {
			/** The server refused to resume a display from the position it last
			 * rendered. A resume is routed into recovery for a fresh presentation;
			 * a fresh presentation that is itself refused becomes a retryable error. */
			readonly kind: 'terminal-presentation-refused';
			readonly attach: 'resume' | 'fresh';
			readonly requestedFromPosition: number;
			readonly replayFrom: number;
			readonly outputPosition: number;
	  };

type RendererDiagnosticObserver = (
	diagnostic: Readonly<RendererDiagnostic>,
) => void;

function observer(): RendererDiagnosticObserver | undefined {
	const candidate = (
		globalThis as {
			__terminayRendererDiagnostic?: unknown;
		}
	).__terminayRendererDiagnostic;
	return typeof candidate === 'function'
		? (candidate as RendererDiagnosticObserver)
		: undefined;
}

/**
 * Observation-only renderer diagnostics. The callback is deliberately not a
 * Desktop preload capability: it is a bounded test/support observer and can
 * neither invoke privileged work nor affect the selected server.
 */
export function recordRendererDiagnostic(diagnostic: RendererDiagnostic): void {
	const sink = observer();
	if (sink === undefined) return;
	try {
		sink(Object.freeze({ ...diagnostic }));
	} catch {
		// Diagnostic observers cannot change workspace or recovery behaviour.
	}
}

export function hasRendererDiagnosticObserver(): boolean {
	return observer() !== undefined;
}

export function recordBootstrapDiagnostic(phase: string, count?: number): void {
	if (phase.length === 0 || phase.length > 128) return;
	recordRendererDiagnostic({
		kind: 'bootstrap',
		phase,
		...(Number.isSafeInteger(count) && (count ?? 0) >= 0 ? { count } : {}),
	});
}
