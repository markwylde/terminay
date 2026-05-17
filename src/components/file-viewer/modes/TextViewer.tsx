import Editor from '@monaco-editor/react'
import { useEffect, useMemo, useRef } from 'react'
import { languageFromFilePath } from '../codeHighlight'
import type { FileViewerEngine } from '../../../types/fileViewer'
import { configureFileViewerMonaco, FILE_VIEWER_THEME } from '../monacoSetup'

type TextViewerProps = {
  engine: FileViewerEngine
  filePath?: string
  language?: string
  onChangeText: (text: string) => void
  onCurrentTextGetterChange?: (getter: (() => string) | null) => void
  text: string
}

export function TextViewer({ engine, filePath, language, onChangeText, onCurrentTextGetterChange, text }: TextViewerProps) {
  const monacoLanguage = useMemo(() => languageFromFilePath(filePath ?? '') ?? language, [filePath, language])
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
        theme={FILE_VIEWER_THEME}
        beforeMount={configureFileViewerMonaco}
        onMount={(editor, monaco) => {
          configureFileViewerMonaco(monaco)
          const model = editor.getModel()
          if (model && monacoLanguage) {
            monaco.editor.setModelLanguage(model, monacoLanguage)
          }
          monaco.editor.setTheme(FILE_VIEWER_THEME)
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
