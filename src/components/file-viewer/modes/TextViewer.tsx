import Editor from '@monaco-editor/react'
import { useEffect, useMemo, useRef } from 'react'
import { languageFromFilePath } from '../codeHighlight'
import type { FileViewerEngine } from '../../../types/fileViewer'

type TextViewerProps = {
  engine: FileViewerEngine
  filePath?: string
  language?: string
  onChangeText: (text: string) => void
  onCurrentTextGetterChange?: (getter: (() => string) | null) => void
  text: string
}

export function TextViewer({ engine, filePath, language, onChangeText, onCurrentTextGetterChange, text }: TextViewerProps) {
  const monacoLanguage = useMemo(() => language ?? languageFromFilePath(filePath ?? ''), [filePath, language])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    return () => {
      onCurrentTextGetterChange?.(null)
    }
  }, [onCurrentTextGetterChange])

  if (engine === 'performant') {
    return (
      <div className="file-text-viewer file-text-viewer--performant">
        <textarea
          ref={(element) => {
            textareaRef.current = element
            onCurrentTextGetterChange?.(element ? () => element.value : null)
          }}
          className="file-text-viewer__textarea"
          spellCheck={false}
          value={text}
          onChange={(event) => onChangeText(event.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="file-text-viewer">
      <Editor
        key={filePath ?? 'file-viewer-text'}
        height="100%"
        language={monacoLanguage}
        value={text}
        theme="vs-dark"
        onMount={(editor) => {
          onCurrentTextGetterChange?.(() => editor.getValue())
        }}
        onChange={(value) => onChangeText(value ?? '')}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
        }}
      />
    </div>
  )
}
