import Editor from '@monaco-editor/react'
import { useMemo } from 'react'
import { languageFromFilePath } from '../codeHighlight'
import type { FileViewerEngine } from '../../../types/fileViewer'

type TextViewerProps = {
  engine: FileViewerEngine
  filePath?: string
  language?: string
  onChangeText: (text: string) => void
  text: string
}

export function TextViewer({ engine, filePath, language, onChangeText, text }: TextViewerProps) {
  const monacoLanguage = useMemo(() => language ?? languageFromFilePath(filePath ?? ''), [filePath, language])

  if (engine === 'performant') {
    return (
      <div className="file-text-viewer file-text-viewer--performant">
        <textarea
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
        onChange={(value) => onChangeText(value ?? '')}
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
        }}
      />
    </div>
  )
}
