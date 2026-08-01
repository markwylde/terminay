import ReactDOM from 'react-dom/client'
import { SharedEditTabRouteBody } from '../../src/shared/SharedEditTabRouteBody'
import { SharedMacroRouteBody } from '../../src/shared/SharedMacroRouteBody'
import { SharedRecordingsRouteBody } from '../../src/shared/SharedRecordingsRouteBody'
import { SharedSettingsRouteBody } from '../../src/shared/SharedSettingsRouteBody'
import '../../src/settings.css'
import '../../src/recordings.css'
import '../../src/components/editTabWindow.css'

function Proof() {
  return <main className="proof">
    <section><SharedSettingsRouteBody activeCategoryId="general" categories={[{ id: 'general', label: 'General' }]} onCategorySelect={() => {}} onQueryChange={() => {}} onResetAll={() => {}} query="" status="Ready"><p>Settings content</p></SharedSettingsRouteBody></section>
    <section><SharedMacroRouteBody sidebar={<nav aria-label="Macro library">Macro library</nav>}><p>Macro editor</p></SharedMacroRouteBody></section>
    <section><SharedRecordingsRouteBody library={<aside aria-label="Recordings library">Recordings library</aside>}><p>Recording detail</p></SharedRecordingsRouteBody></section>
    <section><SharedEditTabRouteBody state={{ kind: 'project', draft: { color: '#778899', emoji: '📁', rootFolder: '/project', title: 'Project' } }} onCancel={() => {}} onSubmit={async () => {}} /></section>
  </main>
}

const root = document.getElementById('root')
if (root === null) throw new Error('Missing shared auxiliary route root')
ReactDOM.createRoot(root).render(<Proof />)
