const LINK_OPEN_DEDUPE_WINDOW_MS = 500

interface PointerStyleTarget {
  style: {
    cursor: string
  }
}

interface LinkActivationEvent {
  ctrlKey: boolean
  metaKey: boolean
  preventDefault(): void
}

export interface TerminalLinkInteraction {
  activate(event: LinkActivationEvent, uri: string): void
  hover(): void
  leave(): void
}

/**
 * Keeps xterm's OSC-8 and detected-web-link handlers on the same safe UI
 * path. A failed browser handoff must not create an unhandled rejection or
 * make the link temporarily impossible to retry.
 */
export function createTerminalLinkInteraction(options: {
  isMac: boolean
  openExternal(uri: string): Promise<unknown> | unknown
  pointerTarget: PointerStyleTarget
  now?: () => number
}): TerminalLinkInteraction {
  const now = options.now ?? (() => performance.now())
  let lastOpenedLink: { uri: string; openedAt: number } | undefined

  return {
    activate(event, uri) {
      const modifierKey = options.isMac ? event.metaKey : event.ctrlKey
      if (!modifierKey) {
        return
      }

      event.preventDefault()
      const openedAt = now()
      if (lastOpenedLink?.uri === uri && openedAt - lastOpenedLink.openedAt < LINK_OPEN_DEDUPE_WINDOW_MS) {
        return
      }

      const attempt = { uri, openedAt }
      lastOpenedLink = attempt
      void Promise.resolve(options.openExternal(uri)).catch(() => {
        // Do not surface a rejected native handoff as an unhandled promise,
        // and allow the user to immediately try the same link again.
        if (lastOpenedLink === attempt) {
          lastOpenedLink = undefined
        }
      })
    },
    hover() {
      options.pointerTarget.style.cursor = 'pointer'
    },
    leave() {
      options.pointerTarget.style.cursor = ''
    },
  }
}
