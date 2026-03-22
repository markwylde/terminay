import { IDockviewPanelHeaderProps } from 'dockview'
import { useMemo } from 'react'

export type TerminalPanelParams = {
  sessionId: string
  color?: string
  emoji?: string
}

export function TerminalTab(props: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const title = props.api.title
  const params = props.params
  const { color, emoji } = params || {}

  const style = useMemo(() => {
    const finalColor = color || '#0a0a0a'
    const alpha = props.api.isActive ? 0.4 : 0.2
    return {
      backgroundColor: hexToRgba(finalColor, alpha),
      '--tab-color': color || 'transparent',
      height: '100%',
      width: '100%',
    } as React.CSSProperties
  }, [color, props.api.isActive])

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
      className="terminal-tab-content"
      style={style}
      data-panel-id={props.api.id}
      data-has-color={!!color}
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
        ×
      </button>
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const normalized =
    value.length === 3
      ? value
          .split('')
          .map((char) => `${char}${char}`)
          .join('')
      : value

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `rgba(77, 181, 255, ${alpha})`
  }

  const r = parseInt(normalized.slice(0, 2), 16)
  const g = parseInt(normalized.slice(2, 4), 16)
  const b = parseInt(normalized.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
