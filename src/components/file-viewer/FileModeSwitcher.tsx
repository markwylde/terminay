import type { FileViewerMode } from '../../types/fileViewer'

type FileModeSwitcherProps = {
  activeMode: FileViewerMode
  disabledModes?: Partial<Record<FileViewerMode, boolean>>
  modes?: FileViewerMode[]
  onChangeMode: (mode: FileViewerMode) => void
}

const DEFAULT_MODES: FileViewerMode[] = ['preview', 'text', 'hex', 'diff']

const MODE_LABELS: Record<FileViewerMode, string> = {
  diff: 'Diff',
  hex: 'HEX',
  preview: 'Preview',
  tasks: 'Tasks',
  text: 'Text',
}

export function FileModeSwitcher({ activeMode, disabledModes, modes = DEFAULT_MODES, onChangeMode }: FileModeSwitcherProps) {
  return (
    <div className="file-mode-switcher" role="tablist" aria-label="File view mode">
      {modes.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`file-mode-switcher__button${activeMode === mode ? ' file-mode-switcher__button--active' : ''}`}
          onClick={() => onChangeMode(mode)}
          disabled={disabledModes?.[mode] === true}
          role="tab"
          aria-selected={activeMode === mode}
        >
          {MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  )
}
