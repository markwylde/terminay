import { useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ConnectionProfileStore,
  createHostCapabilityProvider,
  type TerminayClient,
} from '@terminay/client-core'
import {
  createResponsiveUiProvider,
  createResponsiveWorkspaceShellModel,
  type SharedWorkspaceRoute,
} from '@terminay/responsive-ui'
import { ResponsiveWorkspaceShell } from '../../src/shared/ResponsiveWorkspaceShell'
import '../../src/web/index.css'
import './shared-web-shell-proof.css'

const profileStore = new ConnectionProfileStore({
  local: false,
  now: () => 1_800_000_000_000,
})
profileStore.remember({
  id: 'e2e-shared-web',
  serverId: 'server-e2e-shared-web',
  label: 'E2E shared web server',
  origin: 'https://shared-web-shell.example.test',
  status: 'connected',
})
profileStore.select('e2e-shared-web')

const client = Object.freeze({
  snapshot: Object.freeze({
    state: 'connected' as const,
    revision: 42,
    cursor: '42',
    stale: false,
    reconnectAttempt: 0,
    server: Object.freeze({
      type: 'server_hello' as const,
      protocolVersion: 1,
      serverId: 'server-e2e-shared-web',
      serverVersion: '0.0.0-e2e',
      capabilities: Object.freeze([
        'server.health',
        'terminal',
        'workspace',
        'settings',
        'recordings',
        'macros',
        'files',
        'git',
      ]),
    }),
  }),
}) as TerminayClient

function SharedWebShellProof() {
  const [route, setRoute] = useState<SharedWorkspaceRoute>('workspace')
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth)
	const [reducedMotion, setReducedMotion] = useState(false)
	const [forcedColors, setForcedColors] = useState(false)
	const [colorScheme, setColorScheme] = useState<'system' | 'light' | 'dark'>('system')
  const shell = useMemo(
    () =>
      createResponsiveWorkspaceShellModel(
        createResponsiveUiProvider({
          client,
          capabilities: createHostCapabilityProvider({
            connectionProfiles: true,
            clipboard: true,
          }),
        }),
        {
          connectionProfiles: profileStore,
          navigation: {
            route,
            projectId: 'default',
            panelId: 'terminal-default',
          },
          viewportWidth,
			accessibility: { reducedMotion, forcedColors, colorScheme },
        },
      ),
		[route, viewportWidth, reducedMotion, forcedColors, colorScheme],
  )

  return (
    <>
      <label className="viewport-proof-control">
        Viewport width model
        <input
          aria-label="Viewport width model"
          inputMode="numeric"
          value={viewportWidth}
          onChange={event => setViewportWidth(Number(event.target.value))}
        />
      </label>
		<label className="accessibility-proof-control">
			Reduced motion
			<input aria-label="Reduced motion preference" type="checkbox" checked={reducedMotion} onChange={event => setReducedMotion(event.target.checked)} />
		</label>
		<label className="accessibility-proof-control">
			Forced colors
			<input aria-label="Forced colors preference" type="checkbox" checked={forcedColors} onChange={event => setForcedColors(event.target.checked)} />
		</label>
		<label className="accessibility-proof-control">
			Color scheme
			<select aria-label="Color scheme preference" value={colorScheme} onChange={event => setColorScheme(event.target.value as 'system' | 'light' | 'dark')}>
				<option value="system">System</option>
				<option value="light">Light</option>
				<option value="dark">Dark</option>
			</select>
		</label>
      <ResponsiveWorkspaceShell
        shell={shell}
        title="E2E shared web server"
        origin="https://shared-web-shell.example.test"
        routeEnabled={() => true}
        onRouteSelect={next => setRoute(next.route)}
        terminal={
          <div className="terminal-proof" role="presentation">
            <p>$ terminay shared shell browser proof</p>
            <p className="terminal-proof__long-line">
              0123456789abcdefghijklmnopqrstuvwxyz-0123456789abcdefghijklmnopqrstuvwxyz-0123456789abcdefghijklmnopqrstuvwxyz-0123456789abcdefghijklmnopqrstuvwxyz
            </p>
          </div>
        }
      />
    </>
  )
}

const root = document.getElementById('shared-web-shell-root')
if (root === null) throw new Error('shared web shell root element is missing')
createRoot(root).render(<SharedWebShellProof />)
