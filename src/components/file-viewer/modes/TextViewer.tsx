import Editor from '@monaco-editor/react'
import { useMemo } from 'react'
import type { FileViewerEngine } from '../../../types/fileViewer'

type TextViewerProps = {
  engine: FileViewerEngine
  filePath?: string
  language?: string
  onChangeText: (text: string) => void
  text: string
}

function languageFromFilePath(filePath: string): string | undefined {
  const extension = filePath.toLowerCase().split('.').pop()
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sh':
      return 'shell'
    default:
      return extension
  }
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
