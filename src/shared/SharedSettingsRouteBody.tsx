import type { ReactNode, Ref } from 'react'

export interface SharedSettingsRouteCategory {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
}

export interface SharedSettingsRouteBodyProps {
  readonly title?: string
  readonly query: string
  readonly queryPlaceholder?: string
  readonly categories: readonly SharedSettingsRouteCategory[]
  readonly activeCategoryId: string
  readonly status: string
  readonly onQueryChange: (query: string) => void
  readonly onCategorySelect: (categoryId: string) => void
  readonly onResetAll: () => void
  readonly contentRef?: Ref<HTMLDivElement>
  readonly children: ReactNode
  readonly preview?: ReactNode
  readonly collapsedPreview?: ReactNode
  readonly modal?: ReactNode
}

/**
 * Host-neutral body chrome for the Settings shared route.
 *
 * The caller still owns settings data, commands, persistence, preview
 * implementation, and host permissions. This component owns only reusable
 * settings-route layout, navigation semantics, and stable class names used by
 * both Desktop and the responsive server UI.
 */
export function SharedSettingsRouteBody({
  title = 'Settings',
  query,
  queryPlaceholder = 'Search settings...',
  categories,
  activeCategoryId,
  status,
  onQueryChange,
  onCategorySelect,
  onResetAll,
  contentRef,
  children,
  preview,
  collapsedPreview,
  modal,
}: SharedSettingsRouteBodyProps) {
  return (
    <>
      <div className="settings-shell" data-shared-route-body="settings">
        <aside className="settings-sidebar">
          <header className="settings-sidebar-header">
            <div className="settings-brand">
              <h1>{title}</h1>
            </div>
            <div className="settings-search-container">
              <input
                type="search"
                className="settings-search-input"
                aria-label={`Search ${title} settings`}
                placeholder={queryPlaceholder}
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
              />
            </div>
          </header>

          <nav className="settings-nav" aria-label={`${title} categories`}>
            <div className="settings-nav-section">
              {categories.map((category) => (
                <button
                  key={category.id}
                  className={`settings-nav-item ${activeCategoryId === category.id ? 'settings-nav-item--active' : ''}`}
                  aria-current={activeCategoryId === category.id ? 'true' : undefined}
                  type="button"
                  onClick={() => onCategorySelect(category.id)}
                >
                  <div className="settings-nav-item-inner" style={{ gap: 8 }}>
                    {category.icon === undefined ? null : (
                      <div
                        className="settings-nav-icon"
                        style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}
                      >
                        {category.icon}
                      </div>
                    )}
                    <span>{category.label}</span>
                  </div>
                </button>
              ))}
            </div>
          </nav>

          <footer className="settings-sidebar-footer">
            <div className="settings-status">{status}</div>
            <button className="settings-reset-all" type="button" onClick={onResetAll}>
              Reset to defaults
            </button>
          </footer>
        </aside>

        <div className="settings-right-pane">
          <main className="settings-main" ref={contentRef}>
            <div className="settings-content">{children}</div>
          </main>
          {preview}
          {collapsedPreview}
        </div>
      </div>
      {modal}
    </>
  )
}
