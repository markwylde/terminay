import type { CSSProperties, MouseEvent, ReactNode } from 'react'

type DockTabChromeProps = {
  title?: string
  panelId: string
  isActive: boolean
  hasCustomColor?: boolean
  activityState?: 'viewed' | 'recent' | 'unviewed'
  titleAttribute?: string
  closeAriaLabel: string
  style?: CSSProperties
  onClose: (event: MouseEvent<HTMLButtonElement>) => void
  onClick?: (event: MouseEvent<HTMLDivElement>) => void
  onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void
  leading?: ReactNode
  beforeTitle?: ReactNode
  afterTitle?: ReactNode
}

export function DockTabChrome({
  title,
  panelId,
  isActive,
  hasCustomColor = false,
  activityState,
  titleAttribute,
  closeAriaLabel,
  style,
  onClose,
  onClick,
  onDoubleClick,
  leading,
  beforeTitle,
  afterTitle,
}: DockTabChromeProps) {
  const resolvedTitle = title ?? 'Untitled'

  return (
    <div
      className={`terminal-tab-content${isActive ? ' terminal-tab-content--active' : ''}`}
      data-panel-id={panelId}
      data-has-color={hasCustomColor}
      data-terminal-activity={activityState}
      title={titleAttribute ?? resolvedTitle}
      style={style}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      {leading}
      {beforeTitle}
      <span className="terminal-tab-title">{resolvedTitle}</span>
      {afterTitle}
      <button
        type="button"
        className="terminal-tab-close"
        onClick={onClose}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label={closeAriaLabel}
      >
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}
