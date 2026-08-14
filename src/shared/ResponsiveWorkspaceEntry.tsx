import {
	createHostCapabilityProvider,
	type HostCapabilityProvider,
	type HostCapabilitySet,
} from '@terminay/client-core';
import {
	createSharedWorkspaceRouteEntries,
	type SharedWorkspaceRoute,
	type SharedWorkspaceRouteEntry,
} from '@terminay/responsive-ui';
import { type ReactNode, useEffect } from 'react';
import './ResponsiveWorkspaceEntry.css';
import { recordBootstrapDiagnostic } from './rendererDiagnostics';

/**
 * Map the legacy window views onto the shared route vocabulary. The mapping is
 * deliberately kept at the renderer boundary: the shared package owns the
 * route names and presentation policy, while legacy feature windows remain
 * valid fallbacks until their shared components are migrated.
 */
export function sharedRouteForView(
	view: string | null,
): SharedWorkspaceRoute | undefined {
	switch (view) {
		case null:
		case 'workspace':
			return 'workspace';
		case 'settings':
			return 'settings';
		case 'macros':
			return 'macros';
		case 'recordings':
			return 'recordings';
		case 'edit-tab':
			return 'file';
		case 'connections':
			return 'connections';
		case 'git':
			return 'git';
		case 'agents':
			return 'workspace';
		case 'folder':
			return 'file';
		case 'terminal':
			return 'workspace';
		default:
			return undefined;
	}
}

export interface ResponsiveWorkspaceEntryProps {
	readonly route?: SharedWorkspaceRoute;
	readonly capabilities?: HostCapabilitySet | HostCapabilityProvider;
	readonly presentation?: SharedWorkspaceRouteEntry['presentation'];
	readonly children: ReactNode;
}

/**
 * The production renderer boundary for the shared workspace.
 *
 * Route identity and host presentation come from the shared responsive
 * package, while the route body is composed as ordinary React children. This
 * boundary deliberately contains no compatibility fallback or duplicate route
 * marker: the production route component is the visible route.
 */
export function ResponsiveWorkspaceEntry({
	route = 'workspace',
	capabilities,
	presentation,
	children,
}: ResponsiveWorkspaceEntryProps) {
	const routes = createSharedWorkspaceRouteEntries(
		createHostCapabilityProvider(capabilities),
	);
	const routeEntry: SharedWorkspaceRouteEntry | undefined = routes.find(
		(entry) => entry.route === route,
	);
	recordBootstrapDiagnostic('responsive.render');
	useEffect(() => {
		recordBootstrapDiagnostic('responsive.commit');
	});

	if (routeEntry === undefined) return <>{children}</>;

	return (
		<section
			className="responsive-workspace-entry"
			data-shared-ui="responsive-workspace"
			data-shared-route={routeEntry.route}
			data-shared-route-presentation={presentation ?? routeEntry.presentation}
			data-shared-route-count={String(routes.length)}
			aria-label={`Shared workspace — ${routeEntry.label}`}
		>
			{children}
		</section>
	);
}
