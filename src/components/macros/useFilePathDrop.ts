import { useCallback, useState, type ClipboardEvent, type DragEvent } from 'react'
import { resolveDesktopDroppedFilePath } from '../../host/nativeActions'
import { getDroppedPath, getPastedPath, type DroppedPath } from '../terminalDropInteraction'

const PATH_UNAVAILABLE = "This file's path is not available here. Type or paste the path instead."

const DROP_TYPES = ['Files', 'terminay/path', 'text/uri-list', 'text/plain']

/**
 * Lets a path field take a dropped file, a pasted file or file URL, and
 * typing. The path comes from the same resolution a terminal drop uses; the
 * file itself is never read.
 */
export function useFilePathDrop(onPath: (path: string) => void) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const accept = useCallback(
    (result: DroppedPath | null): boolean => {
      if (result === null) return false
      if (result.kind === 'unavailable') {
        setNotice(PATH_UNAVAILABLE)
        return true
      }
      setNotice(null)
      onPath(result.path)
      return true
    },
    [onPath],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!DROP_TYPES.some((type) => event.dataTransfer.types.includes(type))) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDragOver(false)
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      setIsDragOver(false)
      if (!DROP_TYPES.some((type) => event.dataTransfer.types.includes(type))) return
      // Claimed even when nothing usable arrived, so a stray file never navigates the window.
      event.preventDefault()
      event.stopPropagation()
      accept(getDroppedPath(event.dataTransfer, resolveDesktopDroppedFilePath))
    },
    [accept],
  )

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      if (accept(getPastedPath(event.clipboardData, resolveDesktopDroppedFilePath))) event.preventDefault()
    },
    [accept],
  )

  const clearNotice = useCallback(() => setNotice(null), [])

  return { isDragOver, notice, clearNotice, handlers: { onDragOver, onDragLeave, onDrop, onPaste } }
}
