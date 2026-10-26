import ReactDOM from 'react-dom/client'
import { SharedEditTabRouteBody } from '../../src/shared/SharedEditTabRouteBody'
import { SharedRecordingsRouteBody } from '../../src/shared/SharedRecordingsRouteBody'
import { SettingsListColumn, SettingsListSections, SharedSettingsRouteBody } from '../../src/shared/SharedSettingsRouteBody'
import type { EditWindowState } from '../../src/types/terminay'
import '../../src/settings.css'
import '../../src/recordings.css'
import '../../src/components/editTabWindow.css'

function Proof() {
  return <main className="proof">
    <section><SharedSettingsRouteBody activeCategoryId="general" categories={[{ id: 'general', label: 'General' }]} onCategorySelect={() => {}} onQueryChange={() => {}} onResetAll={() => {}} query="" status="Ready"><p>Settings content</p></SharedSettingsRouteBody></section>
    <section data-proof="collection"><SharedSettingsRouteBody activeCategoryId="macros" categories={[{ id: 'macros', label: 'Macros', count: 1 }]} onCategorySelect={() => {}} onQueryChange={() => {}} query="" status="Ready" detailTitle="Deploy" listTitle="Macros" listColumn={<SettingsListColumn title="Macros"><SettingsListSections label="Macros" selectedId="deploy" onSelect={() => {}} sections={[{ id: 'all', label: '', items: [{ id: 'deploy', label: 'Deploy', status: 'Saved' }] }]} /></SettingsListColumn>}><p>Macro editor</p></SharedSettingsRouteBody></section>
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
