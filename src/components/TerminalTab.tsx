import { IDockviewPanelHeaderProps } from 'dockview'
import { useMemo } from 'react'

export type TerminalPanelParams = {
  sessionId: string
  color?: string
  emoji?: string
  isFocused?: boolean
}

const DEFAULT_TERMINAL_TAB_COLOR = '#0a0a0a'

export function TerminalTab(props: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const title = props.api.title
  const params = props.params
  const { color, emoji } = params || {}
  const isFocused = params?.isFocused === true
  const hasCustomColor = typeof color === 'string' && color !== DEFAULT_TERMINAL_TAB_COLOR

  const style = useMemo(() => {
    return {
      '--tab-color': color || '#4db5ff',
    } as React.CSSProperties
  }, [color])

  const onClose = (event: React.MouseEvent) => {
    event.stopPropagation()
    props.api.close()
  }

  const onDoubleClick = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const customEvent = new CustomEvent('termide-edit-terminal', {
      bubbles: true,
      detail: { panelId: props.api.id },
    })
    event.currentTarget.dispatchEvent(customEvent)
  }

  return (
    <div
      className={`terminal-tab-content${isFocused ? ' terminal-tab-content--active' : ''}`}
      style={style}
      data-panel-id={props.api.id}
      data-has-color={hasCustomColor}
      title="Double-click to edit tab"
      onDoubleClick={onDoubleClick}
    >
      {emoji && <span className="terminal-tab-emoji">{emoji}</span>}
      <span className="terminal-tab-title">{title}</span>
      <button
        type="button"
        className="terminal-tab-close"
        onClick={onClose}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label="Close terminal"
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}
