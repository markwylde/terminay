import type { IDockviewPanelProps } from 'dockview'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  LARGE_FILE_THRESHOLD_BYTES,
  createFileDraftBuffer,
  createFileSessionStore,
  detectFileCapabilities,
  termideFileGateway,
} from '../../services/fileViewer'
import type { FileInfo, FileViewerEngine, GitFileDiff } from '../../types/fileViewer'
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
  const [isDirty, setIsDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [showEngineChoice, setShowEngineChoice] = useState(false)
  const [truncatedForPerformance, setTruncatedForPerformance] = useState(false)
  const [previewSourceUrl, setPreviewSourceUrl] = useState<string | null>(null)
  const previewObjectUrlRef = useRef<string | null>(null)
  const draftBufferRef = useRef(createFileDraftBuffer({ text: '' }))

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
  const sessionStoreRef = useRef(sessionStore)
  const truncatedForPerformanceRef = useRef(truncatedForPerformance)

  fileInfoRef.current = fileInfo
  sessionStoreRef.current = sessionStore
  truncatedForPerformanceRef.current = truncatedForPerformance

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

      try {
        const nextDiff = await termideFileGateway.getFileDiff(filePath)
        if (isMounted) {
          setDiff(nextDiff)
        }
      } catch {
        if (isMounted) {
          setDiff(null)
        }
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
  }, [filePath, preferredEngine, props.api])

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
        setTruncatedForPerformance(false)
      }
    }

    void loadContent()

    return () => {
      isMounted = false
    }
  }, [engine, fileInfo, mode, showEngineChoice])

  useEffect(() => {
    if (!fileInfo) {
      return
    }

    void termideFileGateway.watchFile(fileInfo.path)
    const dispose = termideFileGateway.onFileWatchEvent(async (event) => {
      if (event.path !== fileInfo.path) {
        return
      }

      if (isDirty) {
        setConflict(true)
        sessionStore?.setConflict({
          diskMtimeMs: event.mtimeMs ?? 0,
          kind: 'external-change',
        })
        return
      }

      const nextInfo = await termideFileGateway.getFileInfo(fileInfo.path)
      setFileInfo(nextInfo)
      sessionStore?.setFile(nextInfo)

      if (!nextInfo.isBinary) {
        const text = await termideFileGateway.readFileText(nextInfo.path)
        setDraftText(text)
        draftBufferRef.current.replaceText(text)
        setTruncatedForPerformance(false)
      } else if (mode === 'hex') {
        setTruncatedForPerformance(false)
      }
    })

    return () => {
      dispose()
      void termideFileGateway.unwatchFile(fileInfo.path)
    }
  }, [fileInfo, isDirty, mode, sessionStore])

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

        const nextInfo = await termideFileGateway.saveFile(currentFileInfo.path, draftBufferRef.current.getPayload())
        setFileInfo(nextInfo)
        setIsDirty(false)
        sessionStoreRef.current?.setDirty(false)
        setConflict(false)
        sessionStoreRef.current?.setConflict({ kind: 'none' })
        return true
      },
      preferredEngine: engine,
    })
  }, [engine, fileInfo, isDirty, props])

  if (!fileInfo) {
    return <div className="file-panel file-panel--loading">Loading file…</div>
  }

  const capabilities = detectFileCapabilities(fileInfo)
  const effectiveMode =
    mode === 'preview' && !capabilities.canPreview
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
            diff: !capabilities.canDiff,
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
            onChangeByte={(offset, value) => {
              draftBufferRef.current.setByte(offset, value)
              const dirty = draftBufferRef.current.isDirty()
              setIsDirty(dirty)
              sessionStore?.setDirty(dirty)
            }}
          />
        ) : null}
        {effectiveMode === 'diff' ? <DiffViewer diff={diff} layout={sessionStore?.getState().diffLayout ?? 'side-by-side'} /> : null}
      </div>

      <FileStatusBar file={fileInfo} engine={engine} isDirty={isDirty} />
    </div>
  )
}
