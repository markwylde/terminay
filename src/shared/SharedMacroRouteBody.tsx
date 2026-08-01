import type { ReactNode } from 'react'

export interface SharedMacroRouteBodyProps {
  readonly sidebar: ReactNode
  readonly children: ReactNode
}

/** Host-neutral macro route layout. Hosts own persistence and commands; this
 * component owns the reusable route shell and accessible content landmark. */
export function SharedMacroRouteBody({ sidebar, children }: SharedMacroRouteBodyProps) {
  return (
    <div className="settings-shell" data-shared-route-body="macros">
      <aside className="settings-sidebar" aria-label="Macro library and navigation">{sidebar}</aside>
      <main className="settings-main">
        <div className="macros-content">{children}</div>
      </main>
    </div>
  )
}
