import type { FileViewerSparseFileEdit } from '../../types/terminay'

export type ProjectedOffset =
  | { kind: 'original'; originalOffset: number }
  | { editIndex: number; kind: 'replacement'; replacementOffset: number }

export function decodeSparseEdit(edit: FileViewerSparseFileEdit): Uint8Array {
  return Uint8Array.from(globalThis.atob(edit.dataBase64), (character) => character.charCodeAt(0))
}

export function getProjectedSize(originalSize: number, edits: readonly FileViewerSparseFileEdit[]): number {
  return edits.reduce(
    (size, edit) => size - (edit.end - edit.start) + decodeSparseEdit(edit).byteLength,
    originalSize,
  )
}

export function mapProjectedOffset(
  originalSize: number,
  edits: readonly FileViewerSparseFileEdit[],
  projectedOffset: number,
): ProjectedOffset | null {
  if (!Number.isSafeInteger(projectedOffset) || projectedOffset < 0) {
    return null
  }

  let originalCursor = 0
  let projectedCursor = 0
  for (let editIndex = 0; editIndex < edits.length; editIndex += 1) {
    const edit = edits[editIndex]
    const unchangedLength = edit.start - originalCursor
    if (projectedOffset < projectedCursor + unchangedLength) {
      return {
        kind: 'original',
        originalOffset: originalCursor + projectedOffset - projectedCursor,
      }
    }
    projectedCursor += unchangedLength
    const replacementLength = decodeSparseEdit(edit).byteLength
    if (projectedOffset < projectedCursor + replacementLength) {
      return {
        editIndex,
        kind: 'replacement',
        replacementOffset: projectedOffset - projectedCursor,
      }
    }
    projectedCursor += replacementLength
    originalCursor = edit.end
  }

  const tailLength = originalSize - originalCursor
  if (projectedOffset < projectedCursor + tailLength) {
    return {
      kind: 'original',
      originalOffset: originalCursor + projectedOffset - projectedCursor,
    }
  }
  return null
}

export function applySparseEdits(
  original: Uint8Array,
  edits: readonly FileViewerSparseFileEdit[],
): Uint8Array {
  const result = new Uint8Array(getProjectedSize(original.byteLength, edits))
  let originalCursor = 0
  let projectedCursor = 0
  for (const edit of edits) {
    const unchanged = original.subarray(originalCursor, edit.start)
    result.set(unchanged, projectedCursor)
    projectedCursor += unchanged.byteLength
    const replacement = decodeSparseEdit(edit)
    result.set(replacement, projectedCursor)
    projectedCursor += replacement.byteLength
    originalCursor = edit.end
  }
  result.set(original.subarray(originalCursor), projectedCursor)
  return result
}

export async function readProjectedRange(
  originalSize: number,
  edits: readonly FileViewerSparseFileEdit[],
  start: number,
  length: number,
  readOriginal: (start: number, length: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const projectedSize = getProjectedSize(originalSize, edits)
  const rangeStart = Math.max(0, Math.min(projectedSize, Math.floor(start)))
  const rangeEnd = Math.max(rangeStart, Math.min(projectedSize, rangeStart + Math.max(0, Math.floor(length))))
  const chunks: Uint8Array[] = []
  let projectedCursor = 0
  let originalCursor = 0

  const appendOriginal = async (segmentEnd: number) => {
    const segmentLength = segmentEnd - originalCursor
    const overlapStart = Math.max(rangeStart, projectedCursor)
    const overlapEnd = Math.min(rangeEnd, projectedCursor + segmentLength)
    if (overlapEnd > overlapStart) {
      const offsetWithinSegment = overlapStart - projectedCursor
      chunks.push(await readOriginal(originalCursor + offsetWithinSegment, overlapEnd - overlapStart))
    }
    projectedCursor += segmentLength
    originalCursor = segmentEnd
  }

  for (const edit of edits) {
    await appendOriginal(edit.start)
    const replacement = decodeSparseEdit(edit)
    const overlapStart = Math.max(rangeStart, projectedCursor)
    const overlapEnd = Math.min(rangeEnd, projectedCursor + replacement.byteLength)
    if (overlapEnd > overlapStart) {
      chunks.push(replacement.subarray(overlapStart - projectedCursor, overlapEnd - projectedCursor))
    }
    projectedCursor += replacement.byteLength
    originalCursor = edit.end
  }
  await appendOriginal(originalSize)

  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}
