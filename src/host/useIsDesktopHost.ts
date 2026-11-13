import { useEffect, useState } from 'react';

/**
 * True once the host bridge says this renderer runs inside Terminay Desktop.
 * Browser hosts, and renderers with no host bridge, stay false.
 */
export function useIsDesktopHost(): boolean {
	const [isDesktop, setIsDesktop] = useState(false);
	useEffect(() => {
		const host = window.terminayHost;
		if (host === undefined) return undefined;
		let cancelled = false;
		void host
			.getContext()
			.then((context) => {
				if (!cancelled) setIsDesktop(context.hostKind === 'desktop');
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);
	return isDesktop;
}
