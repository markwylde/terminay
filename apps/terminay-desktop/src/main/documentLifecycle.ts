export type DesktopDocumentReleaseReason =
	| 'failed-launch'
	| 'reload'
	| 'server-switch'
	| 'superseded'
	| 'window-close'
	| 'application-quit';

export interface DesktopDocumentLifecycleDiagnostic {
	readonly event: 'document-release-failed';
	readonly reason: DesktopDocumentReleaseReason;
	readonly resource: string;
	readonly message: string;
}

export type DesktopDocumentRelease = () => Promise<void> | void;

/** The only capability a document lifecycle needs from an application
 * transport. Keeping this structural prevents the native document boundary
 * from acquiring protocol ownership. */
export interface DesktopDocumentTransport {
	close(options: { readonly code: 'normal' }): Promise<void> | void;
}

const MAX_DIAGNOSTIC_MESSAGE = 320;

/** Owns resources belonging to one renderer document, never its server-side
 * workspace or terminal authority. Release is deliberately synchronous at the
 * boundary: asynchronous cleanup is observed and contained without allowing an
 * Electron lifecycle callback to create an unhandled rejection. */
export class DesktopDocumentLifecycle {
	private readonly resources = new Map<string, DesktopDocumentRelease>();
	private released = false;

	constructor(
		private readonly diagnostic?: (
			event: DesktopDocumentLifecycleDiagnostic,
		) => void,
	) {}

	add(resource: string, release: DesktopDocumentRelease): void {
		if (this.released) {
			this.observe(resource, 'superseded', release);
			return;
		}
		if (this.resources.has(resource))
			throw new Error(`document resource is already registered: ${resource}`);
		this.resources.set(resource, release);
	}

	release(reason: DesktopDocumentReleaseReason): boolean {
		if (this.released) return false;
		this.released = true;
		const resources = [...this.resources];
		this.resources.clear();
		for (const [resource, release] of resources.reverse())
			this.observe(resource, reason, release);
		return true;
	}

	get active(): boolean {
		return !this.released;
	}

	private observe(
		resource: string,
		reason: DesktopDocumentReleaseReason,
		release: DesktopDocumentRelease,
	): void {
		try {
			const result = release();
			if (result !== undefined)
				void Promise.resolve(result).catch((error) =>
					this.report(resource, reason, error),
				);
		} catch (error) {
			this.report(resource, reason, error);
		}
	}

	private report(
		resource: string,
		reason: DesktopDocumentReleaseReason,
		error: unknown,
	): void {
		if (this.diagnostic === undefined) return;
		const category = error instanceof Error ? error.name : typeof error;
		const message = `Document cleanup failed (${category || 'unknown'}).`.slice(
			0,
			MAX_DIAGNOSTIC_MESSAGE,
		);
		try {
			this.diagnostic(
				Object.freeze({
					event: 'document-release-failed',
					reason,
					resource,
					message,
				}),
			);
		} catch {
			/* Diagnostics must never break native teardown. */
		}
	}
}

/**
 * Close a document-scoped application lane without allowing either a
 * synchronous implementation failure or an asynchronously rejected close to
 * escape an Electron destruction callback. Transport implementations are not
 * required to make close idempotent, so callers still own their one-shot
 * boundary; this helper makes each attempted close exception-free.
 */
export async function closeDesktopDocumentTransport(
	transport: DesktopDocumentTransport,
	onFailure?: (message: string) => void,
): Promise<boolean> {
	try {
		await transport.close({ code: 'normal' });
		return true;
	} catch (error) {
		try {
			onFailure?.(boundedTransportDiagnostic(error));
		} catch {
			// A diagnostic sink is not allowed to turn native teardown into a crash.
		}
		return false;
	}
}

function boundedTransportDiagnostic(error: unknown): string {
	const category = error instanceof Error ? error.name : typeof error;
	return `Document transport close failed (${category || 'unknown'}).`.slice(
		0,
		MAX_DIAGNOSTIC_MESSAGE,
	);
}

/** Complete a renderer document handoff without allowing a destruction race to
 * escape into Electron's main event loop. Ownership transfers only after both
 * the authority and renderer accept their respective endpoints. */
export function handoffDocumentResource(options: {
	readonly acceptAuthority: () => void;
	readonly sendRenderer: () => void;
	readonly release: () => void;
	readonly onFailure?: (message: string) => void;
}): boolean {
	try {
		options.acceptAuthority();
		options.sendRenderer();
		return true;
	} catch (error) {
		try {
			options.release();
		} catch {
			// The original handoff failure remains authoritative. Cleanup failures
			// are deliberately contained at this native boundary.
		}
		try {
			options.onFailure?.(boundedDiagnostic(error));
		} catch {
			// Diagnostics must never turn a renderer destruction race into a crash.
		}
		return false;
	}
}

function boundedDiagnostic(error: unknown): string {
	const category = error instanceof Error ? error.name : typeof error;
	return `Renderer document handoff failed (${category || 'unknown'}).`.slice(
		0,
		320,
	);
}
