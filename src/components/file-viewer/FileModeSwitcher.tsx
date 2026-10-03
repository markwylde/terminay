import { Ellipsis } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { FileViewerMode } from '../../types/fileViewer'

type FileModeSwitcherProps = {
  activeMode: FileViewerMode
  /** Views drawn as tabs but not selectable, with the reason each is closed. */
  disabledReasons?: Partial<Record<FileViewerMode, string>>
  modes: FileViewerMode[]
  /** Available views kept out of the tab row until asked for. */
  moreModes?: FileViewerMode[]
  onChangeMode: (mode: FileViewerMode) => void
}

const MODE_LABELS: Record<FileViewerMode, string> = {
  diff: 'Diff',
  hex: 'HEX',
  preview: 'Preview',
  tasks: 'Tasks',
  text: 'Text',
}

export function FileModeSwitcher({
  activeMode,
  disabledReasons,
  modes,
  moreModes = [],
  onChangeMode,
}: FileModeSwitcherProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  // A view chosen from the menu is the one on screen, so it earns a tab for as
  // long as it stays selected.
  const tabs = modes.includes(activeMode) ? modes : [...modes, activeMode]
  const menuModes = moreModes.filter((mode) => !tabs.includes(mode))

  useEffect(() => {
    if (!isMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isMenuOpen])

  return (
    <div className="file-mode-switcher">
      <div className="file-mode-switcher__tabs" role="tablist" aria-label="File view mode">
        {tabs.map((mode) => {
          const reason = disabledReasons?.[mode]
          const isActive = activeMode === mode
          return (
            <button
              key={mode}
              type="button"
              className={`file-mode-switcher__button${isActive ? ' file-mode-switcher__button--active' : ''}`}
              onClick={() => onChangeMode(mode)}
              disabled={reason !== undefined}
              role="tab"
              aria-selected={isActive}
              title={reason}
            >
              {MODE_LABELS[mode]}
            </button>
          )
        })}
      </div>
      {menuModes.length > 0 ? (
        <div className="file-mode-switcher__more" ref={menuRef}>
          <button
            type="button"
            className="file-mode-switcher__more-button"
            aria-label="More views"
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            aria-controls={isMenuOpen ? menuId : undefined}
            title="More views"
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            <Ellipsis size={15} strokeWidth={2} aria-hidden="true" />
          </button>
          {isMenuOpen ? (
            <div className="file-mode-switcher__menu" id={menuId} role="menu">
              {menuModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="file-mode-switcher__menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsMenuOpen(false)
                    onChangeMode(mode)
                  }}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
