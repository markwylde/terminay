import type { Monaco } from '@monaco-editor/react'
import type { editor, IDisposable, IRange, Position } from 'monaco-editor'
import type {
  LanguageCompletionKind,
  LanguageDiagnosticSeverity,
  LanguageDiagnosticsEventDto,
  LanguageRange,
} from '@terminay/protocol'
import type { LanguageGateway } from '../../services/fileViewer/languageGateway'

/**
 * Monaco adapters for the server's language intelligence. The editor learns
 * nothing about the Language Server Protocol here: it consumes the bounded DTOs
 * the language gateway returns and degrades to highlighting when the server has
 * no provider for a file, the session is unavailable, or a request fails.
 */

export const LANGUAGE_MARKER_OWNER = 'terminay'

const COMPLETION_TRIGGER_CHARACTERS = ['.', '"', "'", '/', '@', '<', ':']

/**
 * Definition targets in other files open through the ordinary file-viewer open
 * path. The requested range is left here for the panel that renders the file to
 * pick up, because that panel may still be mounting.
 *
 * A window holds several connections, and an absolute path is not unique across
 * them: two servers restored from one data root have the same file at the same
 * path. Entries are therefore keyed by the language session that asked for them
 * as well as the path, so one server's jump cannot be claimed by another's
 * panel. Unclaimed entries expire: a target whose panel never mounted must not
 * reveal a range in some file opened minutes later.
 */
const PENDING_REVEAL_TTL_MS = 30_000
const pendingReveals = new Map<
  string,
  Readonly<{ range: LanguageRange; expiresAt: number }>
>()
const REVEAL_EVENT = 'terminay-file-reveal-range'

/** One opaque id per gateway, so the key names the connection without the
 * providers having to learn what a connection is. */
const revealScopes = new WeakMap<object, string>()
let revealScopesIssued = 0

export function revealScopeFor(gateway: object): string {
  const existing = revealScopes.get(gateway)
  if (existing !== undefined) return existing
  revealScopesIssued += 1
  const scope = `lang-${revealScopesIssued}`
  revealScopes.set(gateway, scope)
  return scope
}

function pendingRevealKey(scope: string, absolutePath: string): string {
  return `${scope}\u0000${absolutePath}`
}

function prunePendingReveals(now: number): void {
  for (const [key, entry] of pendingReveals)
    if (entry.expiresAt <= now) pendingReveals.delete(key)
}

function takePendingReveal(key: string): LanguageRange | undefined {
  const now = Date.now()
  prunePendingReveals(now)
  const entry = pendingReveals.get(key)
  if (entry === undefined) return undefined
  pendingReveals.delete(key)
  return entry.range
}

export function toMonacoCompletionKind(
  monaco: Monaco,
  kind: LanguageCompletionKind | undefined,
): number {
  const kinds = monaco.languages.CompletionItemKind
  switch (kind) {
    case 'method': return kinds.Method
    case 'function': return kinds.Function
    case 'constructor': return kinds.Constructor
    case 'field': return kinds.Field
    case 'variable': return kinds.Variable
    case 'class': return kinds.Class
    case 'interface': return kinds.Interface
    case 'module': return kinds.Module
    case 'property': return kinds.Property
    case 'unit': return kinds.Unit
    case 'value': return kinds.Value
    case 'enum': return kinds.Enum
    case 'keyword': return kinds.Keyword
    case 'snippet': return kinds.Snippet
    case 'color': return kinds.Color
    case 'file': return kinds.File
    case 'reference': return kinds.Reference
    case 'folder': return kinds.Folder
    case 'enumMember': return kinds.EnumMember
    case 'constant': return kinds.Constant
    case 'struct': return kinds.Struct
    case 'event': return kinds.Event
    case 'operator': return kinds.Operator
    case 'typeParameter': return kinds.TypeParameter
    default: return kinds.Text
  }
}

export function toMonacoMarkerSeverity(
  monaco: Monaco,
  severity: LanguageDiagnosticSeverity,
): number {
  switch (severity) {
    case 'error': return monaco.MarkerSeverity.Error
    case 'warning': return monaco.MarkerSeverity.Warning
    case 'information': return monaco.MarkerSeverity.Info
    default: return monaco.MarkerSeverity.Hint
  }
}

/** Protocol positions are zero-based; Monaco ranges are one-based. */
export function toMonacoRange(range: LanguageRange): IRange {
  return {
    endColumn: range.end.character + 1,
    endLineNumber: range.end.line + 1,
    startColumn: range.start.character + 1,
    startLineNumber: range.start.line + 1,
  }
}

export function toMonacoMarkers(
  monaco: Monaco,
  event: LanguageDiagnosticsEventDto,
): editor.IMarkerData[] {
  return event.diagnostics.map((diagnostic) => ({
    ...toMonacoRange(diagnostic.range),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    message: diagnostic.message,
    severity: toMonacoMarkerSeverity(monaco, diagnostic.severity),
    source: diagnostic.source ?? LANGUAGE_MARKER_OWNER,
  })) as editor.IMarkerData[]
}

function joinProjectPath(projectRoot: string, relativePath: string): string {
  const root = projectRoot.replace(/[/\\]+$/, '')
  return root.length === 0 ? relativePath : `${root}/${relativePath}`
}

/** Opens a definition target the ordinary way: the same window event the file
 * explorer and Markdown links use, followed by a reveal request for the range. */
export function openDefinitionTarget(
  absolutePath: string,
  range: LanguageRange,
  scope: string,
): void {
  const now = Date.now()
  prunePendingReveals(now)
  pendingReveals.set(pendingRevealKey(scope, absolutePath), {
    range,
    expiresAt: now + PENDING_REVEAL_TTL_MS,
  })
  window.dispatchEvent(
    new CustomEvent('terminay-open-file', {
      detail: { initialMode: 'text', path: absolutePath },
    }),
  )
  window.dispatchEvent(
    new CustomEvent(REVEAL_EVENT, { detail: { path: absolutePath, range, scope } }),
  )
}

export type LanguageAttachment = Readonly<{ dispose: () => void }>

export type LanguageAttachmentOptions = Readonly<{
  absolutePath: string
  editor: editor.IStandaloneCodeEditor
  gateway: LanguageGateway
  languageId: string
  monaco: Monaco
  /** Project-relative POSIX path; the only path shape the protocol accepts. */
  path: string
  projectId: string
  projectRoot: string
}>

/**
 * Wires one Monaco model to one server language session: opens the document,
 * pushes changes, registers the completion, hover, and definition providers for
 * that model only, and applies diagnostics as markers keyed by revision.
 */
export function attachLanguageIntelligence(
  options: LanguageAttachmentOptions,
): LanguageAttachment {
  const { absolutePath, editor: codeEditor, gateway, languageId, monaco, path, projectId, projectRoot } = options
  const model = codeEditor.getModel()
  const revealScope = revealScopeFor(gateway)
  const revealKey = pendingRevealKey(revealScope, absolutePath)
  const disposables: IDisposable[] = []
  let unsubscribeDiagnostics: (() => void) | undefined
  let stopped = false
  let appliedRevision = -1
  let opened = false

  const dispose = (): void => {
    if (stopped) return
    stopped = true
    unsubscribeDiagnostics?.()
    unsubscribeDiagnostics = undefined
    for (const disposable of disposables) disposable.dispose()
    disposables.length = 0
    if (model !== null && !model.isDisposed()) {
      monaco.editor.setModelMarkers(model, LANGUAGE_MARKER_OWNER, [])
    }
    if (opened) void gateway.close(projectId, path)
  }

  if (model === null) return { dispose }

  const isOurModel = (candidate: editor.ITextModel): boolean =>
    !model.isDisposed() && candidate.uri.toString() === model.uri.toString()

  const revealRange = (range: LanguageRange): void => {
    const target = toMonacoRange(range)
    codeEditor.revealRangeInCenterIfOutsideViewport(target)
    codeEditor.setSelection(target)
    codeEditor.focus()
  }

  const followDefinition = async (): Promise<void> => {
    const position = codeEditor.getPosition()
    if (position === null) return
    const result = await gateway.definition(projectId, path, {
      character: position.column - 1,
      line: position.lineNumber - 1,
    })
    const location = result?.locations[0]
    if (stopped || location === undefined) return
    if (location.path === path) {
      revealRange(location.range)
      return
    }
    openDefinitionTarget(
      joinProjectPath(projectRoot, location.path),
      location.range,
      revealScope,
    )
  }

  const applyDiagnostics = (event: LanguageDiagnosticsEventDto): void => {
    if (stopped || model.isDisposed()) return
    const current = gateway.revision(projectId, path)
    // A diagnostic computed against an older draft describes text the user has
    // already replaced; leave the editor as it is.
    if (event.revision !== undefined && (event.revision < current || event.revision < appliedRevision)) return
    appliedRevision = event.revision ?? appliedRevision
    monaco.editor.setModelMarkers(model, LANGUAGE_MARKER_OWNER, toMonacoMarkers(monaco, event))
  }

  const revealListener = (event: Event): void => {
    const detail = (event as CustomEvent<{ path?: unknown; range?: unknown; scope?: unknown }>).detail
    if (typeof detail?.path !== 'string' || detail.path !== absolutePath) return
    // Another connection's jump to the same path is not this panel's.
    if (detail.scope !== revealScope) return
    const range =
      takePendingReveal(revealKey) ?? (detail.range as LanguageRange | undefined)
    if (range === undefined) return
    revealRange(range)
  }

  void (async () => {
    const capabilities = await gateway.capabilities(projectId, path)
    if (stopped || capabilities === null) return
    // `none` means no contributed language server selects this file, and
    // `unavailable` means its session cannot serve one. Both stay quiet.
    if (capabilities.state === 'none' || capabilities.state === 'unavailable') return
    opened = await gateway.open(projectId, path, capabilities.languageId ?? languageId, model.getValue())
    if (stopped || !opened) {
      if (stopped && opened) void gateway.close(projectId, path)
      return
    }

    disposables.push(
      codeEditor.onDidChangeModelContent(() => {
        if (model.isDisposed()) return
        void gateway.change(projectId, path, model.getValue())
      }),
    )

    if (capabilities.features.completion) {
      disposables.push(
        monaco.languages.registerCompletionItemProvider(languageId, {
          triggerCharacters: COMPLETION_TRIGGER_CHARACTERS,
          provideCompletionItems: async (candidate: editor.ITextModel, position: Position) => {
            if (!isOurModel(candidate)) return { suggestions: [] }
            const result = await gateway.completion(projectId, path, {
              character: position.column - 1,
              line: position.lineNumber - 1,
            })
            if (result === null) return { suggestions: [] }
            const word = candidate.getWordUntilPosition(position)
            const range: IRange = {
              endColumn: word.endColumn,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              startLineNumber: position.lineNumber,
            }
            return {
              incomplete: result.isIncomplete,
              suggestions: result.items.map((item) => ({
                detail: item.detail,
                documentation:
                  item.documentation === undefined ? undefined : { value: item.documentation },
                filterText: item.filterText,
                insertText: item.insertText ?? item.label,
                kind: toMonacoCompletionKind(monaco, item.kind),
                label: item.label,
                range,
                sortText: item.sortText,
              })),
            }
          },
        }),
      )
    }

    if (capabilities.features.hover) {
      disposables.push(
        monaco.languages.registerHoverProvider(languageId, {
          provideHover: async (candidate: editor.ITextModel, position: Position) => {
            if (!isOurModel(candidate)) return null
            const result = await gateway.hover(projectId, path, {
              character: position.column - 1,
              line: position.lineNumber - 1,
            })
            if (result === null || result.contents === null || result.contents.length === 0) return null
            return {
              contents: [{ value: result.contents }],
              ...(result.range === undefined ? {} : { range: toMonacoRange(result.range) }),
            }
          },
        }),
      )
    }

    if (capabilities.features.definition) {
      disposables.push(
        monaco.languages.registerDefinitionProvider(languageId, {
          provideDefinition: async (candidate: editor.ITextModel, position: Position) => {
            if (!isOurModel(candidate)) return []
            const result = await gateway.definition(projectId, path, {
              character: position.column - 1,
              line: position.lineNumber - 1,
            })
            if (result === null) return []
            // Targets in other files are opened through the file-viewer open
            // path instead, because a standalone editor has no model for them.
            return result.locations
              .filter((location) => location.path === path)
              .map((location) => ({ range: toMonacoRange(location.range), uri: model.uri }))
          },
        }),
        codeEditor.addAction({
          contextMenuGroupId: 'navigation',
          contextMenuOrder: 1.1,
          id: 'terminay.language.goToDefinition',
          keybindings: [monaco.KeyCode.F12],
          label: 'Go to Definition',
          run: () => {
            void followDefinition()
          },
        }),
        codeEditor.onMouseUp((mouseEvent) => {
          if (!mouseEvent.event.ctrlKey && !mouseEvent.event.metaKey) return
          if (mouseEvent.target.position === null) return
          void followDefinition()
        }),
      )
    }

    if (capabilities.features.diagnostics) {
      unsubscribeDiagnostics = gateway.subscribeDiagnostics({ path, projectId }, applyDiagnostics)
    }
  })()

  window.addEventListener(REVEAL_EVENT, revealListener)
  disposables.push({ dispose: () => window.removeEventListener(REVEAL_EVENT, revealListener) })
  const queued = takePendingReveal(revealKey)
  if (queued !== undefined) revealRange(queued)

  return { dispose }
}
