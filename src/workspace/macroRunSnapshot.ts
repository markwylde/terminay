import type { MacroRunSnapshot } from '@terminay/client-core';
import type { TerminalTabMacroRunStep } from '../components/TerminalTab';

/**
 * The launch response and run events travel on different paths, so which
 * arrives first says nothing about which is newer. A finished run is newer
 * than a running one; otherwise the further step is.
 */
export function furtherAlong(
	held: MacroRunSnapshot | undefined,
	next: MacroRunSnapshot,
): MacroRunSnapshot {
	if (held === undefined) return next;
	if (held.status !== 'running') return held;
	if (next.status !== 'running') return next;
	return held.stepIndex > next.stepIndex ? held : next;
}

/** A step's status in the macro queue, as the server's snapshot places it. */
export function stepStatusForSnapshot(
	snapshot: Pick<MacroRunSnapshot, 'status' | 'stepIndex'>,
	index: number,
): TerminalTabMacroRunStep['status'] {
	if (snapshot.status === 'canceled' && index >= snapshot.stepIndex)
		return 'canceled';
	if (snapshot.status === 'failed' && index === snapshot.stepIndex)
		return 'failed';
	if (index < snapshot.stepIndex || snapshot.status === 'completed')
		return 'completed';
	return index === snapshot.stepIndex ? 'running' : 'pending';
}
