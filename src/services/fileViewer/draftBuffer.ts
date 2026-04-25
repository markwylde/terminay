import type { FileReadResponse, FileSavePayload } from '../../types/fileViewer'

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) {
    binary += String.fromCharCode(value)
  }
  return window.btoa(binary)
}

export type FileDraftBuffer = ReturnType<typeof createFileDraftBuffer>

export function createFileDraftBuffer(options: {
  base64?: string
  text?: string
}) {
  let initialText: string | null = options.text ?? null
  let draftText: string | null = options.text ?? null
  let initialBytes = options.base64 ? decodeBase64(options.base64) : null
  let draftBytes = initialBytes ? initialBytes.slice() : null

  return {
    getBase64(): string {
      if (draftBytes) {
        return encodeBase64(draftBytes)
      }

      if (draftText !== null) {
        return window.btoa(unescape(encodeURIComponent(draftText)))
      }

      return ''
    },
    getByteLength(): number {
      if (draftBytes) {
        return draftBytes.length
      }

      return new TextEncoder().encode(draftText ?? '').length
    },
    getPayload(): FileSavePayload {
      if (draftBytes) {
        return {
          kind: 'binary',
          base64: encodeBase64(draftBytes),
        }
      }

      return {
        kind: 'text',
        text: draftText ?? '',
      }
    },
    getText(): string {
      if (draftText !== null) {
        return draftText
      }

      if (draftBytes) {
        return new TextDecoder().decode(draftBytes)
      }

      return ''
    },
    isDirty(): boolean {
      if (draftBytes && initialBytes) {
        if (draftBytes.length !== initialBytes.length) {
          return true
        }

        for (let index = 0; index < draftBytes.length; index += 1) {
          if (draftBytes[index] !== initialBytes[index]) {
            return true
          }
        }

        return false
      }

      return (draftText ?? '') !== (initialText ?? '')
    },
    replaceBytes(base64: string) {
      const next = decodeBase64(base64)
      initialBytes = next.slice()
      draftBytes = next.slice()
      draftText = null
      initialText = null
    },
    replaceFromRead(readResponse: FileReadResponse) {
      this.replaceBytes(readResponse.base64)
    },
    replaceText(text: string) {
      initialText = text
      draftText = text
      initialBytes = null
      draftBytes = null
    },
    setByte(offset: number, value: number) {
      if (!draftBytes) {
        draftBytes = new TextEncoder().encode(draftText ?? '')
        initialBytes = draftBytes.slice()
        draftText = null
        initialText = null
      }

      if (offset >= 0 && offset < draftBytes.length) {
        draftBytes[offset] = value
      }
    },
    setText(text: string) {
      draftText = text
      draftBytes = null
    },
  }
}
