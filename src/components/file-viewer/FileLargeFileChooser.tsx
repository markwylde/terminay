import type { FileViewerEngine } from '../../types/fileViewer'
import { MAX_MONACO_FILE_BYTES } from '../../services/fileViewer/capabilities'

type FileLargeFileChooserProps = {
  fileName: string
  fileSize: number
  onChoose: (engine: Exclude<FileViewerEngine, 'auto'>) => void
}

function formatFileSize(fileSize: number): string {
  if (fileSize >= 1024 * 1024 * 1024) {
    return `${(fileSize / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  return `${(fileSize / (1024 * 1024)).toFixed(1)} MB`
}

export function FileLargeFileChooser({
  fileName,
  fileSize,
  onChoose,
}: FileLargeFileChooserProps) {
  const maxMonacoFileSize = formatFileSize(MAX_MONACO_FILE_BYTES)

  return (
    <div className="large-file-open-chooser">
      <div className="large-file-open-chooser__eyebrow">Large file</div>
      <div className="large-file-open-chooser__header">
        <h3>Choose how to open this file</h3>
        <p>
          <strong>{fileName}</strong> is {formatFileSize(fileSize)}. Performant mode keeps the viewer lighter, while
          Monaco opens the full editor. Files above {maxMonacoFileSize} stay in Performant mode so the rich editor
          never loads an unbounded text model.
        </p>
      </div>
      <div className="large-file-open-chooser__options">
        <button type="button" className="large-file-open-chooser__card" onClick={() => onChoose('performant')}>
          <span className="large-file-open-chooser__card-title">Performant</span>
          <span className="large-file-open-chooser__card-copy">Prefer lazy rendering for larger files.</span>
        </button>
        <button type="button" className="large-file-open-chooser__card" onClick={() => onChoose('monaco')}>
          <span className="large-file-open-chooser__card-title">Monaco</span>
          <span className="large-file-open-chooser__card-copy">Use the richer editor even if it costs more memory.</span>
        </button>
      </div>
    </div>
  )
}
