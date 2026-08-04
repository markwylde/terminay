import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createEditTabRoutePanel } from '../../packages/shared-ui/src/components/EditTabRoutePanel.mjs'
import { createMacroEditorRoutePanel } from '../../packages/shared-ui/src/components/MacroEditorRoutePanel.mjs'
import { createRecordingDetailRoutePanel } from '../../packages/shared-ui/src/components/RecordingDetailRoutePanel.mjs'
import { SharedRouteEditorSurface } from '../../src/shared/SharedRouteEditorSurface'

function Fixture() {
	const layout = window.innerWidth <= 720 ? 'narrow' : window.innerWidth < 1100 ? 'medium' : 'wide'
	const panelLayout = layout === 'medium' ? 'wide' : layout
	const [intent, setIntent] = useState('')
	const panels = [
		['macro-editor', createMacroEditorRoutePanel({ layout: panelLayout, projectId: 'project:docs', macroId: 'macro:format', status: 'ready', draft: { label: 'Format', body: 'npm test' } })],
		['recording-detail', createRecordingDetailRoutePanel({ layout: panelLayout, projectId: 'project:docs', status: 'ready', recording: { id: 'recording:demo', title: 'Demo session', detail: 'Terminal recording' } })],
		['edit-tab', createEditTabRoutePanel({ layout: panelLayout, targetId: 'panel:shell', kind: 'terminal', status: 'ready', draft: { title: 'Shell', emoji: '>', color: '#345678', projectColor: '#112233', inheritsProjectColor: false, activityIndicatorsEnabled: true } })],
	] as const
	const routePanel = <T extends { readonly layout: 'wide' | 'narrow' }>(panel: T) => layout === 'medium'
		? Object.freeze({ ...panel, layout: 'medium' as const })
		: panel
	return <main data-shared-route-editor-proof-layout={layout}>{panels.map(([id, panel]) => <SharedRouteEditorSurface key={id} panelId={id} panel={routePanel(panel)} onIntent={action => setIntent(`${id}:${action.id}`)} />)}<output data-shared-route-editor-intent>{intent}</output></main>
}

const root = document.getElementById('shared-route-editor-root')
if (root === null) throw new Error('Missing shared route editor root')
createRoot(root).render(<Fixture />)
