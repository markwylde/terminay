import type { FileInfo, FileViewerEngine } from '../../types/fileViewer'

type FileStatusBarProps = {
  engine: FileViewerEngine
  file: FileInfo
  isDirty: boolean
  isValid?: boolean
}

export function FileStatusBar({ engine, file, isDirty, isValid = true }: FileStatusBarProps) {
  return (
    <div className="file-status-bar">
      <div className="file-status-bar__primary">
        <span className="file-status-bar__path">{file.path}</span>
      </div>
      <div className="file-status-bar__secondary">
        <span className="file-status-bar__meta">{file.size.toLocaleString()} bytes</span>
        <span className="file-status-bar__pill">
          {engine === 'auto' ? 'Auto' : engine === 'performant' ? 'Performant' : 'Monaco'}
        </span>
        <span className={`file-status-bar__pill ${isDirty ? 'file-status-bar__pill--warning' : 'file-status-bar__pill--success'}`}>
          {isDirty ? 'Unsaved changes' : 'Synced'}
        </span>
        {!isValid ? <span className="file-status-bar__pill file-status-bar__pill--danger">Invalid HEX</span> : null}
      </div>
    </div>
  )
}
