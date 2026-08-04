import ReactDOM from 'react-dom/client'
import { SharedEditTabRouteBody } from '../../src/shared/SharedEditTabRouteBody'
import { SharedMacroRouteBody } from '../../src/shared/SharedMacroRouteBody'
import { SharedRecordingsRouteBody } from '../../src/shared/SharedRecordingsRouteBody'
import { SharedSettingsRouteBody } from '../../src/shared/SharedSettingsRouteBody'
import type { EditWindowState } from '../../src/types/terminay'
import '../../src/settings.css'
import '../../src/recordings.css'
import '../../src/components/editTabWindow.css'

function Proof() {
  return <main className="proof">
    <section><SharedSettingsRouteBody activeCategoryId="general" categories={[{ id: 'general', label: 'General' }]} onCategorySelect={() => {}} onQueryChange={() => {}} onResetAll={() => {}} query="" status="Ready"><p>Settings content</p></SharedSettingsRouteBody></section>
    <section><SharedMacroRouteBody sidebar={<nav aria-label="Macro library">Macro library</nav>}><p>Macro editor</p></SharedMacroRouteBody></section>
    <section><SharedRecordingsRouteBody library={<aside aria-label="Recordings library">Recordings library</aside>}><p>Recording detail</p></SharedRecordingsRouteBody></section>
    <section><SharedEditTabRouteBody state={projectEditState} onCancel={() => {}} onSubmit={async () => {}} /></section>
  </main>
}

const projectEditState = {
  kind: 'project',
  projectId: 'project-proof',
  draft: {
    color: '#778899',
    defaultShellProfileId: null,
    emoji: '📁',
    rootFolder: '/project',
    shellProfileOptions: [],
    title: 'Project',
  },
} satisfies EditWindowState

const root = document.getElementById('root')
if (root === null) throw new Error('Missing shared auxiliary route root')
ReactDOM.createRoot(root).render(<Proof />)
