import { IDockviewPanelHeaderProps } from 'dockview'
import { CSSProperties, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  LoaderCircle,
  Trash2,
  XCircle,
} from 'lucide-react'
import { DockTabChrome } from './DockTabChrome'

export type TerminalTabMacroRunStep = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'canceled' | 'failed'
  title: string
}

export type TerminalTabMacroRun = {
  id: string
  startedAt: number
  status: 'running' | 'canceling' | 'completed' | 'canceled' | 'failed'
  steps: TerminalTabMacroRunStep[]
  title: string
}

export type TerminalActivityState = 'viewed' | 'recent' | 'unviewed'

export type TerminalPanelParams = {
  sessionId: string
  terminalActivityState?: TerminalActivityState
  color?: string
  emoji?: string
  inheritsProjectColor?: boolean
  isFocused?: boolean
  onCancelMacroRun?: (runId: string) => void
  onClearFinishedMacroRuns?: () => void
  onClearMacroRun?: (runId: string) => void
  macroRuns?: TerminalTabMacroRun[]
  projectColor?: string
}

const DEFAULT_TERMINAL_TAB_COLOR = '#0a0a0a'

export function TerminalTab(props: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const title = props.api.title
  const params = props.params
  const { color, emoji, macroRuns = [], onCancelMacroRun, onClearFinishedMacroRuns, onClearMacroRun } = params || {}
  const terminalActivityState = params?.terminalActivityState ?? 'viewed'
  const isFocused = params?.isFocused === true
  const hasCustomColor = typeof color === 'string' && color !== DEFAULT_TERMINAL_TAB_COLOR
  const [isMacroMenuOpen, setIsMacroMenuOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null)
  const [expandedRunIds, setExpandedRunIds] = useState<Record<string, boolean>>({})
  const macroMenuRef = useRef<HTMLDivElement | null>(null)
  const macroTriggerRef = useRef<HTMLButtonElement | null>(null)
  const macroPopoverRef = useRef<HTMLDivElement | null>(null)
  const activeMacroCount = macroRuns.filter((run) => run.status === 'running' || run.status === 'canceling').length
  const finishedMacroCount = macroRuns.filter((run) => run.status !== 'running' && run.status !== 'canceling').length
  const hasMacroHistory = macroRuns.length > 0

  const style = useMemo(() => {
    return {
      '--tab-color': color || '#717b85',
    } as CSSProperties
  }, [color])

  useEffect(() => {
    if (!hasMacroHistory) {
      setIsMacroMenuOpen(false)
    }
  }, [hasMacroHistory])

  useEffect(() => {
    const nextExpanded: Record<string, boolean> = {}

    for (const run of macroRuns) {
      if (run.status === 'running' || run.status === 'canceling') {
        nextExpanded[run.id] = true
      }
    }

    setExpandedRunIds((current) => ({
      ...current,
      ...nextExpanded,
    }))
  }, [macroRuns])

  useEffect(() => {
    if (!isMacroMenuOpen) {
      return
    }

    let ownerWindow: Window
    try {
      ownerWindow = props.api.getWindow()
    } catch {
      ownerWindow = window
    }

    const updatePosition = () => {
      const trigger = macroTriggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const popoverWidth = 320
      const margin = 8
      const left = Math.min(
        Math.max(margin, rect.right - popoverWidth),
        Math.max(margin, ownerWindow.innerWidth - popoverWidth - margin),
      )
      const top = rect.bottom + 8

      setPopoverPosition({ left, top })
    }

    updatePosition()

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      const container = macroMenuRef.current
      const popover = macroPopoverRef.current
      if (container?.contains(target) || popover?.contains(target)) {
        return
      }

      setIsMacroMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMacroMenuOpen(false)
      }
    }

    ownerWindow.addEventListener('pointerdown', onPointerDown)
    ownerWindow.addEventListener('keydown', onKeyDown)
    ownerWindow.addEventListener('resize', updatePosition)
    ownerWindow.addEventListener('scroll', updatePosition, true)

    return () => {
      ownerWindow.removeEventListener('pointerdown', onPointerDown)
      ownerWindow.removeEventListener('keydown', onKeyDown)
      ownerWindow.removeEventListener('resize', updatePosition)
      ownerWindow.removeEventListener('scroll', updatePosition, true)
    }
  }, [isMacroMenuOpen, props.api])

  const onClose = (event: MouseEvent) => {
    event.stopPropagation()
    props.api.close()
  }

  const onClick = () => {
    const sessionId = params?.sessionId
    if (!sessionId) {
      return
    }

    window.dispatchEvent(
      new CustomEvent('termide-terminal-user-input', {
        detail: { sessionId },
      }),
    )
  }

  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const customEvent = new CustomEvent('termide-edit-terminal', {
      bubbles: true,
      detail: { panelId: props.api.id },
    })
    event.currentTarget.dispatchEvent(customEvent)
  }

  const onToggleMacroMenu = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsMacroMenuOpen((current) => !current)
  }

  const toggleRunExpanded = (runId: string) => {
    setExpandedRunIds((current) => ({
      ...current,
      [runId]: !current[runId],
    }))
  }

  const sortedRuns = useMemo(() => {
    return [...macroRuns].sort((a, b) => {
      const aIsActive = a.status === 'running' || a.status === 'canceling'
      const bIsActive = b.status === 'running' || b.status === 'canceling'
      if (aIsActive !== bIsActive) {
        return aIsActive ? -1 : 1
      }

      return b.startedAt - a.startedAt
    })
  }, [macroRuns])

  let portalRoot: HTMLElement | null = null
  try {
    portalRoot = props.api.getWindow().document.body
  } catch {
    portalRoot = document.body
  }

  const renderStepIcon = (status: TerminalTabMacroRunStep['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="terminal-tab-macro-step__icon terminal-tab-macro-step__icon--completed" aria-hidden="true" />
      case 'running':
        return <LoaderCircle className="terminal-tab-macro-step__icon terminal-tab-macro-step__icon--running" aria-hidden="true" />
      case 'failed':
        return <AlertCircle className="terminal-tab-macro-step__icon terminal-tab-macro-step__icon--failed" aria-hidden="true" />
      case 'canceled':
        return <XCircle className="terminal-tab-macro-step__icon terminal-tab-macro-step__icon--canceled" aria-hidden="true" />
      case 'pending':
        return <Circle className="terminal-tab-macro-step__icon terminal-tab-macro-step__icon--pending" aria-hidden="true" />
    }
  }

  const macroTrigger = hasMacroHistory ? (
    <div
      ref={macroMenuRef}
      className={`terminal-tab-macro-menu${isMacroMenuOpen ? ' terminal-tab-macro-menu--open' : ''}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        ref={macroTriggerRef}
        type="button"
        className="terminal-tab-macro-trigger"
        onClick={onToggleMacroMenu}
        aria-label={`Show macro queue (${macroRuns.length})`}
        aria-haspopup="menu"
        aria-expanded={isMacroMenuOpen}
        title={activeMacroCount > 0 ? `${activeMacroCount} running macro${activeMacroCount === 1 ? '' : 's'}` : `${macroRuns.length} recent macro run${macroRuns.length === 1 ? '' : 's'}`}
      >
        <span
          className={`terminal-tab-macro-spinner${activeMacroCount === 0 ? ' terminal-tab-macro-spinner--idle' : ''}${macroRuns.some((run) => run.status === 'canceling') ? ' terminal-tab-macro-spinner--canceling' : ''}`}
          aria-hidden="true"
        />
        <span className="terminal-tab-macro-count">{activeMacroCount}</span>
      </button>
    </div>
  ) : null

  return (
    <>
      <DockTabChrome
        title={title}
        panelId={props.api.id}
        isActive={isFocused}
        hasCustomColor={hasCustomColor}
        activityState={terminalActivityState}
        titleAttribute="Double-click to edit tab"
        style={style}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        closeAriaLabel="Close terminal"
        onClose={onClose}
        leading={emoji ? <span className="terminal-tab-emoji">{emoji}</span> : null}
        afterTitle={macroTrigger}
      />
      {isMacroMenuOpen && portalRoot && popoverPosition
        ? createPortal(
            <div
              ref={macroPopoverRef}
              className="terminal-tab-macro-popover"
              style={{
                left: popoverPosition.left,
                top: popoverPosition.top,
              }}
              role="menu"
              aria-label="Macro queue"
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              <div className="terminal-tab-macro-popover__header">
                <div className="terminal-tab-macro-popover__label">Macro queue</div>
                {finishedMacroCount > 0 ? (
                  <button
                    type="button"
                    className="terminal-tab-macro-popover__clear"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      onClearFinishedMacroRuns?.()
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="terminal-tab-macro-popover__list">
                {sortedRuns.map((run) => {
                  const isExpanded = expandedRunIds[run.id] ?? false
                  const isActive = run.status === 'running' || run.status === 'canceling'

                  return (
                    <div key={run.id} className="terminal-tab-macro-run">
                      <button
                        type="button"
                        className="terminal-tab-macro-run__header"
                        onClick={() => toggleRunExpanded(run.id)}
                      >
                        {isExpanded ? (
                          <ChevronDown className="terminal-tab-macro-run__expand" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="terminal-tab-macro-run__expand" aria-hidden="true" />
                        )}
                        <span className="terminal-tab-macro-run__title">{run.title}</span>
                        {!isActive ? (
                          <button
                            type="button"
                            className="terminal-tab-macro-run__clear"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              onClearMacroRun?.(run.id)
                            }}
                            aria-label={`Clear ${run.title}`}
                            title="Clear run"
                          >
                            <Trash2 className="terminal-tab-macro-run__clear-icon" aria-hidden="true" />
                          </button>
                        ) : null}
                        <span className={`terminal-tab-macro-run__status terminal-tab-macro-run__status--${run.status}`}>
                          {run.status}
                        </span>
                      </button>
                      {isExpanded ? (
                        <div className="terminal-tab-macro-run__body">
                          <div className="terminal-tab-macro-steps">
                            {run.steps.map((step) => (
                              <div key={step.id} className="terminal-tab-macro-step">
                                <span className="terminal-tab-macro-step__marker" aria-hidden="true">
                                  {renderStepIcon(step.status)}
                                </span>
                                <span className={`terminal-tab-macro-step__title terminal-tab-macro-step__title--${step.status}`}>
                                  {step.title}
                                </span>
                              </div>
                            ))}
                          </div>
                          {isActive ? (
                            <button
                              type="button"
                              className="terminal-tab-macro-popover__cancel"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                onCancelMacroRun?.(run.id)
                              }}
                              disabled={run.status === 'canceling'}
                            >
                              {run.status === 'canceling' ? 'Canceling' : 'Cancel macro'}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>,
            portalRoot,
          )
        : null}
    </>
  )
}
