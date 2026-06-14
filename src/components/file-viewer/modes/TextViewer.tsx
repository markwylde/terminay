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
          // Monaco often mounts before its container has a measured size (the file
          // tab lives inside a dockview panel that may not be laid out yet). When
          // that happens the first paint has no visible lines, so the tokenization
          // pass that completes while the viewport is empty repaints nothing and
          // syntax highlighting only appears once a scroll forces a fresh render.
          // Once the container actually gains a size, force re-tokenization (by
          // re-applying the language) plus a layout + full re-render so the
          // initially-visible lines colorize immediately without a scroll.
          const node = editor.getDomNode()
          if (node) {
            const colorizeWhenVisible = () => {
              if (node.clientWidth === 0 || node.clientHeight === 0) return
              const model = editor.getModel()
              if (model) {
                const languageId = model.getLanguageId()
                // Toggle the language to force a fresh tokenization pass now that
                // the viewport is non-empty; a same-value set would be a no-op.
                monaco.editor.setModelLanguage(model, 'plaintext')
                monaco.editor.setModelLanguage(model, languageId)
              }
              editor.layout()
              editor.render(true)
              observer.disconnect()
            }
            const observer = new ResizeObserver(colorizeWhenVisible)
            observer.observe(node)
            editor.onDidDispose(() => observer.disconnect())
          }
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
