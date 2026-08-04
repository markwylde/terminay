import type { AriaRole } from 'react'
import './SharedRouteEditorSurface.css'

export interface SharedRouteEditorAction {
	readonly id: string
	readonly label: string
	readonly minTouchTargetPx: number
}

export interface SharedRouteEditorField {
	readonly id: string
	readonly role: 'textbox' | 'slider' | 'switch'
	readonly label?: string
	readonly value?: string
	readonly checked?: boolean
	readonly maxLength?: number
	readonly multiline?: boolean
	readonly disabled?: boolean
	readonly required?: boolean
}

export interface SharedRouteEditorPanel {
	readonly role: 'region'
	readonly ariaLabel: string
	readonly layout: 'wide' | 'medium' | 'narrow'
	readonly statusLabel: string
	readonly statusDescription: string
	readonly statusRegion: { readonly role: 'status'; readonly ariaLive: 'polite'; readonly ariaAtomic: true; readonly ariaBusy: boolean }
	readonly form?: {
		readonly role: 'form'
		readonly ariaLabel: string
		readonly disabled: boolean
		readonly draft?: Readonly<Record<string, SharedRouteEditorField>>
		readonly fields?: Readonly<Record<string, SharedRouteEditorField | string | boolean>>
	}
	readonly recording?: { readonly title: string; readonly detail?: string }
	readonly saveAction?: SharedRouteEditorAction
	readonly cancelAction?: SharedRouteEditorAction
	readonly replayAction?: SharedRouteEditorAction
	readonly deleteAction?: SharedRouteEditorAction
	readonly backAction?: SharedRouteEditorAction
	readonly retryAction?: SharedRouteEditorAction
}

export interface SharedRouteEditorSurfaceProps {
	readonly panelId: string
	readonly panel: SharedRouteEditorPanel
	readonly onIntent?: (action: SharedRouteEditorAction) => void
}

/**
 * Renders the existing macro, recording-detail, and edit-tab shared route
 * contracts. It treats supplied models as immutable display data: draft
 * persistence, replay, deletion, host navigation, and every client/transport
 * translation remain outside this React surface.
 */
export function SharedRouteEditorSurface({ panelId, panel, onIntent }: SharedRouteEditorSurfaceProps) {
	assertPanel(panelId, panel)
	const fields = editorFields(panel)
	const actions = editorActions(panel)
	return (
		<section className={`shared-route-editor shared-route-editor--${panel.layout}`} role={panel.role} aria-label={panel.ariaLabel} data-shared-route-editor={panelId} data-shared-route-editor-layout={panel.layout}>
			<h2>{panel.ariaLabel}</h2>
			<p role={panel.statusRegion.role as AriaRole} aria-live={panel.statusRegion.ariaLive} aria-atomic={panel.statusRegion.ariaAtomic} aria-busy={panel.statusRegion.ariaBusy}>{panel.statusLabel}</p>
			<p>{panel.statusDescription}</p>
			{panel.recording !== undefined && <RecordingMetadata recording={panel.recording} />}
			{panel.form !== undefined && <form aria-label={panel.form.ariaLabel} onSubmit={event => event.preventDefault()}>{fields.map(field => <EditorField key={field.id} field={field} disabled={panel.form!.disabled} />)}</form>}
			{actions.length > 0 && <fieldset className="shared-route-editor__actions" aria-label={`${panel.ariaLabel} actions`}>
				{actions.map(action => <button key={action.id} type="button" data-shared-route-editor-action={action.id} style={{ minHeight: action.minTouchTargetPx, minWidth: action.minTouchTargetPx }} onClick={() => onIntent?.(action)}>{action.label}</button>)}
			</fieldset>}
		</section>
	)
}

function RecordingMetadata({ recording }: { readonly recording: NonNullable<SharedRouteEditorPanel['recording']> }) {
	return <dl><dt>Recording</dt><dd>{recording.title}</dd>{recording.detail !== undefined && <><dt>Details</dt><dd>{recording.detail}</dd></>}</dl>
}

function EditorField({ field, disabled }: { readonly field: SharedRouteEditorField; readonly disabled: boolean }) {
	const label = field.label ?? field.id
	if (field.role === 'switch') return <label><input type="checkbox" role="switch" checked={field.checked === true} aria-checked={field.checked === true} disabled={disabled || field.disabled} readOnly />{label}</label>
	if (field.role === 'slider') return <label>{label}<input type="text" role="slider" value={field.value ?? ''} disabled={disabled || field.disabled} readOnly aria-valuenow={numericSliderValue(field.value)} aria-valuetext={field.value ?? ''} /></label>
	if (field.multiline) return <label>{label}<textarea value={field.value ?? ''} maxLength={field.maxLength} disabled={disabled || field.disabled} required={field.required} readOnly /></label>
	return <label>{label}<input type="text" value={field.value ?? ''} maxLength={field.maxLength} disabled={disabled || field.disabled} required={field.required} readOnly /></label>
}

function editorFields(panel: SharedRouteEditorPanel): readonly SharedRouteEditorField[] {
	if (panel.form === undefined) return []
	const source = panel.form.draft ?? panel.form.fields ?? {}
	return Object.values(source).filter((value): value is SharedRouteEditorField => typeof value === 'object' && value !== null && 'id' in value && 'role' in value)
}

function editorActions(panel: SharedRouteEditorPanel): readonly SharedRouteEditorAction[] {
	const seen = new Set<string>()
	return [panel.saveAction, panel.cancelAction, panel.replayAction, panel.deleteAction, panel.backAction, panel.retryAction]
		.filter((action): action is SharedRouteEditorAction => {
			if (action === undefined || seen.has(action.id)) return false
			seen.add(action.id)
			return true
		})
}

function numericSliderValue(value: string | undefined): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function assertPanel(panelId: string, panel: SharedRouteEditorPanel): void {
	if (!/^[a-z][a-z0-9-]{1,63}$/u.test(panelId)) throw new TypeError('A safe shared route editor panel id is required')
	if (panel.role !== 'region' || panel.layout !== 'wide' && panel.layout !== 'medium' && panel.layout !== 'narrow' || !panel.ariaLabel || !panel.statusLabel || !panel.statusDescription) throw new TypeError('A complete shared route editor panel is required')
	if (panel.statusRegion.role !== 'status' || panel.statusRegion.ariaLive !== 'polite' || panel.statusRegion.ariaAtomic !== true) throw new TypeError('Shared route editor status must remain polite and atomic')
	for (const action of editorActions(panel)) {
		if (!/^[a-z][a-z0-9-]{1,63}$/u.test(action.id) || action.minTouchTargetPx < 44) throw new TypeError('Shared route editor actions must be safe 44px intents')
	}
}
