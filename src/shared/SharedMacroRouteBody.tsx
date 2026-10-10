import type { ReactNode } from 'react'

export interface SharedMacroRouteBodyProps {
  readonly sidebar: ReactNode
  readonly children: ReactNode
  /** A third region for what the macro will ask and send. It sits beside the
   * editor when the window is wide enough and below it otherwise. */
  readonly aside?: ReactNode
  /** Stays below the editor while it scrolls: where the window's save state lives. */
  readonly footer?: ReactNode
}

/** Host-neutral macro route layout. Hosts own persistence and commands; this
 * component owns the reusable route shell and accessible content landmark. */
export function SharedMacroRouteBody({ sidebar, children, aside, footer }: SharedMacroRouteBodyProps) {
  return (
    <div className="settings-shell macros-shell" data-shared-route-body="macros">
      <aside className="settings-sidebar" aria-label="Macro library and navigation">{sidebar}</aside>
      <div className="macros-workspace">
        <main className="settings-main macros-main">
          <div className="macros-scroll">
            <div className="macros-content">{children}</div>
          </div>
          {footer}
        </main>
        {aside ? <aside className="macros-aside" aria-label="Macro preview">{aside}</aside> : null}
      </div>
    </div>
  )
}
