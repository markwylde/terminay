import ReactDOM from 'react-dom/client'
import 'dockview/dist/styles/dockview.css'
import '@xterm/xterm/css/xterm.css'
import App from './App.tsx'
import { EditTabWindow } from './components/EditTabWindow.tsx'
import { MacrosWindow } from './components/MacrosWindow.tsx'
import { SettingsWindow } from './components/SettingsWindow.tsx'
import { WebRtcHost } from './remote/WebRtcHost.tsx'
import './index.css'

const searchParams = new URLSearchParams(window.location.search)
const view = searchParams.get('view')

const content = (() => {
  switch (view) {
    case 'settings':
      return <SettingsWindow />
    case 'macros':
      return <MacrosWindow />
    case 'edit-tab':
      return <EditTabWindow />
    case 'webrtc-host':
      return <WebRtcHost />
    default:
      return <App />
  }
})()

ReactDOM.createRoot(document.getElementById('root')!).render(content)
