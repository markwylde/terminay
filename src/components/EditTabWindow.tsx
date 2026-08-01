import { useEffect, useState } from 'react'
import type { EditWindowResult, EditWindowState, ProjectEditWindowResult, TerminalEditWindowResult } from '../types/terminay'
import { SharedEditTabRouteBody, type SharedEditTabResult } from '../shared/SharedEditTabRouteBody'
import '../settings.css'
import './editTabWindow.css'

export type EditWindowClient = Readonly<{
  getEditWindowState: () => Promise<EditWindowState | null>
  submitEditWindowResult: (result: EditWindowResult) => Promise<void>
}>

/** Desktop host wrapper only: load the privileged draft, submit its result,
 * and close the native auxiliary window. The reusable form lives in shared/. */
export function EditTabWindow({ client }: Readonly<{ client: EditWindowClient }>) {
  const [state, setState] = useState<EditWindowState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void client.getEditWindowState().then((nextState) => {
      if (!mounted) return
      if (nextState === null) setLoadError('This edit window no longer has any draft data.')
      else setState(nextState)
    }).catch((cause: unknown) => {
      if (mounted) setLoadError(cause instanceof Error ? cause.message : 'Unable to load this edit draft.')
    })
    return () => { mounted = false }
  }, [client])

  const submit = async (result: SharedEditTabResult) => {
    if (state === null) throw new Error('The edit draft is unavailable.')
    const request: EditWindowResult = state.kind === 'project'
      ? { kind: 'project', result: result as ProjectEditWindowResult }
      : { kind: 'terminal', result: result as TerminalEditWindowResult }
    await client.submitEditWindowResult(request)
  }

  if (loadError !== null) return <div className="edit-window-shell"><div className="edit-window-error">{loadError}</div></div>
  if (state === null) return <div className="edit-window-shell" aria-busy="true" />
  return <SharedEditTabRouteBody state={state} onSubmit={submit} onCancel={() => window.close()} />
}
