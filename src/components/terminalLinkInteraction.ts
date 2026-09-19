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

export type BrowserHandoffPlatform = 'ios' | 'android'

/**
 * The platforms whose browser app can be reached by URL scheme. An installed
 * web app opens `window.open` in an in-app sheet on both, so the scheme is the
 * only way into the browser the user actually uses.
 */
export function detectBrowserHandoffPlatform(nav: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
}): BrowserHandoffPlatform | null {
  if (/Android/i.test(nav.userAgent)) return 'android'
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return 'ios'
  // iPadOS reports itself as a Mac; only the touch points give it away.
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) return 'ios'
  return null
}

/**
 * A URL that hands a credential-free HTTP or HTTPS link to the platform
 * browser app: `x-safari-` on iOS 17+, a Chrome intent on Android. Neither is
 * a web standard, so callers keep an ordinary open alongside it.
 */
export function platformBrowserUrl(uri: string, platform: BrowserHandoffPlatform): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  if (platform === 'ios') return `x-safari-${url.href}`
  const scheme = url.protocol.slice(0, -1)
  const rest = url.href.slice(url.protocol.length + 2)
  return `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`
}
