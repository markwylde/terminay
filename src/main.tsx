import ReactDOM from 'react-dom/client'
import 'dockview/dist/styles/dockview.css'
import '@xterm/xterm/css/xterm.css'
import App from './App.tsx'
import { SettingsWindow } from './components/SettingsWindow.tsx'
import './index.css'

const searchParams = new URLSearchParams(window.location.search)
const view = searchParams.get('view')

ReactDOM.createRoot(document.getElementById('root')!).render(view === 'settings' ? <SettingsWindow /> : <App />)
