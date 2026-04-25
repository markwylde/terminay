import type { IDockviewPanelProps } from 'dockview'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LARGE_FILE_THRESHOLD_BYTES,
  createFileDraftBuffer,
  createFileSessionStore,
  detectFileCapabilities,
  termideFileGateway,
} from '../../services/fileViewer'
import type { FileInfo, FileViewerEngine, GitFileDiff } from '../../types/fileViewer'
import type { FileViewerGitRepoInfo } from '../../types/termide'
import { FileConflictBanner } from './FileConflictBanner'
import { FileLargeFileChooser } from './FileLargeFileChooser'
import { FileModeSwitcher } from './FileModeSwitcher'
import { FileStatusBar } from './FileStatusBar'
import { DiffViewer } from './modes/DiffViewer'
import { HexViewer } from './modes/HexViewer'
import { PreviewViewer } from './modes/PreviewViewer'
import { TextViewer } from './modes/TextViewer'
import type { FilePanelInstanceParams } from './types'
import './fileViewer.css'

const MAX_PERFORMANT_TEXT_BYTES = 1024 * 1024

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function FilePanel(props: IDockviewPanelProps<FilePanelInstanceParams>) {
  const { filePath, initialMode, preferredEngine = 'auto' } = props.params
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(props.params.fileInfo ?? null)
  const [draftText, setDraftText] = useState('')
  const [engine, setEngine] = useState<FileViewerEngine>(preferredEngine)
  const [mode, setMode] = useState(initialMode ?? 'preview')
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffStatus, setDiffStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [gitRepoInfo, setGitRepoInfo] = useState<FileViewerGitRepoInfo | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isHexValid, setIsHexValid] = useState(true)
  const [conflict, setConflict] = useState(false)
  const [showEngineChoice, setShowEngineChoice] = useState(false)
  const [truncatedForPerformance, setTruncatedForPerformance] = useState(false)
  const [previewSourceUrl, setPreviewSourceUrl] = useState<string | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)
  const draftBufferRef = useRef(createFileDraftBuffer({ text: '' }))
  const currentTextGetterRef = useRef<(() => string) | null>(null)
  const isMountedRef = useRef(true)

  const sessionStore = useMemo(
    () =>
      fileInfo
        ? createFileSessionStore(fileInfo, {
            engine,
            mode,
          })
        : null,
    [engine, fileInfo, mode],
  )
  const fileInfoRef = useRef<FileInfo | null>(fileInfo)
  const isDirtyRef = useRef(isDirty)
  const isHexValidRef = useRef(isHexValid)
  const modeRef = useRef(mode)
  const sessionStoreRef = useRef(sessionStore)
  const truncatedForPerformanceRef = useRef(truncatedForPerformance)

  fileInfoRef.current = fileInfo
  isDirtyRef.current = isDirty
  isHexValidRef.current = isHexValid
  modeRef.current = mode
  sessionStoreRef.current = sessionStore
  truncatedForPerformanceRef.current = truncatedForPerformance
  const watchedFilePath = fileInfo?.path ?? null

  const handleHexValidationChange = useCallback((isValid: boolean) => {
    setIsHexValid(isValid)
  }, [])

  const handleCurrentTextGetterChange = useCallback((getter: (() => string) | null) => {
    currentTextGetterRef.current = getter
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const refreshDiff = useCallback(
    async (targetPath: string, options?: { keepPrevious?: boolean }) => {
      if (!isMountedRef.current) {
        return
      }
      if (!options?.keepPrevious) {
        setDiff(null)
      }
      setDiffError(null)
      setDiffStatus('loading')

      try {
        const [nextRepoInfo, nextDiff] = await Promise.all([
          termideFileGateway.getGitRepoInfo(targetPath),
          termideFileGateway.getFileDiff(targetPath),
        ])
        if (!isMountedRef.current) {
          return
        }
        setGitRepoInfo(nextRepoInfo)
        setDiff(nextDiff)
        setDiffStatus('ready')
      } catch (error) {
        if (!isMountedRef.current) {
          return
        }
        setGitRepoInfo(null)
        if (!options?.keepPrevious) {
          setDiff(null)
        }
        setDiffError(error instanceof Error ? error.message : String(error))
        setDiffStatus('error')
      }
    },
    [],
  )

  useEffect(() => {
    let isMounted = true

    const load = async () => {
      const info = await termideFileGateway.getFileInfo(filePath)
      if (!isMounted) {
        return
      }

      setFileInfo(info)
      props.api.setTitle(info.name)
      const capabilities = detectFileCapabilities(info)
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current)
        previewObjectUrlRef.current = null
      }
      if (capabilities.previewKind === 'image' || capabilities.previewKind === 'pdf') {
        try {
          const byteRange = await termideFileGateway.readFileBytes(filePath, {
            length: info.size,
            offset: 0,
          })
          const byteArray = decodeBase64ToUint8Array(byteRange.base64)
          const objectUrl = URL.createObjectURL(
            new Blob([toArrayBuffer(byteArray)], {
              type: info.mimeType ?? (capabilities.previewKind === 'pdf' ? 'application/pdf' : 'application/octet-stream'),
            }),
          )
          if (isMounted) {
            previewObjectUrlRef.current = objectUrl
            setPreviewSourceUrl(objectUrl)
          } else {
            URL.revokeObjectURL(objectUrl)
          }
        } catch {
          if (isMounted) {
            setPreviewSourceUrl(null)
          }
        }
      } else if (isMounted) {
        setPreviewSourceUrl(null)
      }

      if (capabilities.shouldPromptForEngineChoice && preferredEngine === 'auto') {
        setShowEngineChoice(true)
        setEngine('auto')
        return
      }

      if (isMounted) {
        void refreshDiff(filePath)
      }
    }

    void load()

    return () => {
      isMounted = false
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current)
        previewObjectUrlRef.current = null
      }
    }
  }, [filePath, preferredEngine, props.api, refreshDiff])

  useEffect(() => {
    if (!fileInfo) {
      return
    }

    if (showEngineChoice && engine === 'auto') {
      return
    }

    let isMounted = true

    const loadContent = async () => {
      const previewKind = detectFileCapabilities(fileInfo).previewKind

      if ((previewKind === 'image' || previewKind === 'pdf') && mode === 'preview') {
        setTruncatedForPerformance(false)
        setDraftText('')
        return
      }

      if (!fileInfo.isBinary) {
        if (engine === 'performant' && fileInfo.size > LARGE_FILE_THRESHOLD_BYTES) {
          const response = await window.termide.readFileText({
            length: Math.min(fileInfo.size, MAX_PERFORMANT_TEXT_BYTES),
            path: fileInfo.path,
            start: 0,
          })
          if (!isMounted) {
            return
          }
          const nextText = `${response.text}\n\n[Large file truncated in Performant mode. Switch to Monaco for the full file.]`
          setDraftText(nextText)
          draftBufferRef.current.replaceText(nextText)
          setTruncatedForPerformance(true)
          return
        }

        const text = await termideFileGateway.readFileText(fileInfo.path)
        if (!isMounted) {
          return
        }
        setDraftText(text)
        draftBufferRef.current.replaceText(text)
        setTruncatedForPerformance(false)
      } else if (mode === 'hex') {
        if (fileInfo.size <= LARGE_FILE_THRESHOLD_BYTES) {
          const response = await termideFileGateway.readFileBytes(fileInfo.path, {
            length: fileInfo.size,
            offset: 0,
          })
          if (!isMounted) {
            return
          }
          draftBufferRef.current.replaceBytes(response.base64)
        }
        setTruncatedForPerformance(false)
      }
    }

    void loadContent()

    return () => {
      isMounted = false
    }
  }, [engine, fileInfo, mode, showEngineChoice])

  useEffect(() => {
    if (!watchedFilePath) {
      return
    }

    const watchedPath = watchedFilePath
    let debounceId: number | null = null
    let refreshVersion = 0
    let disposed = false

    void termideFileGateway.watchFile(watchedPath)
    const dispose = termideFileGateway.onFileWatchEvent(async (event) => {
      if (event.path !== watchedPath) {
        return
      }

      if (isDirtyRef.current) {
        setConflict(true)
        sessionStoreRef.current?.setConflict({
          diskMtimeMs: event.mtimeMs ?? 0,
          kind: 'external-change',
        })
        return
      }

      if (debounceId !== null) {
        window.clearTimeout(debounceId)
      }

      debounceId = window.setTimeout(() => {
        debounceId = null
        const requestVersion = ++refreshVersion

        void (async () => {
          const nextInfo = await termideFileGateway.getFileInfo(watchedPath)
          if (disposed || requestVersion !== refreshVersion) {
            return
          }

          setFileInfo(nextInfo)
          sessionStoreRef.current?.setFile(nextInfo)

          if (modeRef.current === 'hex') {
            setTruncatedForPerformance(false)
          }

          if (modeRef.current === 'diff') {
            void refreshDiff(nextInfo.path, { keepPrevious: true })
          }
        })()
      }, 150)
    })

    return () => {
      disposed = true
      refreshVersion += 1
      if (debounceId !== null) {
        window.clearTimeout(debounceId)
      }
      dispose()
      void termideFileGateway.unwatchFile(watchedPath)
    }
  }, [watchedFilePath, refreshDiff])

  useEffect(() => {
    if (mode !== 'diff' || !watchedFilePath) {
      return
    }

    void refreshDiff(watchedFilePath, { keepPrevious: true })
  }, [mode, refreshDiff, watchedFilePath])

  useEffect(() => {
    props.api.updateParameters({
      ...props.params,
      fileInfo: fileInfo ?? undefined,
      isDirty,
      isFocused: props.containerApi.activePanel?.id === props.api.id,
      onSave: async () => {
        const currentFileInfo = fileInfoRef.current
        if (!currentFileInfo) {
          return false
        }

        if (truncatedForPerformanceRef.current) {
          throw new Error('Switch to Monaco before saving this large file so the full file contents are loaded.')
        }

        if (modeRef.current === 'hex' && !isHexValidRef.current) {
          throw new Error('Fix invalid HEX byte values before saving.')
        }

        if (modeRef.current === 'text') {
          const currentText = currentTextGetterRef.current?.()
          if (currentText !== undefined) {
            setDraftText(currentText)
            draftBufferRef.current.setText(currentText)
          }
        }

        const payload = draftBufferRef.current.getPayload()
        const nextInfo = await termideFileGateway.saveFile(currentFileInfo.path, payload)
        if (payload.kind === 'text') {
          const savedText = await termideFileGateway.readFileText(nextInfo.path)
          if (savedText !== payload.text) {
            throw new Error('Save failed: disk contents did not match the editor contents.')
          }
        } else {
          const savedBytes = await termideFileGateway.readFileBytes(nextInfo.path, {
            length: nextInfo.size,
            offset: 0,
          })
          if (savedBytes.base64 !== payload.base64) {
            throw new Error('Save failed: disk bytes did not match the editor contents.')
          }
        }
        if (payload.kind === 'text') {
          draftBufferRef.current.replaceText(payload.text)
        } else {
          draftBufferRef.current.replaceBytes(payload.base64)
        }
        setFileInfo(nextInfo)
        setIsDirty(false)
        sessionStoreRef.current?.setDirty(false)
        setConflict(false)
        sessionStoreRef.current?.setConflict({ kind: 'none' })
        await refreshDiff(nextInfo.path)
        return true
      },
      preferredEngine: engine,
    })
  }, [engine, fileInfo, isDirty, props, refreshDiff])

  if (!fileInfo) {
    return <div className="file-panel file-panel--loading">Loading file…</div>
  }

  const capabilities = detectFileCapabilities(fileInfo)
  const canDiff = gitRepoInfo?.canDiff === true || diffStatus === 'loading'
  const effectiveMode =
    mode === 'preview' && !capabilities.canPreview
      ? capabilities.fallbackMode
      : mode === 'diff' && !canDiff
        ? capabilities.fallbackMode
        : mode

  return (
    <div className="file-panel">
      {conflict ? (
        <FileConflictBanner
          onKeepLocal={() => {
            setConflict(false)
            sessionStore?.setConflict({ kind: 'none' })
          }}
          onReload={async () => {
            const nextInfo = await termideFileGateway.getFileInfo(fileInfo.path)
            setFileInfo(nextInfo)
            if (!nextInfo.isBinary) {
              setDraftText(await termideFileGateway.readFileText(nextInfo.path))
            }
            setIsDirty(false)
            setConflict(false)
            sessionStore?.setDirty(false)
            sessionStore?.setConflict({ kind: 'none' })
          }}
        />
      ) : null}

      <div className="file-panel__toolbar">
        <FileModeSwitcher
          activeMode={mode}
          disabledModes={{
            diff: !canDiff,
            preview: !capabilities.canPreview,
            text: !capabilities.canEditText,
          }}
          onChangeMode={setMode}
        />
        {capabilities.shouldPromptForEngineChoice && showEngineChoice ? (
          <FileLargeFileChooser
            fileName={fileInfo.name}
            fileSize={fileInfo.size}
            onChoose={(choice) => {
              setEngine(choice)
              setShowEngineChoice(false)
              sessionStore?.setEngine(choice)
            }}
          />
        ) : null}
        {truncatedForPerformance ? (
          <div className="file-toolbar__fallback">
            Showing a truncated window in Performant mode. Switch to Monaco to load the full file.
          </div>
        ) : null}
      </div>

      <div className="file-panel__body">
        {effectiveMode === 'preview' ? <PreviewViewer file={fileInfo} previewSourceUrl={previewSourceUrl} text={draftText} /> : null}
        {effectiveMode === 'text' ? (
          capabilities.canEditText ? (
            <TextViewer
              engine={engine}
              filePath={fileInfo.path}
              language={fileInfo.extension.replace(/^\./, '')}
              text={draftText}
              onCurrentTextGetterChange={handleCurrentTextGetterChange}
              onChangeText={(text) => {
                setDraftText(text)
                draftBufferRef.current.setText(text)
                const dirty = draftBufferRef.current.isDirty()
                setIsDirty(dirty)
                sessionStore?.setDirty(dirty)
              }}
            />
          ) : (
            <div className="file-preview-unsupported">Text view is not available for this binary file. Use HEX instead.</div>
          )
        ) : null}
        {effectiveMode === 'hex' ? (
          <HexViewer
            filePath={fileInfo.path}
            fileSize={fileInfo.size}
            onValidationChange={handleHexValidationChange}
            onChangeByte={(offset, value) => {
              draftBufferRef.current.setByte(offset, value)
              const dirty = draftBufferRef.current.isDirty()
              setIsDirty(dirty)
              sessionStore?.setDirty(dirty)
            }}
          />
        ) : null}
        {effectiveMode === 'diff' ? (
          <DiffViewer
            diff={diff}
            error={diffError}
            filePath={fileInfo.path}
            isLoading={diffStatus === 'loading'}
            layout={sessionStore?.getState().diffLayout ?? 'side-by-side'}
          />
        ) : null}
      </div>

      <FileStatusBar file={fileInfo} engine={engine} isDirty={isDirty} isValid={effectiveMode !== 'hex' || isHexValid} />
    </div>
  )
}
