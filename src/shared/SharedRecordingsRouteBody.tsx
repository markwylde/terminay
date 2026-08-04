import type { ReactNode } from 'react'

export interface SharedRecordingsRouteBodyProps {
  readonly library: ReactNode
  readonly children: ReactNode
}

/** Host-neutral recordings route layout. Hosts provide recording data and
 * replay commands; this component owns the reusable library/detail frame. */
export function SharedRecordingsRouteBody({ library, children }: SharedRecordingsRouteBodyProps) {
  return (
    <div className="recordings-window" data-shared-route-body="recordings">
      {library}
      <main className="recordings-main">{children}</main>
    </div>
  )
}
