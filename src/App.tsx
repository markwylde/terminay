import {
  FormEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, Reorder } from 'framer-motion'
import data from '@emoji-mart/data'
import Picker from '@emoji-mart/react'
import { DockviewReact, getPanelData } from 'dockview'
import type { Direction, DockviewApi, DockviewReadyEvent } from 'dockview'
import type { AppCommand } from './types/termide'
import { TerminalPanel } from './components/TerminalPanel'
import { TerminalTab } from './components/TerminalTab'
import type { TerminalPanelParams } from './components/TerminalTab'
import './App.css'

type SplitDirection = Extract<Direction, 'below' | 'right'>
type AddTerminalOptions = {
  direction?: SplitDirection
  groupId?: string
}

type ProjectTab = {
  id: string
  title: string
  color: string
  emoji: string
}

type ProjectWorkspaceHandle = {
  executeCommand: (command: AppCommand) => void
}

type ProjectWorkspaceProps = {
  isActive: boolean
  isMac: boolean
  popoutUrl: string
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.trim().replace('#', '')
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

  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const ProjectWorkspace = forwardRef<ProjectWorkspaceHandle, ProjectWorkspaceProps>(
  ({ isActive, isMac, popoutUrl }, ref) => {
    const dockviewApiRef = useRef<DockviewApi | null>(null)
    const panelSessionMapRef = useRef<Map<string, string>>(new Map())
    const terminalCounterRef = useRef(0)
    const draggingTransferRef = useRef<{ panelId?: string; groupId: string } | null>(null)
    const workspaceRef = useRef<HTMLElement | null>(null)
    const [errorText, setErrorText] = useState<string | null>(null)

    const [editingTerminalPanelId, setEditingTerminalPanelId] = useState<string | null>(null)
    const [editingTerminalTitle, setEditingTerminalTitle] = useState('')
    const [editingTerminalEmoji, setEditingTerminalEmoji] = useState('')
    const [editingTerminalColor, setEditingTerminalColor] = useState('#4db5ff')
    const [isTerminalEmojiPickerOpen, setIsTerminalEmojiPickerOpen] = useState(false)
    const terminalEmojiPickerContainerRef = useRef<HTMLDivElement | null>(null)

    const closeTerminalEditModal = useCallback(() => {
      setEditingTerminalPanelId(null)
      setIsTerminalEmojiPickerOpen(false)
    }, [])

    const openTerminalEdit = useCallback((panelId: string) => {
      const api = dockviewApiRef.current
      if (!api) {
        return
      }

      const panel = api.getPanel(panelId)
      if (panel) {
        setEditingTerminalPanelId(panelId)
        setEditingTerminalTitle(panel.title ?? 'Terminal')
        setEditingTerminalEmoji(panel.params?.emoji ?? '')
        setEditingTerminalColor(panel.params?.color ?? '#0a0a0a')
        setIsTerminalEmojiPickerOpen(false)
      }
    }, [])

    const saveTerminalEdits = useCallback(
      (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const api = dockviewApiRef.current
        if (!api || !editingTerminalPanelId) {
          return
        }

        const panel = api.getPanel(editingTerminalPanelId)
        if (panel) {
          const nextTitle =
            editingTerminalTitle.trim().length > 0
              ? editingTerminalTitle.trim()
              : (panel.title ?? 'Terminal')
          const nextEmoji = editingTerminalEmoji.trim()
          const nextColor = editingTerminalColor

          panel.api.setTitle(nextTitle)
          panel.api.updateParameters({
            emoji: nextEmoji,
            color: nextColor,
          })
        }

        closeTerminalEditModal()
      },
      [closeTerminalEditModal, editingTerminalColor, editingTerminalEmoji, editingTerminalPanelId, editingTerminalTitle],
    )

    const addTerminal = useCallback(async (options?: AddTerminalOptions) => {
      const api = dockviewApiRef.current
      if (!api) {
        return
      }

      try {
        const { id: sessionId } = await window.termide.createTerminal()

        terminalCounterRef.current += 1
        const panelId = `terminal-${terminalCounterRef.current}`

        const panel = api.addPanel<TerminalPanelParams>({
          id: panelId,
          title: `Terminal ${terminalCounterRef.current}`,
          component: 'terminal',
          tabComponent: 'terminalTab',
          params: { sessionId, color: '#0a0a0a' },
          position:
            options?.groupId && api.getGroup(options.groupId)
              ? {
                  referenceGroup: options.groupId,
                  direction: 'within',
                }
              : options?.direction && api.activePanel
                ? {
                    referencePanel: api.activePanel,
                    direction: options.direction,
                  }
                : undefined,
        })

        panelSessionMapRef.current.set(panel.id, sessionId)
        panel.api.setActive()
        setErrorText(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setErrorText(message)
      }
    }, [])

    const closeActivePanel = useCallback(() => {
      dockviewApiRef.current?.activePanel?.api.close()
    }, [])

    const popoutActivePanel = useCallback(async () => {
      const api = dockviewApiRef.current
      const activePanel = api?.activePanel

      if (!api || !activePanel) {
        return
      }

      await api.addPopoutGroup(activePanel, {
        popoutUrl,
      })
    }, [popoutUrl])

    useImperativeHandle(
      ref,
      () => ({
        executeCommand(command: AppCommand) {
          switch (command) {
            case 'new-terminal':
              void addTerminal({})
              break
            case 'split-horizontal':
              void addTerminal({ direction: 'below' })
              break
            case 'split-vertical':
              void addTerminal({ direction: 'right' })
              break
            case 'popout-active':
              void popoutActivePanel()
              break
            case 'close-active':
              closeActivePanel()
              break
            default:
              break
          }
        },
      }),
      [addTerminal, closeActivePanel, popoutActivePanel],
    )

    const handleReady = useCallback(
      (event: DockviewReadyEvent) => {
        dockviewApiRef.current = event.api

        event.api.onDidRemovePanel((panel) => {
          const sessionId = panelSessionMapRef.current.get(panel.id)

          if (!sessionId) {
            return
          }

          panelSessionMapRef.current.delete(panel.id)
          window.termide.killTerminal(sessionId)
        })

        void addTerminal({})
      },
      [addTerminal],
    )

    useEffect(() => {
      const cleanupByWindow = new Map<Window, () => void>()
      const apiDisposables: Array<{ dispose: () => void }> = []

      const addTerminalInHeaderSpace = (
        targetWindow: Window,
        target: HTMLElement | null,
        point?: { x: number; y: number },
      ) => {
        const api = dockviewApiRef.current
        if (!api) {
          return
        }

        let groupElement: HTMLElement | null = target?.closest('.dv-groupview') as HTMLElement | null

        const emptyHeaderSpace = target?.closest('.dv-void-container') as HTMLElement | null
        if (emptyHeaderSpace) {
          groupElement = emptyHeaderSpace.closest('.dv-groupview') as HTMLElement | null
        }

        if (!groupElement && point) {
          const hitElements = targetWindow.document.elementsFromPoint(point.x, point.y)
          const emptySpaceFromPoint = hitElements.find((element): element is HTMLElement =>
            element instanceof HTMLElement && element.classList.contains('dv-void-container'),
          )

          if (emptySpaceFromPoint) {
            groupElement = emptySpaceFromPoint.closest('.dv-groupview') as HTMLElement | null
          }
        }

        if (!groupElement && point) {
          const hitElements = targetWindow.document.elementsFromPoint(point.x, point.y)
          const headerContainer = hitElements.find((element): element is HTMLElement =>
            element instanceof HTMLElement && element.classList.contains('dv-tabs-and-actions-container'),
          )

          if (headerContainer) {
            const headerRect = headerContainer.getBoundingClientRect()
            const inHeader =
              point.x >= headerRect.left &&
              point.x <= headerRect.right &&
              point.y >= headerRect.top &&
              point.y <= headerRect.bottom

            const tabsContainer = headerContainer.querySelector('.dv-tabs-container') as HTMLElement | null
            const rightActions = headerContainer.querySelector('.dv-right-actions-container') as HTMLElement | null

            const inTabs = (() => {
              if (!tabsContainer) {
                return false
              }

              const tabsRect = tabsContainer.getBoundingClientRect()
              return (
                point.x >= tabsRect.left &&
                point.x <= tabsRect.right &&
                point.y >= tabsRect.top &&
                point.y <= tabsRect.bottom
              )
            })()

            const inRightActions = (() => {
              if (!rightActions) {
                return false
              }

              const actionsRect = rightActions.getBoundingClientRect()
              return (
                point.x >= actionsRect.left &&
                point.x <= actionsRect.right &&
                point.y >= actionsRect.top &&
                point.y <= actionsRect.bottom
              )
            })()

            if (inHeader && !inTabs && !inRightActions) {
              groupElement = headerContainer.closest('.dv-groupview') as HTMLElement | null
            }
          }
        }

        if (!groupElement) {
          return
        }

        const group = api.groups.find((candidate) => candidate.element.contains(groupElement))
        if (!group) {
          return
        }

        void addTerminal({ groupId: group.id })
      }

      const ensureHeaderButtons = (targetWindow: Window) => {
        const containers = targetWindow.document.querySelectorAll<HTMLElement>('.dv-void-container')

        for (const container of containers) {
          if (container.querySelector('.termide-add-tab-button')) {
            continue
          }

          const button = targetWindow.document.createElement('button')
          button.type = 'button'
          button.className = 'termide-add-tab-button'
          button.setAttribute('aria-label', 'New terminal tab')
          button.title = 'New terminal tab'
          button.textContent = '+'
          container.appendChild(button)
        }
      }

      const addListenersForWindow = (targetWindow: Window) => {
        if (cleanupByWindow.has(targetWindow)) {
          return
        }

        ensureHeaderButtons(targetWindow)

        const onClick = (event: MouseEvent) => {
          const target = event.target as HTMLElement | null
          const addTabButton = target?.closest('.termide-add-tab-button')

          if (!addTabButton) {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          addTerminalInHeaderSpace(targetWindow, target, { x: event.clientX, y: event.clientY })
        }

        const onDblClick = (event: MouseEvent) => {
          const target = event.target as HTMLElement | null
          const isAddButtonClick = !!target?.closest('.termide-add-tab-button')
          if (isAddButtonClick) {
            return
          }

          const isTabClick = !!target?.closest('.dv-tab')
          if (isTabClick) {
            const terminalTab = target?.closest('.terminal-tab-content') as HTMLElement | null
            if (terminalTab) {
              const panelId = terminalTab.getAttribute('data-panel-id')
              if (panelId) {
                openTerminalEdit(panelId)
              }
            }
            return
          }

          addTerminalInHeaderSpace(targetWindow, target, { x: event.clientX, y: event.clientY })
        }

        const onEditTerminal = (event: Event) => {
          const customEvent = event as CustomEvent<{ panelId: string }>
          if (customEvent.detail?.panelId) {
            openTerminalEdit(customEvent.detail.panelId)
          }
        }

        const onDragStart = () => {
          targetWindow.requestAnimationFrame(() => {
            const data = getPanelData()
            if (!data) {
              return
            }

            draggingTransferRef.current = {
              panelId: data.panelId ?? undefined,
              groupId: data.groupId,
            }
          })
        }

        const onDragEnd = (event: DragEvent) => {
          const transfer = draggingTransferRef.current
          draggingTransferRef.current = null

          if (!transfer) {
            return
          }

          const droppedOutsideWindow =
            event.clientX <= 0 ||
            event.clientY <= 0 ||
            event.clientX >= targetWindow.innerWidth ||
            event.clientY >= targetWindow.innerHeight

          if (!droppedOutsideWindow) {
            return
          }

          const api = dockviewApiRef.current
          if (!api) {
            return
          }

          const item = transfer.panelId
            ? api.getPanel(transfer.panelId)
            : api.getGroup(transfer.groupId)?.activePanel
          if (!item) {
            return
          }

          void api.addPopoutGroup(item, { popoutUrl })
        }

        targetWindow.addEventListener('click', onClick, true)
        targetWindow.addEventListener('dblclick', onDblClick, true)
        targetWindow.addEventListener('termide-edit-terminal', onEditTerminal)
        targetWindow.addEventListener('dragstart', onDragStart, true)
        targetWindow.addEventListener('dragend', onDragEnd, true)

        cleanupByWindow.set(targetWindow, () => {
          targetWindow.removeEventListener('click', onClick, true)
          targetWindow.removeEventListener('dblclick', onDblClick, true)
          targetWindow.removeEventListener('termide-edit-terminal', onEditTerminal)
          targetWindow.removeEventListener('dragstart', onDragStart, true)
          targetWindow.removeEventListener('dragend', onDragEnd, true)
        })
      }

      const collectDockviewWindows = (): Set<Window> => {
        const result = new Set<Window>([window])
        const api = dockviewApiRef.current

        if (!api) {
          return result
        }

        for (const group of api.groups) {
          const panel = group.activePanel ?? group.panels[0]
          if (!panel) {
            continue
          }

          try {
            result.add(panel.api.getWindow())
          } catch {
            // Ignore transient windows during popout transitions.
          }
        }

        return result
      }

      const reconcileWindowListeners = () => {
        const liveWindows = collectDockviewWindows()

        for (const targetWindow of liveWindows) {
          addListenersForWindow(targetWindow)
          ensureHeaderButtons(targetWindow)
        }

        for (const [targetWindow, cleanup] of cleanupByWindow.entries()) {
          if (liveWindows.has(targetWindow)) {
            continue
          }

          cleanup()
          cleanupByWindow.delete(targetWindow)
        }
      }

      reconcileWindowListeners()

      const api = dockviewApiRef.current
      if (api) {
        apiDisposables.push(
          api.onDidAddGroup(reconcileWindowListeners),
          api.onDidRemoveGroup(reconcileWindowListeners),
          api.onDidMovePanel(reconcileWindowListeners),
          api.onDidActivePanelChange(reconcileWindowListeners),
        )
      }

      const interval = window.setInterval(reconcileWindowListeners, 500)

      return () => {
        window.clearInterval(interval)
        for (const disposable of apiDisposables) {
          disposable.dispose()
        }
        for (const cleanup of cleanupByWindow.values()) {
          cleanup()
        }
        cleanupByWindow.clear()
      }
    }, [addTerminal, openTerminalEdit, popoutUrl])

    useEffect(() => {
      if (!isActive) {
        return
      }

      const api = dockviewApiRef.current
      const workspace = workspaceRef.current
      if (!api || !workspace) {
        return
      }

      const { clientWidth, clientHeight } = workspace
      if (clientWidth > 0 && clientHeight > 0) {
        api.layout(clientWidth, clientHeight)
      }
    }, [isActive])

    useEffect(() => {
      if (!editingTerminalPanelId) {
        return
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          closeTerminalEditModal()
        }
      }

      window.addEventListener('keydown', onKeyDown)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
      }
    }, [closeTerminalEditModal, editingTerminalPanelId])

    useEffect(() => {
      if (!isTerminalEmojiPickerOpen) {
        return
      }

      const onPointerDown = (event: MouseEvent) => {
        const container = terminalEmojiPickerContainerRef.current
        if (!container) {
          return
        }

        const target = event.target as Node
        if (container.contains(target)) {
          return
        }

        setIsTerminalEmojiPickerOpen(false)
      }

      window.addEventListener('mousedown', onPointerDown)
      return () => {
        window.removeEventListener('mousedown', onPointerDown)
      }
    }, [isTerminalEmojiPickerOpen])

    return (
      <section
        className={`project-workspace${isActive ? ' project-workspace--active' : ''}${isMac ? ' project-workspace--macos' : ''}`}
      >
        {errorText ? <div className="error-banner">Terminal error: {errorText}</div> : null}

        <main
          ref={(element) => {
            workspaceRef.current = element
          }}
          className="workspace dockview-theme-dark"
        >
          <DockviewReact
            components={{ terminal: TerminalPanel }}
            tabComponents={{ terminalTab: TerminalTab }}
            popoutUrl={popoutUrl}
            onReady={handleReady}
            floatingGroupBounds="boundedWithinViewport"
          />
        </main>

        {editingTerminalPanelId ? (
          <div className="project-edit-modal-backdrop" onClick={closeTerminalEditModal}>
            <form
              className="project-edit-modal"
              onSubmit={saveTerminalEdits}
              onClick={(event) => event.stopPropagation()}
            >
              <h2>Edit Terminal Tab</h2>

              <label>
                Name
                <div className="project-name-row">
                  <div
                    ref={(element) => {
                      terminalEmojiPickerContainerRef.current = element
                    }}
                    className="emoji-picker-field"
                  >
                    <button
                      type="button"
                      className="emoji-picker-trigger"
                      onClick={() => setIsTerminalEmojiPickerOpen((current) => !current)}
                      title="Pick emoji"
                      aria-label="Pick emoji"
                    >
                      <span aria-hidden="true">{editingTerminalEmoji || '🖥️'}</span>
                    </button>
                    {isTerminalEmojiPickerOpen ? (
                      <div className="emoji-picker-popover">
                        <Picker
                          data={data}
                          onEmojiSelect={(emoji: { native?: string }) => {
                            if (!emoji.native) {
                              return
                            }

                            setEditingTerminalEmoji(emoji.native)
                            setIsTerminalEmojiPickerOpen(false)
                          }}
                          previewPosition="none"
                          skinTonePosition="none"
                          theme="dark"
                        />
                      </div>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    value={editingTerminalTitle}
                    onChange={(event) => setEditingTerminalTitle(event.target.value)}
                    placeholder="Terminal name"
                    autoFocus
                  />
                </div>
              </label>

              <label>
                Tab Color
                <input
                  type="color"
                  value={editingTerminalColor}
                  onChange={(event) => setEditingTerminalColor(event.target.value)}
                />
              </label>

              <div
                className="project-edit-preview"
                style={{
                  borderTopColor: editingTerminalColor,
                  backgroundColor: hexToRgba(editingTerminalColor, 0.2),
                }}
              >
                <span aria-hidden="true">{editingTerminalEmoji || '🖥️'}</span>
                <span>{editingTerminalTitle.trim() || 'Untitled Terminal'}</span>
              </div>

              <div className="project-edit-actions">
                <button type="button" onClick={closeTerminalEditModal}>
                  Cancel
                </button>
                <button type="submit">Save</button>
              </div>
            </form>
          </div>
        ) : null}
      </section>
    )
  },
)

ProjectWorkspace.displayName = 'ProjectWorkspace'

function App() {
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const popoutUrl = useMemo(() => new URL('popout.html', window.location.href).toString(), [])
  const projectCounterRef = useRef(1)
  const workspaceRefs = useRef(new Map<string, ProjectWorkspaceHandle | null>())

  const [projects, setProjects] = useState<ProjectTab[]>([
    { id: 'project-1', title: 'Project 1', color: '#4db5ff', emoji: '🖥️' },
  ])
  const [activeProjectId, setActiveProjectId] = useState('project-1')
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingEmoji, setEditingEmoji] = useState('')
  const [editingColor, setEditingColor] = useState('#4db5ff')
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false)
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null)
  const emojiPickerContainerRef = useRef<HTMLDivElement | null>(null)
  const closeEditModal = useCallback(() => {
    setEditingProjectId(null)
    setIsEmojiPickerOpen(false)
  }, [])

  const addProject = useCallback(() => {
    projectCounterRef.current += 1
    const nextProject: ProjectTab = {
      id: `project-${projectCounterRef.current}`,
      title: `Project ${projectCounterRef.current}`,
      color: '#4db5ff',
      emoji: '🖥️',
    }

    setProjects((current) => [...current, nextProject])
    setActiveProjectId(nextProject.id)
  }, [])

  const closeProject = useCallback(
    (projectId: string) => {
      setProjects((current) => {
        if (current.length <= 1) {
          return current
        }

        const index = current.findIndex((project) => project.id === projectId)
        if (index === -1) {
          return current
        }

        const next = current.filter((project) => project.id !== projectId)
        if (activeProjectId === projectId) {
          const fallbackIndex = Math.max(0, index - 1)
          setActiveProjectId(next[fallbackIndex]?.id ?? next[0].id)
        }

        if (editingProjectId === projectId) {
          closeEditModal()
        }

        return next
      })
    },
    [activeProjectId, closeEditModal, editingProjectId],
  )

  const onReorder = (newOrder: ProjectTab[]) => {
    setProjects(newOrder)
  }

  const openEditProjectModal = useCallback((projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) {
      return
    }

    setEditingProjectId(project.id)
    setEditingTitle(project.title)
    setEditingEmoji(project.emoji)
    setEditingColor(project.color)
    setIsEmojiPickerOpen(false)
  }, [projects])

  const saveProjectEdits = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!editingProjectId) {
        return
      }

      const nextTitle = editingTitle.trim().length > 0 ? editingTitle.trim() : 'Untitled Project'
      const nextEmoji = editingEmoji.trim().length > 0 ? editingEmoji.trim() : '🖥️'

      setProjects((current) =>
        current.map((project) =>
          project.id === editingProjectId
            ? {
                ...project,
                title: nextTitle,
                emoji: nextEmoji,
                color: editingColor,
              }
            : project,
        ),
      )

      closeEditModal()
    },
    [closeEditModal, editingColor, editingEmoji, editingProjectId, editingTitle],
  )

  const executeCommandOnActiveProject = useCallback(
    (command: AppCommand) => {
      workspaceRefs.current.get(activeProjectId)?.executeCommand(command)
    },
    [activeProjectId],
  )

  useEffect(() => {
    const unsubscribeCommand = window.termide.onAppCommand(executeCommandOnActiveProject)

    return () => {
      unsubscribeCommand()
    }
  }, [executeCommandOnActiveProject])

  useEffect(() => {
    if (!editingProjectId) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeEditModal()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [closeEditModal, editingProjectId])

  useEffect(() => {
    if (!isEmojiPickerOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const container = emojiPickerContainerRef.current
      if (!container) {
        return
      }

      const target = event.target as Node
      if (container.contains(target)) {
        return
      }

      setIsEmojiPickerOpen(false)
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [isEmojiPickerOpen])

  return (
    <div className={`app-shell${isMac ? ' app-shell--macos' : ''}`}>
      <header className="project-tabbar">
        <Reorder.Group
          axis="x"
          values={projects}
          onReorder={onReorder}
          className="project-tabbar-list"
        >
          <AnimatePresence initial={false}>
            {projects.map((project) => (
              <Reorder.Item
                key={project.id}
                value={project}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`project-tab${project.id === activeProjectId ? ' project-tab--active' : ''}${project.id === draggingProjectId ? ' project-tab--dragging' : ''}`}
                style={project.id === activeProjectId ? { backgroundColor: hexToRgba(project.color, 0.2) } : undefined}
                onDragStart={() => setDraggingProjectId(project.id)}
                onDragEnd={() => setDraggingProjectId(null)}
                onClick={() => setActiveProjectId(project.id)}
                onDoubleClick={() => openEditProjectModal(project.id)}
                whileDrag={{ scale: 1.05, zIndex: 50 }}
                title="Double-click to edit tab"
              >
                <span className="project-tab-main">
                  <span className="project-tab-emoji" aria-hidden="true">
                    {project.emoji}
                  </span>
                  <span className="project-tab-title">{project.title}</span>
                </span>
                <button
                  type="button"
                  className="project-tab-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeProject(project.id)
                  }}
                  disabled={projects.length <= 1}
                  aria-label={`Close ${project.title}`}
                  title={projects.length <= 1 ? 'At least one project tab is required' : 'Close tab'}
                >
                  ×
                </button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
        <button type="button" className="project-tab-add" onClick={addProject} aria-label="Add project tab" title="Add project tab">
          +
        </button>
      </header>

      <div className="workspace-stack">
        {projects.map((project) => (
          <ProjectWorkspace
            key={project.id}
            ref={(instance) => {
              workspaceRefs.current.set(project.id, instance)
            }}
            isActive={project.id === activeProjectId}
            isMac={isMac}
            popoutUrl={popoutUrl}
          />
        ))}
      </div>

      {editingProjectId ? (
        <div className="project-edit-modal-backdrop" onClick={closeEditModal}>
          <form className="project-edit-modal" onSubmit={saveProjectEdits} onClick={(event) => event.stopPropagation()}>
            <h2>Edit Project Tab</h2>

            <label>
              Name
              <div className="project-name-row">
                <div
                  ref={(element) => {
                    emojiPickerContainerRef.current = element
                  }}
                  className="emoji-picker-field"
                >
                  <button
                    type="button"
                    className="emoji-picker-trigger"
                    onClick={() => setIsEmojiPickerOpen((current) => !current)}
                    title="Pick emoji"
                    aria-label="Pick emoji"
                  >
                    <span aria-hidden="true">{editingEmoji || '🖥️'}</span>
                  </button>
                  {isEmojiPickerOpen ? (
                    <div className="emoji-picker-popover">
                      <Picker
                        data={data}
                        onEmojiSelect={(emoji: { native?: string }) => {
                          if (!emoji.native) {
                            return
                          }

                          setEditingEmoji(emoji.native)
                          setIsEmojiPickerOpen(false)
                        }}
                        previewPosition="none"
                        skinTonePosition="none"
                        theme="dark"
                      />
                    </div>
                  ) : null}
                </div>
                <input
                  type="text"
                  value={editingTitle}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  placeholder="Project name"
                  autoFocus
                />
              </div>
            </label>

            <label>
              Background Color
              <input
                type="color"
                value={editingColor}
                onChange={(event) => setEditingColor(event.target.value)}
              />
            </label>

            <div
              className="project-edit-preview"
              style={{
                borderTopColor: editingColor,
                backgroundColor: hexToRgba(editingColor, 0.2),
              }}
            >
              <span aria-hidden="true">{editingEmoji || '🖥️'}</span>
              <span>{editingTitle.trim() || 'Untitled Project'}</span>
            </div>

            <div className="project-edit-actions">
              <button type="button" onClick={closeEditModal}>
                Cancel
              </button>
              <button type="submit">Save</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}

export default App
