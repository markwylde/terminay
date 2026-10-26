// Desktop presents a fixed set of management windows. Settings is the one
// management surface; Performance Log is a diagnostic view. Any other kind,
// including a feature that once had a window of its own, is refused like an
// unknown route.

export const AUXILIARY_TITLES: Readonly<Record<string, string>> = Object.freeze({
	'performance-log': 'Performance Log',
	settings: 'Settings',
});

export type AuxiliaryRoutePresentation = Readonly<{
	disposition?: string;
	logicalViewId?: string;
	route: string;
}>;

/** Validates a native auxiliary route request and returns its canonical form. */
export function canonicalAuxiliaryRequest(
	action: AuxiliaryRoutePresentation,
): Readonly<{ logicalViewId: string; route: string; title: string }> {
	if (
		action.disposition !== 'native-window' ||
		action.logicalViewId === undefined
	) {
		throw new Error(
			'Desktop auxiliary routes require a logical native-window identity.',
		);
	}
	const requested = new URL(action.route, 'https://terminay.invalid');
	const kind = requested.searchParams.get('auxiliary');
	if (
		requested.pathname !== '/' ||
		kind === null ||
		!Object.hasOwn(AUXILIARY_TITLES, kind) ||
		action.logicalViewId !== kind
	) {
		throw new Error('The requested Desktop auxiliary route is unavailable.');
	}
	return Object.freeze({
		logicalViewId: action.logicalViewId,
		route: `${requested.pathname}${requested.search}`,
		title: AUXILIARY_TITLES[kind] as string,
	});
}
