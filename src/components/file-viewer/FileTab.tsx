import type { IDockviewPanelHeaderProps } from 'dockview'
import { MouseEvent } from 'react'
import { DockTabChrome } from '../DockTabChrome'
import type { FilePanelInstanceParams } from './types'

export function FileTab(props: IDockviewPanelHeaderProps<FilePanelInstanceParams>) {
  const isDirty = props.params?.isDirty === true
  const isFocused = props.params?.isFocused === true
  const onClose = (event: MouseEvent) => {
    event.stopPropagation()
    props.api.close()
  }

  return (
    <DockTabChrome
      title={props.api.title}
      panelId={props.api.id}
      isActive={isFocused}
      titleAttribute={props.api.title}
      closeAriaLabel="Close file tab"
      onClose={onClose}
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
