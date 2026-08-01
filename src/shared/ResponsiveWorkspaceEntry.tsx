import { useEffect, type ReactNode } from 'react'
import {
	createHostCapabilityProvider,
	type HostCapabilityProvider,
	type HostCapabilitySet,
} from '@terminay/client-core'
import {
	createSharedWorkspaceRouteEntries,
	type SharedWorkspaceRoute,
	type SharedWorkspaceRouteEntry,
} from '@terminay/responsive-ui'
import './ResponsiveWorkspaceEntry.css'

/**
 * Map the legacy window views onto the shared route vocabulary. The mapping is
 * deliberately kept at the renderer boundary: the shared package owns the
 * route names and presentation policy, while legacy feature windows remain
 * valid fallbacks until their shared components are migrated.
 */
export function sharedRouteForView(view: string | null): SharedWorkspaceRoute | undefined {
	switch (view) {
		case null:
		case 'workspace':
			return 'workspace'
		case 'settings':
			return 'settings'
		case 'macros':
			return 'macros'
		case 'recordings':
			return 'recordings'
		case 'edit-tab':
			return 'file'
		case 'connections':
			return 'connections'
		case 'git':
			return 'git'
		case 'agents':
			return 'workspace'
		case 'folder':
			return 'file'
		case 'terminal':
			return 'workspace'
		default:
			return undefined
	}
}

export interface ResponsiveWorkspaceEntryProps {
	readonly route?: SharedWorkspaceRoute
	readonly capabilities?: HostCapabilitySet | HostCapabilityProvider
	readonly presentation?: SharedWorkspaceRouteEntry['presentation']
	readonly legacyFallback: ReactNode
}

/**
 * The production renderer boundary for the shared workspace.
 *
 * The current feature body is still supplied by `legacyFallback`, but route
 * identity and host presentation now come from the shared responsive package.
 * This makes the shared path active for every migrated route without making
 * unsupported auxiliary views disappear during the incremental migration.
 */
export function ResponsiveWorkspaceEntry({
	route = 'workspace',
	capabilities,
	presentation,
	legacyFallback,
}: ResponsiveWorkspaceEntryProps) {
	const routes = createSharedWorkspaceRouteEntries(createHostCapabilityProvider(capabilities))
	const routeEntry: SharedWorkspaceRouteEntry | undefined = routes.find((entry) => entry.route === route)
	window.terminayBootstrapDiagnostic?.record('responsive.render')
	useEffect(() => {
		window.terminayBootstrapDiagnostic?.record('responsive.commit')
	})

	if (routeEntry === undefined) return <>{legacyFallback}</>

	return (
		<section
			className="responsive-workspace-entry"
			data-shared-ui="responsive-workspace"
			data-shared-route={routeEntry.route}
			data-shared-route-presentation={presentation ?? routeEntry.presentation}
			data-shared-route-count={String(routes.length)}
			aria-label={`Shared workspace — ${routeEntry.label}`}
		>
			<nav
				className="responsive-workspace-entry__route-marker"
				aria-label="Shared workspace route"
				aria-live="polite"
				aria-atomic="true"
				data-shared-route-registry={routes.map((entry) => entry.route).join(',')}
			>
				<span aria-current="page">{routeEntry.label}</span>
			</nav>
			{legacyFallback}
		</section>
	)
}
