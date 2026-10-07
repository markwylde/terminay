/**
 * An HTML file shown as the page it describes (ADR-0042).
 *
 * The page runs in the same sandbox proxy as an app window's view: an
 * opaque-origin frame with no Terminay authority. Everything it shows was
 * inlined into its document by `buildHtmlPreviewDocument`; the frame itself
 * fetches nothing. Each edit builds a new document and a new frame, because a
 * proxy's frame holds only the document it was first given.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { openExternalUrl } from '../../../host/nativeActions'
import {
  APP_VIEW_PROXY_KEY,
  APP_VIEW_PROXY_READY,
  APP_VIEW_RESOURCE_READY,
  APP_VIEW_SANDBOX,
  appViewAvailable,
  appViewProxyUrl,
} from '../../../workspace/appWindows/appViewAvailability'
import { FILE_VIEW_READY_KEY } from '../../../workspace/appWindows/viewDocument'
import {
  buildHtmlPreviewDocument,
  type HtmlPreviewCache,
  type HtmlPreviewRead,
} from './htmlPreviewDocument'
import { type PreviewLinkState, previewLinkToOpen } from './htmlPreviewLinks'

/** How long after the last edit the page is rebuilt. */
const REBUILD_DELAY_MS = 300
/** How long a new page may take to say it has parsed before it is shown anyway. */
const READY_TIMEOUT_MS = 1500
/** Focus that arrives this soon after a Tab press came from the keyboard. */
const FOCUS_BY_TAB_MS = 500

export const HTML_PREVIEW_UNAVAILABLE_REASON =
  'Preview needs a sandboxed frame, which this host cannot run.'

export type HtmlPreviewResources = {
  /** The file's folder, relative to the project root. */
  baseDirectory: string
  read: HtmlPreviewRead
}

type HtmlPreviewProps = {
  name: string
  resources?: HtmlPreviewResources
  text: string
}

type Page = {
  id: number
  html: string
  incomplete: boolean
  ready: boolean
}

const NO_RESOURCES: HtmlPreviewResources = {
  baseDirectory: '',
  read: () => Promise.reject(new Error('Project files are unavailable.')),
}

export function HtmlPreview({ name, resources = NO_RESOURCES, text }: HtmlPreviewProps) {
  const { baseDirectory, read } = resources
  const [available, setAvailable] = useState<boolean | undefined>(undefined)
  const [pages, setPages] = useState<Page[]>([])
  const [gone, setGone] = useState(false)
  const [reloads, setReloads] = useState(0)
  // Dropped with the component, so leaving Preview and coming back reads the
  // page's resources afresh.
  const cacheRef = useRef<HtmlPreviewCache>(new Map())
  const linkStateRef = useRef<PreviewLinkState>({ lastOpenedAt: 0 })
  const sequenceRef = useRef(0)
  const builtOnceRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    void appViewAvailable().then((value) => {
      if (!cancelled) setAvailable(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // `reloads` is a dependency so that Reload builds the same page again.
  useEffect(() => {
    if (available !== true) return
    let cancelled = false
    const delay = builtOnceRef.current ? REBUILD_DELAY_MS : 0
    builtOnceRef.current = true
    const timer = setTimeout(() => {
      void buildHtmlPreviewDocument({ html: text, baseDirectory, read, cache: cacheRef.current }).then(
        (built) => {
          if (cancelled) return
          sequenceRef.current += 1
          const page: Page = {
            id: sequenceRef.current,
            html: built.html,
            incomplete: built.incomplete,
            ready: false,
          }
          setGone(false)
          // The page on screen stays until the new one has parsed.
          setPages((previous) => [...previous.filter((candidate) => candidate.ready).slice(-1), page])
        },
      )
    }, delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [available, text, baseDirectory, read, reloads])

  const onReady = useCallback((id: number) => {
    setPages((previous) =>
      previous
        .filter((page) => page.id >= id)
        .map((page) => (page.id === id ? { ...page, ready: true } : page)),
    )
  }, [])
  const onGone = useCallback((id: number) => {
    // Only the newest page leaving is the preview leaving; an older one was
    // about to be replaced anyway.
    if (id === sequenceRef.current) setGone(true)
    setPages((previous) => previous.filter((page) => page.id !== id))
  }, [])

  if (available === undefined) {
    return <div className="file-preview-html file-preview-html--loading" aria-busy="true" />
  }
  if (!available) {
    return <div className="file-preview-unsupported">{HTML_PREVIEW_UNAVAILABLE_REASON}</div>
  }

  const shown = pages.find((page) => page.ready) ?? pages.at(-1)
  return (
    <div className="file-preview-html">
      {gone ? (
        <div className="file-preview-html__notice" role="status">
          <span>The page navigated away.</span>
          <button
            type="button"
            onClick={() => {
              cacheRef.current = new Map()
              setReloads((count) => count + 1)
            }}
          >
            Reload
          </button>
        </div>
      ) : null}
      {!gone && shown?.incomplete === true ? (
        <div className="file-preview-html__notice" role="status">
          <span>Some resources were not loaded.</span>
        </div>
      ) : null}
      <div className="file-preview-html__stage">
        {pages.map((page) => (
          <PageFrame
            key={page.id}
            hidden={page !== shown}
            linkState={linkStateRef.current}
            name={name}
            onGone={onGone}
            onReady={onReady}
            page={page}
          />
        ))}
      </div>
    </div>
  )
}

type PageFrameProps = {
  hidden: boolean
  linkState: PreviewLinkState
  name: string
  onGone: (id: number) => void
  onReady: (id: number) => void
  page: Page
}

/** One document in one proxy frame. */
function PageFrame({ hidden, linkState, name, onGone, onReady, page }: PageFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const focusQuestionRef = useRef(0)

  useEffect(() => {
    let resourceSent = false
    const timer = setTimeout(() => onReady(page.id), READY_TIMEOUT_MS)
    const onMessage = (event: MessageEvent): void => {
      const frame = frameRef.current
      if (frame === null || event.source !== frame.contentWindow) return
      const data = event.data as Record<string, unknown> | null
      if (typeof data !== 'object' || data === null) return
      if (data.method === APP_VIEW_PROXY_READY) {
        // Once per proxy document: its frame takes one document and no other.
        if (resourceSent) return
        resourceSent = true
        frame.contentWindow?.postMessage(
          { jsonrpc: '2.0', method: APP_VIEW_RESOURCE_READY, params: { html: page.html, allow: '' } },
          '*',
        )
        return
      }
      // What the proxy says about the page, which the page cannot send.
      const proxy = data[APP_VIEW_PROXY_KEY] as { type?: unknown; id?: unknown; active?: unknown } | undefined
      if (typeof proxy === 'object' && proxy !== null) {
        if (proxy.type === 'view-gone') onGone(page.id)
        else if (
          proxy.type === 'activation' &&
          proxy.id === focusQuestionRef.current &&
          proxy.active !== true &&
          document.activeElement === frame
        ) {
          // The page took the keyboard itself. Keys meant for the workspace
          // would go to it, and one would count as the gesture that lets it
          // open a link.
          frame.blur()
        }
        return
      }
      if (data[FILE_VIEW_READY_KEY] === 'ready') {
        onReady(page.id)
        return
      }
      const url = previewLinkToOpen(data, linkState, {
        now: Date.now(),
        userActive: navigator.userActivation?.isActive === true,
      })
      if (url !== undefined) void openExternalUrl(url)
    }
    window.addEventListener('message', onMessage)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [page.id, page.html, linkState, onGone, onReady])

  // When the focus moves into the frame other than by Tab, the proxy is asked
  // whether a person has just acted in the page; the answer is handled above.
  useEffect(() => {
    let lastTab = 0
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') lastTab = Date.now()
    }
    const onBlur = (): void => {
      setTimeout(() => {
        const frame = frameRef.current
        if (frame === null || document.activeElement !== frame) return
        if (Date.now() - lastTab < FOCUS_BY_TAB_MS) return
        focusQuestionRef.current += 1
        frame.contentWindow?.postMessage(
          { [APP_VIEW_PROXY_KEY]: { type: 'activation?', id: focusQuestionRef.current } },
          '*',
        )
      }, 0)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  return (
    <iframe
      ref={frameRef}
      className="file-preview-html__frame"
      data-ready={page.ready ? 'true' : 'false'}
      hidden={hidden}
      title={`Preview of ${name}`}
      src={appViewProxyUrl()}
      sandbox={APP_VIEW_SANDBOX}
      referrerPolicy="no-referrer"
    />
  )
}
