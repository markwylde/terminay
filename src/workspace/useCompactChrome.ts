/**
 * One width observation decides compact chrome.
 *
 * The bar already measures itself to fit project tabs; the compact decision
 * reads that same element rather than a media query on a different axis. A CSS
 * breakpoint and a JS measurement that can disagree produce a row that thinks
 * it is wide inside a window that is not — so there is one source, and every
 * surface that changes at phone width is handed its answer.
 */

import { type RefObject, useEffect, useState } from 'react';
import { isProjectTabBarCompact } from './projectTabOverflow.ts';

export function useCompactChrome(
	barRef: RefObject<HTMLElement | null>,
): boolean {
	const [isCompact, setIsCompact] = useState(false);
	useEffect(() => {
		const element = barRef.current;
		if (!element) return;
		const measure = () => {
			setIsCompact(isProjectTabBarCompact(element.clientWidth));
		};
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		measure();
		return () => observer.disconnect();
	}, [barRef]);
	return isCompact;
}
