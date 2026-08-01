import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createAgentStatusPanel } from '../../packages/shared-ui/src/components/AgentStatusPanel.mjs'
import { createConnectionErrorPanel } from '../../packages/shared-ui/src/components/ConnectionErrorPanel.mjs'
import { createFileViewerPanel } from '../../packages/shared-ui/src/components/FileViewerPanel.mjs'
import { createGitStatusPanel } from '../../packages/shared-ui/src/components/GitStatusPanel.mjs'
import { createMacroLibraryPanel } from '../../packages/shared-ui/src/components/MacroLibraryPanel.mjs'
import { createRecordingsLibraryPanel } from '../../packages/shared-ui/src/components/RecordingsLibraryPanel.mjs'
import { createSettingsPanel } from '../../packages/shared-ui/src/components/SettingsPanel.mjs'
import { createTerminalSessionPanel } from '../../packages/shared-ui/src/components/TerminalSessionPanel.mjs'
import { SharedPanelContractSurface, type SharedPanelContract } from '../../src/shared/SharedPanelContractSurface'

function SharedPanelContractStates() {
	const layout = window.innerWidth <= 720 ? 'narrow' : 'wide'
	const [intents, setIntents] = useState<readonly string[]>([])
	const panels: readonly [string, SharedPanelContract][] = [
		['terminal', createTerminalSessionPanel({ terminalId: 'terminal:build', label: 'Build', status: 'failed', layout })],
		['file', createFileViewerPanel({ fileId: 'file:readme', label: 'README.md', status: 'failed', layout })],
		['git', createGitStatusPanel({ projectId: 'project:app', label: 'App', status: 'failed', layout })],
		['agents', createAgentStatusPanel({ layout, agents: [{ id: 'agent:review', label: 'Review agent', status: 'failed' }] })],
		['macros', createMacroLibraryPanel({ layout, status: 'failed', macros: [] })],
		['recordings', createRecordingsLibraryPanel({ layout, status: 'failed', recordings: [] })],
		['settings', createSettingsPanel({ layout, status: 'failed', sections: [] })],
		['connection', createConnectionErrorPanel({ layout, status: 'offline', serverLabel: 'Local server' })],
	]

	return (
		<main className="shared-panel-contract-proof" data-shared-panel-contract-proof-layout={layout}>
			<h1>Shared panel failure states</h1>
			<p aria-live="polite" data-shared-panel-intents>{intents.join(',')}</p>
			{panels.map(([id, panel]) => (
				<SharedPanelContractSurface
					key={id}
					panelId={id}
					panel={panel}
					onIntent={action => setIntents(current => [...current, `${id}:${action.id}`])}
				/>
			))}
		</main>
	)
}

const root = document.getElementById('shared-panel-contract-root')
if (root === null) throw new Error('The shared panel contract fixture root is missing')
createRoot(root).render(<SharedPanelContractStates />)
