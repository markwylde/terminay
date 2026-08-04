import { useMemo, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type {
	ResponsiveWorkspaceShellModel,
	SharedWorkspaceRouteEntry,
	SharedWorkspaceRouteRegion,
} from '@terminay/responsive-ui'
import { createResponsiveRouteTabListModel, reduceResponsiveRouteTabKey } from '@terminay/responsive-ui'
import './ResponsiveWorkspaceShell.css'

export interface ResponsiveWorkspaceShellProps {
	readonly shell: ResponsiveWorkspaceShellModel
	readonly title: string
	readonly origin: string
	readonly backLabel?: string
	readonly onBack?: () => void
	readonly routeEnabled?: (route: SharedWorkspaceRouteEntry) => boolean
	readonly onRouteSelect?: (route: SharedWorkspaceRouteEntry) => void
	readonly alert?: ReactNode
	readonly terminal: ReactNode
}

/**
 * Shared workspace shell/chrome for browser and Desktop hosts.
 *
 * The host supplies capability-derived shell model data, navigation callbacks,
 * and feature bodies. This component owns the shared header, route chrome,
 * semantic region markers, and stable data attributes; it does not know about
 * xterm, Electron, transport implementations, or server URLs.
 */
export function ResponsiveWorkspaceShell({
	shell,
	title,
	origin,
	backLabel = 'Connections',
	onBack,
	routeEnabled = route => route.route === shell.route.route,
	onRouteSelect,
	alert,
	terminal,
}: ResponsiveWorkspaceShellProps) {
	const routeTabRefs = useRef(new Map<string, HTMLButtonElement>())
	const routeTabs = useMemo(() => createResponsiveRouteTabListModel({
		routes: shell.routes,
		activeRoute: shell.route.route,
		layout: shell.layout,
		disabledRoutes: shell.routes.filter(route => !routeEnabled(route)).map(route => route.route),
	}), [routeEnabled, shell.layout, shell.route.route, shell.routes])
	const activeRouteTab = routeTabs.items.find(item => item.selected)
	if (activeRouteTab === undefined) throw new Error('shared route tab state has no active route')
	function focusRoute(route: string) {
		requestAnimationFrame(() => routeTabRefs.current.get(route)?.focus())
	}
	function handleRouteKeyDown(event: KeyboardEvent<HTMLButtonElement>, route: SharedWorkspaceRouteEntry) {
		const result = reduceResponsiveRouteTabKey(routeTabs, event.key, route.route)
		if (result.focusRoute === route.route && result.activeRoute === routeTabs.activeRoute && event.key !== 'Enter' && event.key !== ' ') return
		event.preventDefault()
		focusRoute(result.focusRoute)
		if (result.changed) onRouteSelect?.(shell.routes.find(candidate => candidate.route === result.activeRoute) ?? route)
	}
	return (
		<main
			className={`workspace-shell workspace-shell--${shell.layout}`}
			role={shell.role}
			style={shell.accessibility.colorScheme === 'system' ? undefined : { colorScheme: shell.accessibility.colorScheme }}
			data-shared-ui="responsive-workspace"
			data-shared-route={shell.route.route}
			data-shared-route-presentation={shell.route.presentation}
			data-shared-route-registry={shell.routes.map(route => route.route).join(',')}
			data-shared-route-component={shell.routeComponent.component.id}
			data-shared-motion={shell.accessibility.motion.transition}
			data-shared-forced-colors={String(shell.accessibility.forcedColors)}
			data-shared-high-contrast={String(shell.accessibility.highContrast)}
			data-shared-screen-reader={String(shell.accessibility.screenReader)}
			data-shared-color-scheme={shell.accessibility.colorScheme}
	>
			<a className="shared-workspace-skip-link" href={`#${activeRouteTab.panelId}`}>
				Skip route navigation
			</a>
			<header className="workspace-header">
				<div className="shared-project-tabs" role="tablist" aria-label="Projects">
					<div className="shared-project-tab shared-project-tab--active" role="tab" aria-selected="true" tabIndex={0}>
						<span className="shared-project-tab__title">{title}</span>
					</div>
				</div>
				<div className="shared-workspace-connection">
					<span className="shared-workspace-connection__label">{origin}</span>
					{onBack && <button className="secondary shared-workspace-connection__action" type="button" onClick={onBack}>{backLabel}</button>}
				</div>
			</header>

			<section className="shared-workspace-frame" aria-label={`Shared workspace — ${shell.route.label}`}>
				<div className="shared-workspace-nav" role="tablist" aria-label={routeTabs.ariaLabel} aria-orientation={routeTabs.ariaOrientation}>
					{routeTabs.items.map(item => {
						const route = shell.routes.find(candidate => candidate.route === item.route)
						if (route === undefined) return null
						return (
						<SharedRouteButton
							key={item.route}
							route={route}
							item={item}
							onSelect={onRouteSelect}
							onKeyDown={handleRouteKeyDown}
							setRef={element => {
								if (element === null) routeTabRefs.current.delete(item.route)
								else routeTabRefs.current.set(item.route, element)
							}}
						/>
						)
					})}
				</div>

				<section
					className="shared-workspace-body"
					id={activeRouteTab.panelId}
					role="tabpanel"
					tabIndex={-1}
					aria-labelledby={activeRouteTab.tabId}
					aria-label={shell.routeComponent.component.label}
				>
					<div className="shared-workspace-region-strip">
						{shell.routeComponent.component.regions.map(region => (
							<span key={region} data-shared-region-marker={region}>{renderRegionLabel(region)}</span>
						))}
					</div>
					{alert}
					<section className="terminal-card" aria-label="Terminal" data-shared-region="terminal">
						{terminal}
					</section>
				</section>
			</section>
		</main>
	)
}

function SharedRouteButton({
	route,
	item,
	onSelect,
	onKeyDown,
	setRef,
}: {
	readonly route: SharedWorkspaceRouteEntry
	readonly item: ReturnType<typeof createResponsiveRouteTabListModel>['items'][number]
	readonly onSelect?: (route: SharedWorkspaceRouteEntry) => void
	readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, route: SharedWorkspaceRouteEntry) => void
	readonly setRef: (element: HTMLButtonElement | null) => void
}) {
	return (
		<button
			ref={setRef}
			className={`shared-workspace-nav__item${item.selected ? ' shared-workspace-nav__item--current' : ''}`}
			type="button"
			id={item.tabId}
			role="tab"
			aria-controls={item.ariaControls}
			aria-selected={item.ariaSelected}
			aria-disabled={item.ariaDisabled}
			tabIndex={item.tabIndex}
			disabled={item.disabled}
			data-shared-route-link={route.route}
			data-shared-route-presentation={route.presentation}
			onClick={() => onSelect?.(route)}
			onKeyDown={event => onKeyDown(event, route)}
		>
			{route.label}
		</button>
	)
}

export function renderRegionLabel(region: SharedWorkspaceRouteRegion): string {
	return region.replace(/-/gu, ' ')
}
