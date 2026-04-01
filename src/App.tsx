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
import { DockviewReact, getPanelData } from 'dockview'
import type { Direction, DockviewApi, DockviewReadyEvent } from 'dockview'
import {
  renderMacroTemplate,
} from './macroSettings'
import { EmojiPicker } from './components/EmojiPicker'
import type { MacroDefinition, MacroFieldValue } from './types/macros'
import type { AppCommand, RemoteAccessStatus } from './types/termide'
import { TerminalPanel } from './components/TerminalPanel'
import { TerminalTab } from './components/TerminalTab'
import type { TerminalPanelParams, TerminalTabMacroRun } from './components/TerminalTab'
import { useMacroSettings } from './hooks/useMacroSettings'
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
  macros: MacroDefinition[]
  popoutUrl: string
  project: ProjectTab
}

const OPEN_TERMINAL_SWITCHER_EVENT = 'termide-open-terminal-switcher'

function createAbortError(): Error {
  const error = new Error('Macro execution canceled.')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError()
  }
}

function waitForDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError())
      return
    }

    const onAbort = () => {
      window.clearTimeout(timeout)
      reject(createAbortError())
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)

    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function waitForSessionInactivity(sessionId: string, durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError())
      return
    }

    let timeout = 0

    const cleanup = () => {
      window.clearTimeout(timeout)
      dispose()
      signal.removeEventListener('abort', onAbort)
    }

    const finish = () => {
      cleanup()
      resolve()
    }

    const onAbort = () => {
      cleanup()
      reject(createAbortError())
    }

    const restartTimer = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(finish, durationMs)
    }

    const dispose = window.termide.onTerminalData((message) => {
      if (message.id !== sessionId) {
        return
      }

      restartTimer()
    })

    signal.addEventListener('abort', onAbort, { once: true })
    restartTimer()
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function describeMacroStep(step: MacroDefinition['steps'][number]): string {
  switch (step.type) {
    case 'type':
      return `Type: ${step.content.replace(/\s+/g, ' ').trim() || '(empty)'}`.slice(0, 96)
    case 'key':
      return `Press ${step.key}`
    case 'secret':
      return 'Insert secret'
    case 'wait_time':
      return `Wait ${Math.max(0, Math.round(step.durationMs / 100) / 10)}s`
    case 'wait_inactivity':
      return `Wait for inactivity ${Math.max(0, Math.round(step.durationMs / 100) / 10)}s`
    case 'select_line':
      return 'Select current line'
    case 'paste':
      return 'Paste clipboard'
  }
}

type TerminalSwitcherItem = {
  panelId: string
  sessionId: string
  title: string
  emoji: string
  color: string
}

type MacroRunController = {
  abortController: AbortController
  sessionId: string
}

const ProjectWorkspace = forwardRef<ProjectWorkspaceHandle, ProjectWorkspaceProps>(
  ({ isActive, isMac, macros, popoutUrl, project }, ref) => {
    const dockviewApiRef = useRef<DockviewApi | null>(null)
    const panelSessionMapRef = useRef<Map<string, string>>(new Map())
    const terminalCounterRef = useRef(0)
    const draggingTransferRef = useRef<{ panelId?: string; groupId: string } | null>(null)
    const workspaceRef = useRef<HTMLElement | null>(null)
    const [errorText, setErrorText] = useState<string | null>(null)
    const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
    const [runningMacroRunsBySession, setRunningMacroRunsBySession] = useState<Record<string, TerminalTabMacroRun[]>>({})
    const macroRunControllersRef = useRef<Map<string, MacroRunController>>(new Map())

    const [editingTerminalPanelId, setEditingTerminalPanelId] = useState<string | null>(null)
    const [editingTerminalTitle, setEditingTerminalTitle] = useState('')
    const [editingTerminalEmoji, setEditingTerminalEmoji] = useState('')
    const [editingTerminalColor, setEditingTerminalColor] = useState('#4db5ff')
    const [isTerminalEmojiPickerOpen, setIsTerminalEmojiPickerOpen] = useState(false)
    const terminalEmojiPickerContainerRef = useRef<HTMLDivElement | null>(null)
    const [isMacroLauncherOpen, setIsMacroLauncherOpen] = useState(false)
    const [macroQuery, setMacroQuery] = useState('')
    const [selectedMacroIndex, setSelectedMacroIndex] = useState(0)
    const [macroToRun, setMacroToRun] = useState<MacroDefinition | null>(null)
    const [macroFieldValues, setMacroFieldValues] = useState<Record<string, MacroFieldValue>>({})
    const macroLauncherInputRef = useRef<HTMLInputElement | null>(null)
    const firstMacroFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null)

    const getActiveSessionId = useCallback(() => {
      return dockviewApiRef.current?.activePanel?.params?.sessionId ?? null
    }, [])

    const focusActiveTerminal = useCallback(() => {
      const sessionId = getActiveSessionId()
      dockviewApiRef.current?.activePanel?.api.setActive()
      setFocusedSessionId(sessionId)
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('termide-focus-terminal', {
            detail: { sessionId },
          }),
        )
      })
    }, [getActiveSessionId])

    const [terminalSwitcherItems, setTerminalSwitcherItems] = useState<TerminalSwitcherItem[]>([])
    const [isTerminalSwitcherOpen, setIsTerminalSwitcherOpen] = useState(false)
    const [terminalSwitcherIndex, setTerminalSwitcherIndex] = useState(0)
    const terminalSwitcherSelectionRef = useRef(0)

    const updateMacroRun = useCallback(
      (sessionId: string, runId: string, updater: (run: TerminalTabMacroRun) => TerminalTabMacroRun) => {
        setRunningMacroRunsBySession((current) => {
          const existingRuns = current[sessionId]
          if (!existingRuns?.length) {
            return current
          }

          let changed = false
          const nextRuns = existingRuns.map((run) => {
            if (run.id !== runId) {
              return run
            }

            changed = true
            return updater(run)
          })

          return changed
            ? {
                ...current,
                [sessionId]: nextRuns,
              }
            : current
        })
      },
      [],
    )

    const updateMacroRunStatus = useCallback((sessionId: string, runId: string, status: TerminalTabMacroRun['status']) => {
      updateMacroRun(sessionId, runId, (run) => ({
        ...run,
        status,
      }))
    }, [updateMacroRun])

    const updateMacroRunStepStatus = useCallback(
      (
        sessionId: string,
        runId: string,
        stepId: string,
        status: 'pending' | 'running' | 'completed' | 'canceled' | 'failed',
      ) => {
        updateMacroRun(sessionId, runId, (run) => ({
          ...run,
          steps: run.steps.map((step) => (step.id === stepId ? { ...step, status } : step)),
        }))
      },
      [updateMacroRun],
    )

    const clearMacroRunsForSession = useCallback((sessionId: string) => {
      setRunningMacroRunsBySession((current) => {
        if (!(sessionId in current)) {
          return current
        }

        const { [sessionId]: _removed, ...rest } = current
        return rest
      })
    }, [])

    const clearFinishedMacroRunsForSession = useCallback((sessionId: string) => {
      setRunningMacroRunsBySession((current) => {
        const existingRuns = current[sessionId]
        if (!existingRuns?.length) {
          return current
        }

        const nextRuns = existingRuns.filter((run) => run.status === 'running' || run.status === 'canceling')
        if (nextRuns.length === existingRuns.length) {
          return current
        }

        if (nextRuns.length === 0) {
          const { [sessionId]: _removed, ...rest } = current
          return rest
        }

        return {
          ...current,
          [sessionId]: nextRuns,
        }
      })
    }, [])

    const clearMacroRunForSession = useCallback((sessionId: string, runId: string) => {
      setRunningMacroRunsBySession((current) => {
        const existingRuns = current[sessionId]
        if (!existingRuns?.length) {
          return current
        }

        const nextRuns = existingRuns.filter((run) => run.id !== runId)
        if (nextRuns.length === existingRuns.length) {
          return current
        }

        if (nextRuns.length === 0) {
          const { [sessionId]: _removed, ...rest } = current
          return rest
        }

        return {
          ...current,
          [sessionId]: nextRuns,
        }
      })
    }, [])

    const cancelMacroRun = useCallback((runId: string) => {
      const controller = macroRunControllersRef.current.get(runId)
      if (!controller) {
        return
      }

      updateMacroRunStatus(controller.sessionId, runId, 'canceling')
      controller.abortController.abort()
    }, [updateMacroRunStatus])

    const cancelMacroRunsForSession = useCallback((sessionId: string) => {
      for (const [runId, controller] of macroRunControllersRef.current.entries()) {
        if (controller.sessionId !== sessionId) {
          continue
        }

        updateMacroRunStatus(sessionId, runId, 'canceling')
        controller.abortController.abort()
      }
    }, [updateMacroRunStatus])

    const getOrderedTerminalSwitcherItems = useCallback((): TerminalSwitcherItem[] => {
      const api = dockviewApiRef.current
      if (!api) {
        return []
      }

      return api.groups
        .map((group) => {
          const referencePanel = group.activePanel ?? group.panels[0]
          if (!referencePanel) {
            return null
          }

          try {
            if (referencePanel.api.getWindow() !== window) {
              return null
            }
          } catch {
            return null
          }

          const rect = group.element.getBoundingClientRect()
          return {
            group,
            top: rect.top,
            left: rect.left,
          }
        })
        .filter((entry): entry is { group: DockviewApi['groups'][number]; top: number; left: number } => entry !== null)
        .sort((a, b) => {
          const verticalDistance = Math.abs(a.top - b.top)
          if (verticalDistance > 24) {
            return a.top - b.top
          }

          return a.left - b.left
        })
        .flatMap(({ group }) =>
          group.panels.map((panel) => ({
            panelId: panel.id,
            sessionId: panel.params?.sessionId ?? '',
            title: panel.title ?? 'Terminal',
            emoji: panel.params?.emoji ?? '',
            color: panel.params?.color ?? '#4db5ff',
          })),
        )
        .filter((panel) => panel.sessionId.length > 0)
    }, [])

    const closeTerminalSwitcher = useCallback(() => {
      terminalSwitcherSelectionRef.current = 0
      setIsTerminalSwitcherOpen(false)
      setTerminalSwitcherItems([])
      setTerminalSwitcherIndex(0)
    }, [])

    const commitTerminalSwitcherSelection = useCallback(() => {
      const api = dockviewApiRef.current
      const selectedPanel = terminalSwitcherItems[terminalSwitcherSelectionRef.current]
      closeTerminalSwitcher()

      if (!api || !selectedPanel) {
        return
      }

      api.getPanel(selectedPanel.panelId)?.api.setActive()
      setErrorText(null)
      window.requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent('termide-focus-terminal', {
            detail: { sessionId: selectedPanel.sessionId },
          }),
        )
      })
    }, [closeTerminalSwitcher, terminalSwitcherItems])

    const moveTerminalSwitcherSelection = useCallback(
      (direction: 1 | -1) => {
        const items = terminalSwitcherItems
        if (items.length <= 1) {
          return
        }

        const nextIndex = (terminalSwitcherSelectionRef.current + direction + items.length) % items.length
        terminalSwitcherSelectionRef.current = nextIndex
        setTerminalSwitcherIndex(nextIndex)
      },
      [terminalSwitcherItems],
    )

    const openTerminalSwitcher = useCallback(
      (direction: 1 | -1 = 1) => {
        const items = getOrderedTerminalSwitcherItems()
        if (items.length <= 1) {
          return
        }

        const activePanelId = dockviewApiRef.current?.activePanel?.id
        const activeIndex = activePanelId ? items.findIndex((item) => item.panelId === activePanelId) : -1
        const startIndex = activeIndex >= 0 ? activeIndex : 0
        const nextIndex = (startIndex + direction + items.length) % items.length

        terminalSwitcherSelectionRef.current = nextIndex
        setTerminalSwitcherItems(items)
        setTerminalSwitcherIndex(nextIndex)
        setIsTerminalSwitcherOpen(true)
      },
      [getOrderedTerminalSwitcherItems],
    )

    const closeMacroLauncher = useCallback(() => {
      setIsMacroLauncherOpen(false)
      setMacroQuery('')
      setSelectedMacroIndex(0)
      window.requestAnimationFrame(() => {
        focusActiveTerminal()
      })
    }, [focusActiveTerminal])

    const closeMacroParameterModal = useCallback(() => {
      setMacroToRun(null)
      setMacroFieldValues({})
      window.requestAnimationFrame(() => {
        focusActiveTerminal()
      })
    }, [focusActiveTerminal])

    const filteredMacros = useMemo(() => {
      const normalizedQuery = macroQuery.trim().toLowerCase()
      if (!normalizedQuery) {
        return macros
      }

      return macros.filter((macro) => {
        const fieldText = macro.fields
          .map((field) => `${field.label} ${field.name}`)
          .join(' ')
          .toLowerCase()

        const stepText = macro.steps
          .map((step) => (step.type === 'type' ? step.content : ''))
          .join(' ')
          .toLowerCase()

        return (
          macro.title.toLowerCase().includes(normalizedQuery) ||
          macro.description.toLowerCase().includes(normalizedQuery) ||
          stepText.includes(normalizedQuery) ||
          fieldText.includes(normalizedQuery)
        )
      })
    }, [macroQuery, macros])

    const executeMacro = useCallback(
      async (macro: MacroDefinition, values: Record<string, MacroFieldValue>) => {
        const sessionId = getActiveSessionId()
        if (!sessionId) {
          setErrorText('No active terminal is available to receive the macro.')
          return
        }

        setErrorText(null)
        setMacroToRun(null)
        setMacroFieldValues({})
        setIsMacroLauncherOpen(false)
        setMacroQuery('')
        setSelectedMacroIndex(0)

        const runId = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const abortController = new AbortController()
        const nextRun: TerminalTabMacroRun = {
          id: runId,
          startedAt: Date.now(),
          status: 'running',
          steps: macro.steps.map((step) => ({
            id: step.id,
            status: 'pending',
            title: describeMacroStep(step),
          })),
          title: macro.title,
        }

        macroRunControllersRef.current.set(runId, {
          abortController,
          sessionId,
        })
        setRunningMacroRunsBySession((current) => ({
          ...current,
          [sessionId]: [
            nextRun,
            ...(current[sessionId] ?? []),
          ],
        }))

        try {
          for (const step of macro.steps) {
            throwIfAborted(abortController.signal)
            updateMacroRunStepStatus(sessionId, runId, step.id, 'running')

            switch (step.type) {
              case 'type': {
                const rendered = renderMacroTemplate(step.content, values)
                window.termide.writeTerminal(sessionId, rendered)
                break
              }
              case 'key':
                // In this terminal app, we just write the key name for Enter if it's the only way,
                // but usually we want to send \r for Enter.
                if (step.key === 'Enter') {
                  window.termide.writeTerminal(sessionId, '\r')
                } else if (step.key === 'Tab') {
                  window.termide.writeTerminal(sessionId, '\t')
                } else if (step.key === 'Escape') {
                  window.termide.writeTerminal(sessionId, '\x1b')
                } else if (step.key === 'Backspace') {
                  window.termide.writeTerminal(sessionId, '\x7f')
                } else if (step.key === 'ArrowUp') {
                  window.termide.writeTerminal(sessionId, '\x1b[A')
                } else if (step.key === 'ArrowDown') {
                  window.termide.writeTerminal(sessionId, '\x1b[B')
                }
                break
              case 'secret':
                try {
                  const secretVal = await window.termide.getDecryptedSecret(step.secretId)
                  throwIfAborted(abortController.signal)
                  window.termide.writeTerminal(sessionId, secretVal)
                } catch (error) {
                  if (isAbortError(error)) {
                    throw error
                  }

                  console.error('Failed to decrypt secret', error)
                }
                break
              case 'wait_time':
                await waitForDelay(step.durationMs, abortController.signal)
                break
              case 'wait_inactivity':
                await waitForSessionInactivity(sessionId, step.durationMs, abortController.signal)
                break
              case 'select_line':
                // Typical "select line" escape sequence for some terminals, or just a placeholder
                // For now, let's just do nothing or a common one if known.
                break
              case 'paste':
                try {
                  const text = await navigator.clipboard.readText()
                  throwIfAborted(abortController.signal)
                  window.termide.writeTerminal(sessionId, text)
                } catch (error) {
                  if (isAbortError(error)) {
                    throw error
                  }

                  console.error('Failed to paste from clipboard', error)
                }
                break
            }

            updateMacroRunStepStatus(sessionId, runId, step.id, 'completed')
          }

          updateMacroRunStatus(sessionId, runId, 'completed')
          window.requestAnimationFrame(() => {
            focusActiveTerminal()
          })
        } catch (error) {
          if (isAbortError(error)) {
            updateMacroRunStatus(sessionId, runId, 'canceled')
            updateMacroRun(sessionId, runId, (run) => ({
              ...run,
              steps: run.steps.map((candidate) =>
                candidate.status === 'running' ? { ...candidate, status: 'canceled' } : candidate,
              ),
            }))
          } else {
            updateMacroRunStatus(sessionId, runId, 'failed')
            updateMacroRun(sessionId, runId, (run) => ({
              ...run,
              steps: run.steps.map((candidate) =>
                candidate.status === 'running' ? { ...candidate, status: 'failed' } : candidate,
              ),
            }))
            const message = error instanceof Error ? error.message : String(error)
            setErrorText(message)
          }
        } finally {
          macroRunControllersRef.current.delete(runId)
        }
      },
      [focusActiveTerminal, getActiveSessionId, updateMacroRun, updateMacroRunStatus, updateMacroRunStepStatus],
    )

    const syncFocusedTerminalTabs = useCallback((sessionId: string | null) => {
      const api = dockviewApiRef.current
      if (!api) {
        return
      }

      for (const [panelId, panelSessionId] of panelSessionMapRef.current.entries()) {
        const panel = api.getPanel(panelId)
        if (!panel) {
          continue
        }

        const isFocused = panelSessionId === sessionId
        if (panel.params?.isFocused === isFocused) {
          continue
        }

        panel.api.updateParameters({ isFocused })
      }
    }, [])

    const syncRunningMacroTabs = useCallback(() => {
      const api = dockviewApiRef.current
      if (!api) {
        return
      }

      for (const [panelId, panelSessionId] of panelSessionMapRef.current.entries()) {
        const panel = api.getPanel(panelId)
        if (!panel) {
          continue
        }

        panel.api.updateParameters({
          macroRuns: runningMacroRunsBySession[panelSessionId] ?? [],
          onClearFinishedMacroRuns: () => clearFinishedMacroRunsForSession(panelSessionId),
          onClearMacroRun: (runId: string) => clearMacroRunForSession(panelSessionId, runId),
          onCancelMacroRun: cancelMacroRun,
        })
      }
    }, [cancelMacroRun, clearFinishedMacroRunsForSession, clearMacroRunForSession, runningMacroRunsBySession])

    useEffect(() => {
      for (const sessionId of panelSessionMapRef.current.values()) {
        window.termide.updateTerminalRemoteMetadata(sessionId, {
          projectId: project.id,
          projectTitle: project.title,
          projectEmoji: project.emoji,
          projectColor: project.color,
        })
      }
    }, [project.id, project.title, project.emoji, project.color])

    const runMacro = useCallback(
      (macro: MacroDefinition) => {
        const effectiveFields = macro.fields
        if (effectiveFields.length === 0) {
          executeMacro(macro, {})
          return
        }

        setMacroToRun(macro)
        setMacroFieldValues(
          Object.fromEntries(effectiveFields.map((field) => [field.name, field.defaultValue])) as Record<
            string,
            MacroFieldValue
          >,
        )
        setIsMacroLauncherOpen(false)
      },
      [executeMacro],
    )

    const validateMacroValues = useCallback((macro: MacroDefinition, values: Record<string, MacroFieldValue>) => {
      for (const field of macro.fields) {
        if (!field.required) {
          continue
        }

        const value = values[field.name]
        const isMissing =
          value === undefined ||
          value === null ||
          (typeof value === 'string' && value.trim().length === 0)

        if (isMissing) {
          setErrorText(`"${field.label}" is required before this macro can run.`)
          return false
        }
      }

      return true
    }, [])

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

          const sessionId = panel.params?.sessionId
          if (sessionId) {
            window.termide.updateTerminalRemoteMetadata(sessionId, {
              color: nextColor,
              emoji: nextEmoji,
              title: nextTitle,
              projectId: project.id,
              projectTitle: project.title,
              projectEmoji: project.emoji,
              projectColor: project.color,
            })
          }
        }

        closeTerminalEditModal()
      },
      [closeTerminalEditModal, editingTerminalColor, editingTerminalEmoji, editingTerminalPanelId, editingTerminalTitle, project.id, project.title, project.emoji, project.color],
    )

    const addTerminal = useCallback(async (options?: AddTerminalOptions) => {
      const api = dockviewApiRef.current
      if (!api) {
        return
      }

      try {
        const activeSessionId = api.activePanel?.params?.sessionId
        const inheritedCwd = activeSessionId ? await window.termide.getTerminalCwd(activeSessionId) : null
        const { id: sessionId } = await window.termide.createTerminal(
          inheritedCwd ? { cwd: inheritedCwd } : undefined,
        )

        terminalCounterRef.current += 1
        const panelId = `terminal-${terminalCounterRef.current}`

        const panel = api.addPanel<TerminalPanelParams>({
          id: panelId,
          title: `Terminal ${terminalCounterRef.current}`,
          component: 'terminal',
          tabComponent: 'terminalTab',
          params: {
            color: '#0a0a0a',
            isFocused: false,
            macroRuns: [],
            onClearFinishedMacroRuns: () => clearFinishedMacroRunsForSession(sessionId),
            onClearMacroRun: (runId: string) => clearMacroRunForSession(sessionId, runId),
            onCancelMacroRun: cancelMacroRun,
            sessionId,
          },
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
        window.termide.updateTerminalRemoteMetadata(sessionId, {
          color: '#0a0a0a',
          emoji: '',
          title: `Terminal ${terminalCounterRef.current}`,
          projectId: project.id,
          projectTitle: project.title,
          projectEmoji: project.emoji,
          projectColor: project.color,
        })
        panel.api.setActive()
        setFocusedSessionId(sessionId)
        setErrorText(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setErrorText(message)
      }
    }, [cancelMacroRun, clearFinishedMacroRunsForSession, clearMacroRunForSession, project.id, project.title, project.emoji, project.color])

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
            case 'open-macro-launcher':
              if (!getActiveSessionId()) {
                setErrorText('Open a terminal before launching a macro.')
                break
              }

              setMacroQuery('')
              setSelectedMacroIndex(0)
              setIsMacroLauncherOpen(true)
              setMacroToRun(null)
              setMacroFieldValues({})
              break
            default:
              break
          }
        },
      }),
      [addTerminal, closeActivePanel, getActiveSessionId, popoutActivePanel],
    )

    useEffect(() => {
      syncFocusedTerminalTabs(focusedSessionId)
    }, [focusedSessionId, syncFocusedTerminalTabs])

    useEffect(() => {
      syncRunningMacroTabs()
    }, [syncRunningMacroTabs])

    const handleReady = useCallback(
      (event: DockviewReadyEvent) => {
        dockviewApiRef.current = event.api

        event.api.onDidRemovePanel((panel) => {
          const sessionId = panelSessionMapRef.current.get(panel.id)

          if (!sessionId) {
            return
          }

          panelSessionMapRef.current.delete(panel.id)
          cancelMacroRunsForSession(sessionId)
          clearMacroRunsForSession(sessionId)
          setFocusedSessionId((current) =>
            current === sessionId ? event.api.activePanel?.params?.sessionId ?? null : current,
          )
          window.termide.killTerminal(sessionId)
        })

        void addTerminal({})
      },
      [addTerminal, cancelMacroRunsForSession, clearMacroRunsForSession],
    )

    useEffect(() => {
      const onTerminalFocused = (event: Event) => {
        const customEvent = event as CustomEvent<{ sessionId?: string }>
        setFocusedSessionId(customEvent.detail?.sessionId ?? null)
      }

      window.addEventListener('termide-terminal-focused', onTerminalFocused)
      return () => {
        window.removeEventListener('termide-terminal-focused', onTerminalFocused)
      }
    }, [])

    useEffect(() => {
      return window.termide.onTerminalExit((message) => {
        cancelMacroRunsForSession(message.id)
      })
    }, [cancelMacroRunsForSession])

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
          button.innerHTML = `
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `
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
          const headerContainer = target?.closest('.dv-tabs-and-actions-container')
          if (!headerContainer) {
            return
          }

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

      if (editingTerminalPanelId || isMacroLauncherOpen || macroToRun || isTerminalSwitcherOpen) {
        return
      }

      const frame = window.requestAnimationFrame(() => {
        focusActiveTerminal()
      })

      return () => {
        window.cancelAnimationFrame(frame)
      }
    }, [editingTerminalPanelId, focusActiveTerminal, isActive, isMacroLauncherOpen, isTerminalSwitcherOpen, macroToRun])

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

    useEffect(() => {
      if (!isActive || editingTerminalPanelId || isMacroLauncherOpen || macroToRun) {
        return
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented) {
          return
        }

        if (event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Tab') {
          const target = event.target
          if (
            target instanceof HTMLElement &&
            (target.closest('.terminal-panel') || target.closest('.xterm') || target.classList.contains('xterm-helper-textarea'))
          ) {
            return
          }

          event.preventDefault()
          if (event.repeat) {
            return
          }

          if (isTerminalSwitcherOpen) {
            moveTerminalSwitcherSelection(event.shiftKey ? -1 : 1)
            return
          }

          openTerminalSwitcher(event.shiftKey ? -1 : 1)
          return
        }

        if (!isTerminalSwitcherOpen) {
          return
        }

        if (event.key === 'Escape') {
          event.preventDefault()
          closeTerminalSwitcher()
        }
      }

      const onSwitcherRequest = (event: Event) => {
        const customEvent = event as CustomEvent<{ direction?: 1 | -1 }>
        const direction = customEvent.detail?.direction === -1 ? -1 : 1

        if (isTerminalSwitcherOpen) {
          moveTerminalSwitcherSelection(direction)
          return
        }

        openTerminalSwitcher(direction)
      }

      const onKeyUp = (event: KeyboardEvent) => {
        if (!isTerminalSwitcherOpen) {
          return
        }

        if (event.key === 'Alt') {
          event.preventDefault()
          commitTerminalSwitcherSelection()
        }
      }

      const onBlur = () => {
        if (isTerminalSwitcherOpen) {
          commitTerminalSwitcherSelection()
        }
      }

      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener(OPEN_TERMINAL_SWITCHER_EVENT, onSwitcherRequest)
      window.addEventListener('blur', onBlur)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener(OPEN_TERMINAL_SWITCHER_EVENT, onSwitcherRequest)
        window.removeEventListener('blur', onBlur)
      }
    }, [
      closeTerminalSwitcher,
      commitTerminalSwitcherSelection,
      editingTerminalPanelId,
      isActive,
      isMacroLauncherOpen,
      isTerminalSwitcherOpen,
      macroToRun,
      moveTerminalSwitcherSelection,
      openTerminalSwitcher,
    ])

    useEffect(() => {
      if (!isMacroLauncherOpen) {
        return
      }

      window.requestAnimationFrame(() => {
        macroLauncherInputRef.current?.focus()
        macroLauncherInputRef.current?.select()
      })
    }, [isMacroLauncherOpen])

    useEffect(() => {
      if (filteredMacros.length === 0) {
        setSelectedMacroIndex(0)
        return
      }

      setSelectedMacroIndex((current) => Math.min(current, filteredMacros.length - 1))
    }, [filteredMacros.length])

    useEffect(() => {
      if (!isMacroLauncherOpen) {
        return
      }

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeMacroLauncher()
          return
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelectedMacroIndex((current) => (filteredMacros.length === 0 ? 0 : (current + 1) % filteredMacros.length))
          return
        }

        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelectedMacroIndex((current) =>
            filteredMacros.length === 0 ? 0 : (current - 1 + filteredMacros.length) % filteredMacros.length,
          )
          return
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          const macro = filteredMacros[selectedMacroIndex]
          if (macro) {
            runMacro(macro)
          }
        }
      }

      window.addEventListener('keydown', onKeyDown)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
      }
    }, [closeMacroLauncher, filteredMacros, isMacroLauncherOpen, runMacro, selectedMacroIndex])

    useEffect(() => {
      if (!macroToRun) {
        return
      }

      window.requestAnimationFrame(() => {
        firstMacroFieldRef.current?.focus()
      })

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeMacroParameterModal()
        }
      }

      window.addEventListener('keydown', onKeyDown)
      return () => {
        window.removeEventListener('keydown', onKeyDown)
      }
    }, [closeMacroParameterModal, macroToRun])

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

        {isMacroLauncherOpen ? (
          <div className="macro-launcher" role="dialog" aria-modal="true" aria-label="Macro launcher">
            <div className="macro-launcher-panel">
              <div className="macro-launcher-header">
                <div>
                  <p className="macro-launcher-kicker">Cmd+L</p>
                  <h2>Run Macro</h2>
                </div>
                <button type="button" className="macro-launcher-close" onClick={closeMacroLauncher} aria-label="Close macro launcher">
                  Esc
                </button>
              </div>

              <input
                ref={macroLauncherInputRef}
                type="text"
                className="macro-launcher-input"
                value={macroQuery}
                onChange={(event) => {
                  setMacroQuery(event.target.value)
                  setSelectedMacroIndex(0)
                }}
                placeholder="Search macros"
              />

              <div className="macro-launcher-list">
                {filteredMacros.length === 0 ? (
                  <p className="macro-launcher-empty">No macros match this search.</p>
                ) : (
                  filteredMacros.map((macro, index) => (
                    <button
                      key={macro.id}
                      type="button"
                      className={`macro-launcher-item${index === selectedMacroIndex ? ' macro-launcher-item--active' : ''}`}
                      onMouseEnter={() => setSelectedMacroIndex(index)}
                      onClick={() => runMacro(macro)}
                    >
                      <span className="macro-launcher-item-title">{macro.title}</span>
                      <span className="macro-launcher-item-description">
                        {macro.description || (macro.steps[0]?.type === 'type' ? macro.steps[0].content : 'Multi-step macro')}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isTerminalSwitcherOpen ? (
          <div className="terminal-switcher" role="dialog" aria-modal="true" aria-label="Terminal switcher">
            <div className="terminal-switcher-panel">
              <div className="terminal-switcher-header">
                <p className="terminal-switcher-kicker">Alt+Tab</p>
                <span className="terminal-switcher-hint">Release Alt to switch</span>
              </div>
              <div className="terminal-switcher-list">
                {terminalSwitcherItems.map((item, index) => (
                  <button
                    key={item.panelId}
                    type="button"
                    className={`terminal-switcher-item${index === terminalSwitcherIndex ? ' terminal-switcher-item--active' : ''}`}
                    onMouseEnter={() => {
                      terminalSwitcherSelectionRef.current = index
                      setTerminalSwitcherIndex(index)
                    }}
                    onClick={() => {
                      terminalSwitcherSelectionRef.current = index
                      setTerminalSwitcherIndex(index)
                      commitTerminalSwitcherSelection()
                    }}
                  >
                    <span className="terminal-switcher-item-preview" style={{ '--tab-color': item.color } as React.CSSProperties}>
                      <span className="terminal-switcher-item-dot" />
                      <span className="terminal-switcher-item-emoji" aria-hidden="true">
                        {item.emoji || '>'}
                      </span>
                    </span>
                    <span className="terminal-switcher-item-title">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {macroToRun ? (
          <div className="project-edit-modal-backdrop" onClick={closeMacroParameterModal}>
            <form
              className="project-edit-modal project-edit-modal--wide"
              onSubmit={(event) => {
                event.preventDefault()
                if (!validateMacroValues(macroToRun, macroFieldValues)) {
                  return
                }
                executeMacro(macroToRun, macroFieldValues)
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <h2>{macroToRun.title}</h2>
              <p className="macro-parameter-description">
                {macroToRun.description || 'Fill in the parameters to render the final macro output.'}
              </p>

              {macroToRun.fields.map((field, index) => {
                const value = macroFieldValues[field.name]
                const firstFieldRef =
                  index === 0
                    ? (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null) => {
                        firstMacroFieldRef.current = element
                      }
                    : undefined
                return (
                  <div key={field.id} className="macro-parameter-field">
                    <span>{field.label}</span>
                    {field.type === 'textarea' ? (
                      <textarea
                        ref={firstFieldRef}
                        className="project-edit-textarea"
                        value={String(value ?? '')}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          setMacroFieldValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                        rows={4}
                      />
                    ) : field.type === 'select' ? (
                      <select
                        ref={firstFieldRef}
                        className="project-edit-select"
                        value={String(value ?? '')}
                        onChange={(event) =>
                          setMacroFieldValues((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                      >
                        {field.options.map((option) => (
                          <option key={`${field.id}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'checkbox' ? (
                      <input
                        ref={firstFieldRef}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) =>
                          setMacroFieldValues((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))
                        }
                      />
                    ) : (
                      <input
                        ref={firstFieldRef}
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={String(value ?? '')}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          setMacroFieldValues((current) => ({
                            ...current,
                            [field.name]:
                              field.type === 'number' ? Number(event.target.value || 0) : event.target.value,
                          }))
                        }
                      />
                    )}
                  </div>
                )
              })}

              <div className="project-edit-preview project-edit-preview--multiline">
                <pre>{renderMacroTemplate(macroToRun.template, macroFieldValues)}</pre>
              </div>

              <div className="project-edit-actions">
                <button type="button" onClick={closeMacroParameterModal}>
                  Cancel
                </button>
                <button type="submit">Type Macro</button>
              </div>
            </form>
          </div>
        ) : null}

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
                    <div
                      className={`emoji-picker-popover${isTerminalEmojiPickerOpen ? '' : ' emoji-picker-popover--hidden'}`}
                    >
                      <EmojiPicker
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
                  '--project-color': editingTerminalColor,
                } as React.CSSProperties}
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
  const { macros } = useMacroSettings()
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
  const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(null)
  const [isTogglingRemoteAccess, setIsTogglingRemoteAccess] = useState(false)
  const [isPairingModalOpen, setIsPairingModalOpen] = useState(false)
  const [isLinkCopied, setIsLinkCopied] = useState(false)
  const emojiPickerContainerRef = useRef<HTMLDivElement | null>(null)
  const remoteMenuRef = useRef<HTMLDivElement | null>(null)
  const [isRemoteMenuOpen, setIsRemoteMenuOpen] = useState(false)
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
      const isLastProject = projects.length === 1 && projects[0]?.id === projectId
      if (isLastProject) {
        if (editingProjectId === projectId) {
          closeEditModal()
        }

        void window.termide.quitApp()
        return
      }

      setProjects((current) => {
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
    [activeProjectId, closeEditModal, editingProjectId, projects],
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
    let isMounted = true

    void window.termide.getRemoteAccessStatus().then((status) => {
      if (isMounted) {
        setRemoteStatus(status)
      }
    })

    const unsubscribe = window.termide.onRemoteAccessStatusChanged((status) => {
      setRemoteStatus(status)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  const toggleRemoteAccess = useCallback(async () => {
    setIsTogglingRemoteAccess(true)
    try {
      if (remoteStatus?.configurationIssue) {
        await window.termide.openSettingsWindow({ sectionId: 'remote-access-host' })
        return
      }

      const nextStatus = await window.termide.toggleRemoteAccessServer()
      setRemoteStatus(nextStatus)
    } finally {
      setIsTogglingRemoteAccess(false)
    }
  }, [remoteStatus?.configurationIssue])

  const openPairingQr = useCallback(async () => {
    if (remoteStatus?.configurationIssue) {
      await window.termide.openSettingsWindow({ sectionId: 'remote-access-host' })
      return
    }

    let nextStatus = remoteStatus

    if (!nextStatus?.isRunning) {
      setIsTogglingRemoteAccess(true)
      try {
        nextStatus = await window.termide.toggleRemoteAccessServer()
        setRemoteStatus(nextStatus)
      } finally {
        setIsTogglingRemoteAccess(false)
      }
    }

    if (nextStatus?.pairingQrCodeDataUrl) {
      setIsPairingModalOpen(true)
    }
  }, [remoteStatus])

  const remoteButtonTone = remoteStatus?.isRunning
    ? 'remote-access-button--active'
    : remoteStatus?.configurationIssue || remoteStatus?.errorMessage
      ? 'remote-access-button--warning'
      : ''

  const remoteAddresses = remoteStatus?.availableAddresses ?? []
  const preferredRemoteAddress = useMemo(() => {
    if (!remoteStatus?.pairingUrl) return remoteAddresses[0] || null
    try {
      const url = new URL(remoteStatus.pairingUrl)
      const origin = url.origin + url.pathname.replace(/\/$/, '')
      return remoteAddresses.find(addr => addr.startsWith(origin)) || remoteAddresses[0] || null
    } catch {
      return remoteAddresses[0] || null
    }
  }, [remoteStatus?.pairingUrl, remoteAddresses])

  const selectPairingAddress = useCallback(async (address: string) => {
    const nextStatus = await window.termide.setRemoteAccessPairingAddress(address)
    setRemoteStatus(nextStatus)
  }, [])

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

  useEffect(() => {
    if (!isRemoteMenuOpen) {
      return
    }

    const onPointerDown = (event: MouseEvent) => {
      const container = remoteMenuRef.current
      if (!container) {
        return
      }

      const target = event.target as Node
      if (container.contains(target)) {
        return
      }

      setIsRemoteMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRemoteMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isRemoteMenuOpen])

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
                style={{ '--project-color': project.color } as React.CSSProperties}
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
                  aria-label={`Close ${project.title}`}
                  title={projects.length <= 1 ? 'Close tab and exit app' : 'Close tab'}
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>
        <button type="button" className="project-tab-add" onClick={addProject} aria-label="Add project tab" title="Add project tab">
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 2V10M2 6H10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div
          ref={remoteMenuRef}
          className={`remote-access-status${remoteStatus?.isRunning ? ' remote-access-status--active' : ''}${isRemoteMenuOpen ? ' remote-access-status--open' : ''}`}
        >
          <button
            type="button"
            className={`remote-access-button ${remoteButtonTone}`.trim()}
            onClick={() => setIsRemoteMenuOpen((current) => !current)}
            title="Open remote access menu"
            aria-label="Open remote access menu"
            aria-haspopup="menu"
            aria-expanded={isRemoteMenuOpen}
          >
            <span className="remote-access-button__label">Remote</span>
            {remoteStatus?.isRunning ? (
              <span className="remote-access-button__badge remote-access-button__badge--live" aria-hidden="true" />
            ) : null}
            {remoteStatus?.configurationIssue || remoteStatus?.errorMessage ? (
              <span className="remote-access-button__badge remote-access-button__badge--warning" aria-hidden="true">
                !
              </span>
            ) : null}
            <span className="remote-access-button__chevron" aria-hidden="true">▾</span>
          </button>
          {isRemoteMenuOpen ? (
            <div className="remote-access-menu" role="menu" aria-label="Remote access menu">
              <button
                type="button"
                className="remote-access-menu__item"
                onClick={() => void toggleRemoteAccess()}
                disabled={isTogglingRemoteAccess}
              >
                <span>{isTogglingRemoteAccess ? 'Working...' : remoteStatus?.isRunning ? 'Stop Server' : 'Start Server'}</span>
                <span className="remote-access-menu__meta">{remoteStatus?.isRunning ? 'Live' : 'Offline'}</span>
              </button>
              <button
                type="button"
                className="remote-access-menu__item"
                onClick={() => void window.termide.openSettingsWindow({ sectionId: 'remote-access-host' })}
              >
                <span>Remote Access Settings</span>
                <span className="remote-access-menu__meta">Open</span>
              </button>
              <button
                type="button"
                className="remote-access-menu__item"
                onClick={() => void openPairingQr()}
                disabled={isTogglingRemoteAccess}
              >
                <span>{remoteStatus?.isRunning ? 'Show Pairing QR' : 'Start Server & Show QR'}</span>
                <span className="remote-access-menu__meta">{remoteStatus?.isRunning ? 'Scan' : 'Start'}</span>
              </button>
              <div className="remote-access-menu__section">
                <div className="remote-access-menu__section-label">Connect To</div>
                {remoteStatus?.availableAddresses.length ? (
                  remoteStatus.availableAddresses.map((address) => (
                    <button
                      key={address}
                      type="button"
                      className={`remote-access-menu__address-btn${address === preferredRemoteAddress ? ' remote-access-menu__address-btn--active' : ''}`}
                      onClick={() => void selectPairingAddress(address)}
                      title={address === preferredRemoteAddress ? `Active: ${address}` : `Switch to: ${address}`}
                    >
                      <span className="remote-access-menu__address-text">{address}</span>
                      {address === preferredRemoteAddress && (
                        <span className="remote-access-menu__address-check" aria-hidden="true">✓</span>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="remote-access-menu__empty">No local addresses available yet.</div>
                )}
              </div>
              <div className="remote-access-menu__section">
                <div className="remote-access-menu__section-label">Active Connections</div>
                {remoteStatus?.connections.length ? (
                  remoteStatus.connections.map((connection) => (
                    <div key={connection.connectionId} className="remote-access-menu__connection">
                      <div className="remote-access-menu__connection-main">
                        <span className="remote-access-menu__connection-device">{connection.deviceName}</span>
                        <span className="remote-access-menu__connection-meta">
                          {connection.attachedSessionCount} {connection.attachedSessionCount === 1 ? 'session' : 'sessions'}
                        </span>
                      </div>
                      <div className="remote-access-menu__connection-id">{connection.connectionId}</div>
                    </div>
                  ))
                ) : (
                  <div className="remote-access-menu__empty">No active browser connections.</div>
                )}
              </div>
              {remoteStatus?.errorMessage ? (
                <div className="remote-access-menu__section">
                  <div className="remote-access-menu__section-label">Status</div>
                  <div className="remote-access-menu__empty">{remoteStatus.errorMessage}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
            macros={macros}
            popoutUrl={popoutUrl}
            project={project}
          />
        ))}
      </div>

      {isPairingModalOpen ? (
        <div className="project-edit-modal-backdrop" onClick={() => setIsPairingModalOpen(false)}>
          <div
            className="project-edit-modal project-edit-modal--wide remote-pairing-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Pair device"
          >
            <h2>Pair Device</h2>
            <p className="remote-pairing-modal__copy">
              Scan this QR code from your phone to pair it with this Termide host.
            </p>
            {remoteStatus?.pairingQrCodeDataUrl ? (
              <div className="remote-pairing-modal__content">
                <div className="remote-pairing-modal__qr-section">
                  <div className="remote-pairing-modal__qr-card">
                    <img className="remote-pairing-modal__qr" src={remoteStatus.pairingQrCodeDataUrl} alt="Pair device QR code" />
                  </div>
                  
                  <div className="remote-pairing-modal__primary-link">
                    <h3>Open this address in your browser</h3>
                    <div className="remote-pairing-modal__address-box">
                      <div className="remote-pairing-modal__address-text">
                        {preferredRemoteAddress || 'No address available yet.'}
                      </div>
                      {remoteStatus.pairingUrl && (
                        <button
                          type="button"
                          className="remote-pairing-modal__copy-btn"
                          onClick={() => {
                            void navigator.clipboard.writeText(remoteStatus.pairingUrl!)
                            setIsLinkCopied(true)
                            setTimeout(() => setIsLinkCopied(false), 2000)
                          }}
                        >
                          {isLinkCopied ? 'Copied!' : 'Copy Link'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="remote-pairing-modal__footer-details">
                  <div className="remote-pairing-modal__additional-section">
                    <h3>Available Addresses</h3>
                    <div className="remote-pairing-modal__additional-list">
                      {remoteAddresses.map((address) => (
                        <button
                          key={address}
                          type="button"
                          className={`remote-pairing-modal__address-row-btn${address === preferredRemoteAddress ? ' remote-pairing-modal__address-row-btn--active' : ''}`}
                          onClick={() => void selectPairingAddress(address)}
                          title={`Generate QR for ${address}`}
                        >
                          <span className="remote-pairing-modal__address-label">{address}</span>
                          {address === preferredRemoteAddress && (
                            <span className="remote-pairing-modal__address-active-badge">QR Active</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="remote-pairing-modal__status-info">
                    <div className="remote-pairing-modal__tip">
                      Best for mobile: Scan the QR code. Use the link for manual entry on desktop.
                    </div>
                    <p className="remote-pairing-modal__expires-text">
                      Expires {remoteStatus.pairingExpiresAt ? new Date(remoteStatus.pairingExpiresAt).toLocaleString() : 'soon'}.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="remote-pairing-modal__copy">Start the remote server first to generate a pairing QR code.</p>
            )}
            <div className="project-edit-actions">
              <button type="button" className="project-edit-cancel" onClick={() => setIsPairingModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
                  <div className={`emoji-picker-popover${isEmojiPickerOpen ? '' : ' emoji-picker-popover--hidden'}`}>
                    <EmojiPicker
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
                '--project-color': editingColor,
              } as React.CSSProperties}
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
