import { useCallback, useLayoutEffect, useRef } from 'react';

/** Writes a textarea's content height; its CSS `min-height`/`max-height` clamp it. */
export function fitTextarea(element: HTMLTextAreaElement) {
	element.style.height = 'auto';
	// scrollHeight includes wrapped placeholder text. Only the draft should
	// grow the composer; an empty value keeps the CSS minimum.
	if (element.value) element.style.height = `${element.scrollHeight}px`;
}

/**
 * Sizes a textarea to its text whenever `value` changes and whenever its
 * width changes (the text re-wraps). Height-only resizes are ignored, so the
 * height it writes does not feed back into the observer.
 */
export function useFitTextarea(value: string) {
	const element = useRef<HTMLTextAreaElement | null>(null),
		observer = useRef<ResizeObserver | undefined>(undefined);
	const ref = useCallback((next: HTMLTextAreaElement | null) => {
		observer.current?.disconnect();
		observer.current = undefined;
		element.current = next;
		if (!next) return;
		fitTextarea(next);
		if (typeof ResizeObserver === 'undefined') return;
		let width = next.clientWidth;
		observer.current = new ResizeObserver(() => {
			if (next.clientWidth === width) return;
			width = next.clientWidth;
			fitTextarea(next);
		});
		observer.current.observe(next);
	}, []);
	useLayoutEffect(() => {
		if (element.current) fitTextarea(element.current);
	}, [value]);
	return ref;
}
