import { useEffect, useState } from 'react';

export type ElementSize = {
	width: number;
	height: number;
};

const INITIAL_SIZE: ElementSize = {
	width: 0,
	height: 0,
};

export function useResizeObserver<T extends Element>(target: T | null) {
	const [size, setSize] = useState<ElementSize>(INITIAL_SIZE);

	useEffect(() => {
		if (!target) {
			setSize(INITIAL_SIZE);
			return;
		}

		const updateSize = () => {
			const nextSize = {
				width: target.clientWidth,
				height: target.clientHeight,
			};

			setSize((current) => {
				if (
					current.width === nextSize.width &&
					current.height === nextSize.height
				) {
					return current;
				}

				return nextSize;
			});
		};

		updateSize();

		// Electron can change a BrowserWindow's bounds while a flex descendant's
		// ResizeObserver delivery is deferred. Listen to the owning window too so
		// geometry controllers re-read the element's current client box during the
		// resize transaction rather than retaining pane allocations for the old
		// viewport height.
		const ownerWindow = target.ownerDocument.defaultView;
		ownerWindow?.addEventListener('resize', updateSize);

		const observer =
			typeof ResizeObserver === 'undefined'
				? undefined
				: new ResizeObserver(() => {
						updateSize();
					});

		observer?.observe(target);

		return () => {
			observer?.disconnect();
			ownerWindow?.removeEventListener('resize', updateSize);
		};
	}, [target]);

	return size;
}
