import type { FileViewerMode } from '../../types/fileViewer'

type FileModeSwitcherProps = {
  activeMode: FileViewerMode
  disabledModes?: Partial<Record<FileViewerMode, boolean>>
  onChangeMode: (mode: FileViewerMode) => void
}

const MODES: FileViewerMode[] = ['preview', 'text', 'hex', 'diff']

export function FileModeSwitcher({ activeMode, disabledModes, onChangeMode }: FileModeSwitcherProps) {
  return (
    <div className="file-mode-switcher" role="tablist" aria-label="File view mode">
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className={`file-mode-switcher__button${activeMode === mode ? ' file-mode-switcher__button--active' : ''}`}
          onClick={() => onChangeMode(mode)}
          disabled={disabledModes?.[mode] === true}
          role="tab"
          aria-selected={activeMode === mode}
        >
          {mode === 'hex' ? 'HEX' : mode[0].toUpperCase() + mode.slice(1)}
        </button>
      ))}
    </div>
  )
}
