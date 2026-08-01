import type { AriaRole, ReactNode } from 'react'
import './SharedPanelContractSurface.css'

export interface SharedPanelAction {
	readonly id: string
	readonly label: string
	readonly minTouchTargetPx: number
}

export interface SharedPanelContract {
	readonly role: string
	readonly ariaLabel: string
	readonly layout: 'wide' | 'narrow'
	readonly status?: string
	readonly statusLabel?: string
	readonly statusDescription?: string
	readonly title?: string
	readonly description?: string
	readonly detail?: string
	readonly ariaLive?: 'polite' | 'assertive' | 'off'
	readonly ariaModal?: boolean
	/**
	 * Terminal byte output is intentionally represented as a non-live log
	 * region. The host renders the actual terminal attachment inside this
	 * semantic boundary; the shared route surface never owns that stream.
	 */
	readonly outputRegion?: {
		readonly role: 'log'
		readonly ariaLive: 'off'
		readonly ariaLabel: string
	}
	readonly statusRegion?: {
		readonly role: string
		readonly ariaLive?: 'polite' | 'assertive' | 'off'
		readonly ariaAtomic?: boolean
		readonly ariaBusy?: boolean
	}
	readonly retryAction?: SharedPanelAction
	readonly openAction?: SharedPanelAction
	readonly actions?: readonly SharedPanelAction[]
	readonly list?: {
		readonly role: string
		readonly ariaLabel: string
		readonly items: readonly {
			readonly id: string
			readonly role?: string
			readonly label?: string
			readonly title?: string
			readonly statusLabel?: string
			readonly detail?: string
			readonly selectAction?: SharedPanelAction
			readonly action?: SharedPanelAction
			readonly closeAction?: SharedPanelAction
		}[]
	}
	readonly tabList?: {
		readonly role: 'tablist'
		readonly ariaLabel: string
		readonly ariaOrientation?: 'horizontal' | 'vertical'
		readonly tabs: readonly {
			readonly id: string
			readonly role: 'tab'
			readonly label: string
			readonly ariaSelected: boolean
			readonly ariaDisabled?: boolean
			readonly tabIndex: number
			readonly selectAction?: SharedPanelAction
			readonly closeAction?: SharedPanelAction
		}[]
	}
	readonly tree?: {
		readonly role: 'tree'
		readonly ariaLabel: string
		readonly ariaOrientation?: 'horizontal' | 'vertical'
		readonly items: readonly {
			readonly id: string
			readonly role: 'treeitem'
			readonly label: string
			readonly ariaSelected: boolean
			readonly action: SharedPanelAction
		}[]
	}
	readonly connections?: readonly {
		readonly id: string
		readonly label: string
		readonly status: string
		readonly activateAction?: SharedPanelAction
	}[]
	readonly connectAction?: SharedPanelAction
	readonly addAction?: SharedPanelAction
}

export interface SharedPanelContractSurfaceProps {
	readonly panel: SharedPanelContract
	readonly panelId: string
	readonly onIntent?: (action: SharedPanelAction) => void
}

/**
 * Renders a shared-ui panel contract without taking ownership of any client,
 * persistence, host action, or transport. Both browser and Desktop can mount
 * the same semantic state surface and translate its immutable intents at their
 * outer host boundary.
 */
export function SharedPanelContractSurface({
	panel,
	panelId,
	onIntent,
}: SharedPanelContractSurfaceProps) {
	const actions = uniqueActions(panel)
	const list = normalizeList(panel)
	const title = panel.title ?? panel.statusLabel ?? panel.ariaLabel
	const description = panel.description ?? panel.statusDescription

	return (
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: the deeply frozen shared model restricts aria-modal to the validated dialog role
		<section
			className={`shared-panel-contract shared-panel-contract--${panel.layout}`}
			role={panel.role as AriaRole}
			aria-label={panel.ariaLabel}
			aria-live={panel.ariaLive}
			aria-modal={panel.ariaModal === true || undefined}
			data-shared-panel-contract={panelId}
			data-shared-panel-layout={panel.layout}
			data-shared-panel-status={panel.status}
		>
			<h2>{title}</h2>
			{description !== undefined && <p>{description}</p>}
			{panel.detail !== undefined && <p className="shared-panel-contract__detail">{panel.detail}</p>}
			{panel.statusRegion !== undefined && (
				<p
					className="shared-panel-contract__status"
					role={panel.statusRegion.role as AriaRole}
					aria-live={panel.statusRegion.ariaLive}
					aria-atomic={panel.statusRegion.ariaAtomic}
					aria-busy={panel.statusRegion.ariaBusy}
				>
					{panel.statusLabel ?? title}
				</p>
			)}
			{panel.outputRegion !== undefined && (
				// biome-ignore lint/a11y/useAriaPropsSupportedByRole: outputRegion is validated as a non-live log before rendering
				<div
					className="shared-panel-contract__output-region"
					role={panel.outputRegion.role}
					aria-live={panel.outputRegion.ariaLive}
					aria-label={panel.outputRegion.ariaLabel}
					data-shared-panel-output-region
				/>
			)}
			{list !== undefined && <SharedPanelList list={list} onIntent={onIntent} />}
			{panel.tabList !== undefined && <SharedPanelTabList tabList={panel.tabList} onIntent={onIntent} />}
			{panel.tree !== undefined && <SharedPanelTree tree={panel.tree} onIntent={onIntent} />}
			{actions.length > 0 && (
				<fieldset className="shared-panel-contract__actions" aria-label={`${panel.ariaLabel} actions`}>
					{actions.map(action => (
						<button
							key={action.id}
							type="button"
							className="shared-panel-contract__action"
							data-shared-panel-action={action.id}
							style={{ minHeight: action.minTouchTargetPx, minWidth: action.minTouchTargetPx }}
							onClick={() => onIntent?.(action)}
						>
							{action.label}
						</button>
					))}
				</fieldset>
			)}
		</section>
	)
}

function SharedPanelList({
	list,
	onIntent,
}: {
	readonly list: NonNullable<SharedPanelContract['list']>
	readonly onIntent?: (action: SharedPanelAction) => void
}) {
	return (
		<ul className="shared-panel-contract__list" role={list.role as AriaRole} aria-label={list.ariaLabel}>
			{list.items.map(item => (
				<li key={item.id} role={item.role as AriaRole}>
					<span>{item.title ?? item.label ?? item.id}</span>
					{item.statusLabel !== undefined && <span>{item.statusLabel}</span>}
					{item.detail !== undefined && <span>{item.detail}</span>}
					{(item.selectAction ?? item.action) !== undefined && (
						<button
							type="button"
							className="shared-panel-contract__action"
							data-shared-panel-action={(item.selectAction ?? item.action)!.id}
							style={{ minHeight: (item.selectAction ?? item.action)!.minTouchTargetPx, minWidth: (item.selectAction ?? item.action)!.minTouchTargetPx }}
							onClick={() => onIntent?.((item.selectAction ?? item.action)!)}
						>
							{(item.selectAction ?? item.action)!.label}
						</button>
					)}
					{item.closeAction !== undefined && <SharedPanelActionButton action={item.closeAction} onIntent={onIntent} />}
				</li>
			))}
		</ul>
	)
}

function SharedPanelTabList({
	tabList,
	onIntent,
}: {
	readonly tabList: NonNullable<SharedPanelContract['tabList']>
	readonly onIntent?: (action: SharedPanelAction) => void
}) {
	return (
		<div role="tablist" aria-label={tabList.ariaLabel} aria-orientation={tabList.ariaOrientation}>
			{tabList.tabs.map(tab => (
				<div
					key={tab.id}
					role="tab"
					aria-selected={tab.ariaSelected}
					aria-disabled={tab.ariaDisabled}
					tabIndex={tab.tabIndex}
				>
					{tab.selectAction === undefined
						? <span>{tab.label}</span>
						: <SharedPanelActionButton action={tab.selectAction} onIntent={onIntent} label={tab.label} />}
					{tab.closeAction !== undefined && <SharedPanelActionButton action={tab.closeAction} onIntent={onIntent} />}
				</div>
			))}
		</div>
	)
}

function SharedPanelTree({
	tree,
	onIntent,
}: {
	readonly tree: NonNullable<SharedPanelContract['tree']>
	readonly onIntent?: (action: SharedPanelAction) => void
}) {
	const hasSelection = tree.items.some(item => item.ariaSelected)
	return (
		<div role="tree" aria-label={tree.ariaLabel} aria-orientation={tree.ariaOrientation}>
			{tree.items.map((item, index) => (
				<div
					key={item.id}
					role="treeitem"
					aria-selected={item.ariaSelected}
					tabIndex={item.ariaSelected || (!hasSelection && index === 0) ? 0 : -1}
				>
					<SharedPanelActionButton action={item.action} onIntent={onIntent} label={item.label} />
				</div>
			))}
		</div>
	)
}

function SharedPanelActionButton({
	action,
	onIntent,
	label = action.label,
}: {
	readonly action: SharedPanelAction
	readonly onIntent?: (action: SharedPanelAction) => void
	readonly label?: string
}) {
	return (
		<button
			type="button"
			className="shared-panel-contract__action"
			data-shared-panel-action={action.id}
			style={{ minHeight: action.minTouchTargetPx, minWidth: action.minTouchTargetPx }}
			onClick={() => onIntent?.(action)}
		>
			{label}
		</button>
	)
}

function uniqueActions(panel: SharedPanelContract): readonly SharedPanelAction[] {
	const candidates = [panel.retryAction, panel.openAction, panel.connectAction, panel.addAction, ...(panel.actions ?? [])]
	const seen = new Set<string>()
	return candidates.filter((action): action is SharedPanelAction => {
		if (action === undefined || seen.has(action.id)) return false
		seen.add(action.id)
		return true
	})
}

function normalizeList(panel: SharedPanelContract): NonNullable<SharedPanelContract['list']> | undefined {
	if (panel.list !== undefined && Array.isArray(panel.list.items)) return panel.list
	if (panel.connections === undefined) return undefined
	return {
		role: 'listbox',
		ariaLabel: panel.list?.ariaLabel ?? 'Saved connections',
		items: panel.connections.map(connection => ({
			id: connection.id,
			label: connection.label,
			statusLabel: connection.status,
			selectAction: connection.activateAction,
		})),
	}
}

export function renderSharedPanelContractText(panel: SharedPanelContract): ReactNode {
	return panel.title ?? panel.statusLabel ?? panel.ariaLabel
}
