import type { IDockviewPanelHeaderProps } from 'dockview'
import { CSSProperties, MouseEvent, useMemo } from 'react'
import { DockTabChrome } from '../DockTabChrome'
import type { FilePanelInstanceParams } from './types'

const DEFAULT_TAB_COLOR = '#0a0a0a'

export function FileTab(props: IDockviewPanelHeaderProps<FilePanelInstanceParams>) {
  const isDirty = props.params?.isDirty === true
  const isFocused = props.params?.isFocused === true
  const color = props.params?.color
  const emoji = props.params?.emoji
  const hasCustomColor = typeof color === 'string' && color !== DEFAULT_TAB_COLOR
  const style = useMemo(() => {
    return {
      '--tab-color': color || '#717b85',
    } as CSSProperties
  }, [color])
  const onClose = (event: MouseEvent) => {
    event.stopPropagation()
    props.api.close()
  }
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const customEvent = new CustomEvent('termide-edit-terminal', {
      bubbles: true,
      detail: { panelId: props.api.id },
    })
    event.currentTarget.dispatchEvent(customEvent)
  }

  return (
    <DockTabChrome
      title={props.api.title}
      panelId={props.api.id}
      isActive={isFocused}
      hasCustomColor={hasCustomColor}
      titleAttribute="Double-click to edit tab"
      style={style}
      onDoubleClick={onDoubleClick}
      closeAriaLabel="Close file tab"
      onClose={onClose}
      leading={emoji ? <span className="terminal-tab-emoji">{emoji}</span> : null}
      beforeTitle={
        isDirty ? (
          <span className="file-tab__dirty file-tab__dirty--visible" aria-hidden="true">
            ●
          </span>
        ) : null
      }
    />
  )
}
