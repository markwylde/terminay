const BOOT_TIMEOUT_MS = 15_000

const root = document.getElementById('root')
if (root === null) throw new Error('Terminay renderer root is unavailable')

const renderStatus = (message: string, failed = false) => {
  const status = document.createElement('main')
  status.className = 'terminay-server-connecting'
  status.textContent = message
  if (failed) {
    status.setAttribute('role', 'alert')
  } else {
    status.setAttribute('aria-busy', 'true')
  }
  root.replaceChildren(status)
}

renderStatus('Starting Terminay…')

let settled = false
const timeout = window.setTimeout(() => {
  if (settled) return
  settled = true
  renderStatus('Terminay renderer modules did not become ready in time.', true)
}, BOOT_TIMEOUT_MS)

void import('./rendererApp.tsx').then((module) => {
  if (settled) return
  settled = true
  window.clearTimeout(timeout)
  module.mountRendererApp(root)
}).catch(() => {
  if (settled) return
  settled = true
  window.clearTimeout(timeout)
  renderStatus('Terminay renderer modules could not be loaded.', true)
})
