import type { ReactNode } from 'react'
import { SharedPanelContractSurface, type SharedPanelAction, type SharedPanelContract } from './SharedPanelContractSurface'
import './SharedWorkspaceRouteSurface.css'

export interface SharedWorkspaceRouteRenderModel {
	readonly role: 'region'
	readonly ariaLabel: string
	readonly route: string
	readonly layout: 'wide' | 'medium' | 'narrow'
	readonly components: readonly {
		readonly id: string
		readonly panel: SharedPanelContract
	}[]
}

export interface SharedWorkspaceRouteSurfaceProps {
	readonly model: SharedWorkspaceRouteRenderModel
	readonly onIntent?: (intent: Readonly<{ panelId: string; action: SharedPanelAction }>) => void
	readonly children?: ReactNode
}

/**
 * Host-neutral React rendering for a route model produced by shared-ui. It
 * deliberately receives only immutable render data and emits panel-scoped
 * intents; server/client/transport and native-window decisions remain outside
 * this surface in the browser or Desktop adapter.
 */
export function SharedWorkspaceRouteSurface({ model, onIntent, children }: SharedWorkspaceRouteSurfaceProps) {
	assertRouteModel(model)
	assertDeeplyFrozenRouteModel(model)
	return (
		<main
			className={`shared-workspace-route shared-workspace-route--${model.layout}`}
			role={model.role}
			aria-label={model.ariaLabel}
			data-shared-workspace-route={model.route}
			data-shared-workspace-layout={model.layout}
		>
			{model.components.map(({ id, panel }) => (
				<SharedPanelContractSurface
					key={id}
					panelId={id}
					panel={panel}
					onIntent={action => onIntent?.(Object.freeze({ panelId: id, action }))}
				/>
			))}
			{children}
		</main>
	)
}

/**
 * The shared composer snapshots route data before it reaches React. Keep that
 * invariant at the rendering seam as well: a mutable model could otherwise be
 * changed by a host between semantic validation and a later render. This is a
 * data-only boundary, not a host/transport policy.
 */
function assertDeeplyFrozenRouteModel(value: unknown, seen = new WeakSet<object>()): void {
	if (value === null || typeof value !== 'object') return
	if (seen.has(value)) throw new TypeError('Shared route models must be acyclic immutable data')
	if (!Object.isFrozen(value)) throw new TypeError('Shared route models must be deeply frozen before rendering')
	seen.add(value)
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)
		if (descriptor === undefined || !Reflect.has(descriptor, 'value')) {
			throw new TypeError('Shared route models cannot contain accessors')
		}
		assertDeeplyFrozenRouteModel(descriptor.value, seen)
	}
}

function assertRouteModel(model: SharedWorkspaceRouteRenderModel): void {
	if (model.role !== 'region' || !/^[a-z][a-z-]{1,63}$/u.test(model.route)) throw new TypeError('A safe shared route model is required')
	if (model.layout !== 'wide' && model.layout !== 'medium' && model.layout !== 'narrow') throw new TypeError('A shared route model must declare wide, medium, or narrow layout')
	if (!Array.isArray(model.components) || model.components.length === 0 || model.components.length > 16) throw new TypeError('A shared route model needs one to sixteen components')
	const ids = new Set<string>()
	for (const component of model.components) {
		if (!component || typeof component.id !== 'string' || ids.has(component.id) || component.panel?.layout !== panelLayoutForRouteLayout(model.layout)) {
			throw new TypeError('Shared route components must be unique and match their route layout')
		}
		assertRoutePanelSemantics(model.route, component.id, component.panel)
		ids.add(component.id)
	}
}

/**
 * Feature-panel contracts deliberately have two densities: narrow and wide.
 * Medium routes use the wide contract inside a more compact shell, rather than
 * inventing a third panel API or allowing a host to mix densities per panel.
 */
function panelLayoutForRouteLayout(layout: SharedWorkspaceRouteRenderModel['layout']): SharedPanelContract['layout'] {
	return layout === 'narrow' ? 'narrow' : 'wide'
}

/**
 * The shared composer permits a small set of route-scoped semantic exceptions.
 * Keep that allowlist at the React boundary too, so a host cannot accidentally
 * render an alert or modal dialog in a different route while reusing immutable
 * shared route data.
 */
function assertRoutePanelSemantics(route: string, panelId: string, panel: SharedPanelContract): void {
	const allowed = panel.role === 'region'
		|| (route === 'connections' && panelId === 'connection-error' && panel.role === 'alert')
		|| (route === 'settings' && panelId === 'dictation-capture' && panel.role === 'dialog' && panel.ariaModal === true)
		|| (route === 'workspace' && panelId === 'workspace-views' && panel.role === 'navigation')
		|| (route === 'workspace' && panelId === 'workspace-empty' && (panel.role === 'status' || panel.role === 'alert'))
	if (!allowed) throw new TypeError('Shared route panel semantic role is not allowed in this route slot')
	if (panel.ariaModal === true && panel.role !== 'dialog') throw new TypeError('Only shared dialog panels may be modal')
	if (panel.outputRegion !== undefined) {
		const isTerminalOutput = route === 'workspace'
			&& panelId === 'terminal-session'
			&& panel.outputRegion.role === 'log'
			&& panel.outputRegion.ariaLive === 'off'
			&& isSafeAriaLabel(panel.outputRegion.ariaLabel)
		if (!isTerminalOutput) throw new TypeError('Only the shared terminal panel may expose a non-live output region')
	}
}

function isSafeAriaLabel(value: unknown): value is string {
	return typeof value === 'string'
		&& value.trim().length > 0
		&& value.length <= 160
		&& !containsControlCharacter(value)
}

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0
		if (codePoint <= 31 || codePoint === 127) return true
	}
	return false
}
