const renderCounts = new Map<string, { count: number; fingerprint: string }>()
let resetQueued = false

/**
 * Test-only fail-closed guard for synchronous React render loops. Production
 * renderers have no diagnostic host, so this adds no counting or scheduling.
 */
export function recordBoundedRendererRender(
	key: string,
	fingerprint: string,
): void {
	if (!hasRendererDiagnosticObserver()) return
	const previous = renderCounts.get(key)
	const next = {
		count: (previous?.count ?? 0) + 1,
		fingerprint,
	}
	renderCounts.set(key, next)
	recordBootstrapDiagnostic(`${key}.render`, next.count)
	if (next.count > 64) {
		throw new Error(
			`Synchronous renderer loop in ${key} after ${next.count} renders (${fingerprint}; previous ${previous?.fingerprint ?? 'none'})`,
		)
	}
	if (!resetQueued) {
		resetQueued = true
		queueMicrotask(() => {
			resetQueued = false
			renderCounts.clear()
		})
	}
}
import { hasRendererDiagnosticObserver, recordBootstrapDiagnostic } from './rendererDiagnostics'
