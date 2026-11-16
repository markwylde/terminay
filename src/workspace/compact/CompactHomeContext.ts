/**
 * Whether Home is on a compact workspace. `App.tsx` measures compact chrome
 * once; `HomeWorkspace` provides it here, and each Home section reads it to
 * choose between its wide page and its compact section page.
 */

import { createContext, useContext } from 'react';

export const CompactHomeContext = createContext(false);

export function useCompactHome(): boolean {
	return useContext(CompactHomeContext);
}

/**
 * Raised by `App.tsx` whenever the compact switcher, the Command Bar, or a
 * header menu opens. A section page closes its View options sheet when it
 * changes, so at most one compact drawer is open (ADR-0125).
 */
export const CompactDrawerEpochContext = createContext(0);

export function useCompactDrawerEpoch(): number {
	return useContext(CompactDrawerEpochContext);
}
