import {
  createContext,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface SharedSettingsRouteCategory {
  readonly id: string
  readonly label: string
  readonly icon?: ReactNode
  /** Number of items in a collection category, shown beside its name. */
  readonly count?: number
}

/** A labelled group of settings-route categories.
 *
 * Most settings surfaces use one unlabelled list. Management surfaces can use
 * sections when the categories represent different kinds of server-owned
 * resources (for example, providers and connections) without inventing a
 * second sidebar component.
 */
export interface SharedSettingsRouteCategorySection {
  readonly id: string
  readonly label: string
  readonly categories: readonly SharedSettingsRouteCategory[]
}

export interface SharedSettingsRouteBodyProps {
  readonly title?: string
  readonly query: string
  readonly queryPlaceholder?: string
  readonly categories: readonly SharedSettingsRouteCategory[]
  readonly categorySections?: readonly SharedSettingsRouteCategorySection[]
  readonly activeCategoryId: string
  readonly status: string
  readonly onQueryChange: (query: string) => void
  readonly onCategorySelect: (categoryId: string) => void
  readonly onResetAll?: () => void
  readonly sidebarAction?: ReactNode
  /** The list column of a collection category. Absent for a plain page. */
  readonly listColumn?: ReactNode
  /** The list column's title, used to label the narrow back control. */
  readonly listTitle?: string
  /** The heading drawn in the detail pane's header band. */
  readonly detailTitle?: ReactNode
  /** Controls drawn at the trailing end of the detail pane's header band. */
  readonly detailActions?: ReactNode
  readonly contentRef?: Ref<HTMLDivElement>
  readonly children: ReactNode
  readonly preview?: ReactNode
  readonly collapsedPreview?: ReactNode
  readonly modal?: ReactNode
}

/** Minimum column widths; the window shows one column at a time below their sum. */
export const SETTINGS_SIDEBAR_WIDTH = 232
export const SETTINGS_LIST_WIDTH = 264
export const SETTINGS_DETAIL_MIN_WIDTH = 420

type NarrowStage = 'sidebar' | 'list' | 'detail'

type SettingsShellNavigation = Readonly<{
  /** Called when a list item is chosen, so a narrow window moves to its detail. */
  showDetail: () => void
}>

const SettingsShellContext = createContext<SettingsShellNavigation>({ showDetail: () => {} })

export function useSettingsShellNavigation(): SettingsShellNavigation {
  return useContext(SettingsShellContext)
}

function useElementWidth<T extends HTMLElement>(): [Ref<T>, number | null] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    setWidth(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * Host-neutral body chrome for the Settings shared route.
 *
 * The caller still owns settings data, commands, persistence, preview
 * implementation, and host permissions. This component owns only reusable
 * settings-route layout, navigation semantics, and stable class names used by
 * both Desktop and the responsive server UI: the grouped sidebar, the list
 * column of a collection category, the detail pane, and the narrow
 * presentation that shows one of them at a time.
 */
export function SharedSettingsRouteBody({
  title = 'Settings',
  query,
  queryPlaceholder = 'Search settings...',
  categories,
  categorySections,
  activeCategoryId,
  status,
  onQueryChange,
  onCategorySelect,
  onResetAll,
  sidebarAction,
  listColumn,
  listTitle,
  detailTitle,
  detailActions,
  contentRef,
  children,
  preview,
  collapsedPreview,
  modal,
}: SharedSettingsRouteBodyProps) {
  const [shellRef, width] = useElementWidth<HTMLDivElement>()
  const hasList = listColumn !== undefined
  const neededWidth = SETTINGS_SIDEBAR_WIDTH + (hasList ? SETTINGS_LIST_WIDTH : 0) + SETTINGS_DETAIL_MIN_WIDTH
  const narrow = width !== null && width < neededWidth
  const [stage, setStage] = useState<NarrowStage>('detail')

  // A category without a list goes straight from the sidebar to its page.
  useEffect(() => {
    if (stage === 'list' && !hasList) setStage('detail')
  }, [hasList, stage])

  const navigation = useMemo<SettingsShellNavigation>(() => ({ showDetail: () => setStage('detail') }), [])
  const selectCategory = useCallback(
    (categoryId: string) => {
      setStage('list')
      onCategorySelect(categoryId)
    },
    [onCategorySelect],
  )
  const back = (to: NarrowStage, label: string) =>
    narrow ? (
      <button type="button" className="settings-back-button" onClick={() => setStage(to)}>
        <span aria-hidden="true">‹</span> {label}
      </button>
    ) : null

  const sections = categorySections ?? [{ id: 'default', label: '', categories }]

  return (
    <SettingsShellContext.Provider value={navigation}>
      <div
        ref={shellRef}
        className="settings-shell"
        data-shared-route-body="settings"
        data-settings-layout={narrow ? 'narrow' : hasList ? 'columns' : 'page'}
        data-settings-stage={narrow ? stage : undefined}
      >
        <aside className="settings-sidebar" hidden={narrow && stage !== 'sidebar'}>
          <header className="settings-column-header settings-sidebar-header">
            <div className="settings-brand">
              <h1>{title}</h1>
            </div>
          </header>
          <div className="settings-sidebar-tools">
            {sidebarAction}
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
          </div>

          <nav className="settings-nav" aria-label={`${title} categories`}>
            {sections.map((section) => (
              <div className="settings-nav-section" key={section.id}>
                {section.label === '' ? null : <h2 className="settings-nav-section-title">{section.label}</h2>}
                {section.categories.map((category) => (
                  <button
                    key={category.id}
                    className={`settings-nav-item ${activeCategoryId === category.id ? 'settings-nav-item--active' : ''}`}
                    aria-current={activeCategoryId === category.id ? 'true' : undefined}
                    type="button"
                    onClick={() => selectCategory(category.id)}
                  >
                    <span className="settings-nav-item-inner">
                      {category.icon === undefined ? null : <span className="settings-nav-icon">{category.icon}</span>}
                      <span className="settings-nav-label">{category.label}</span>
                      {category.count === undefined ? null : (
                        <span className="settings-nav-count">
                          {category.count}
                          <span className="sr-only"> items</span>
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <footer className="settings-sidebar-footer">
            <div className="settings-status">{status}</div>
            {onResetAll === undefined ? null : (
              <button className="settings-reset-all" type="button" onClick={onResetAll}>
                Reset to defaults
              </button>
            )}
          </footer>
        </aside>

        {hasList ? (
          <div className="settings-list-column" hidden={narrow && stage !== 'list'}>
            {back('sidebar', title)}
            {listColumn}
          </div>
        ) : null}

        <div className="settings-right-pane" hidden={narrow && stage !== 'detail'}>
          <header className="settings-column-header settings-detail-header">
            {back(hasList ? 'list' : 'sidebar', hasList ? (listTitle ?? title) : title)}
            <h2 className="settings-detail-title">{detailTitle}</h2>
            {detailActions === undefined ? null : <div className="settings-detail-actions">{detailActions}</div>}
          </header>
          <main className="settings-main" ref={contentRef}>
            <div className="settings-content">{children}</div>
          </main>
          {preview}
          {collapsedPreview}
        </div>
      </div>
      {modal}
    </SettingsShellContext.Provider>
  )
}

/** What a collection category hands the Settings shell to draw. */
export type SettingsCategoryParts = Readonly<{
  list: ReactNode
  detail: ReactNode
  detailTitle: ReactNode
  detailActions?: ReactNode
}>

export interface SettingsListItem {
  readonly id: string
  readonly label: string
  readonly status?: ReactNode
  /** A small state dot before the status line. */
  readonly tone?: 'ok' | 'warn' | 'off' | 'bad'
  /** Marks an item with unsaved changes. */
  readonly unsaved?: boolean
}

export interface SettingsListSection {
  readonly id: string
  readonly label: string
  readonly items: readonly SettingsListItem[]
  /** Quiet copy shown under the label when the section has no items. */
  readonly emptyNote?: ReactNode
}

/** The header, toolbar and body of a collection category's list column. */
export function SettingsListColumn({
  title,
  action,
  toolbar,
  children,
}: Readonly<{ title: string; action?: ReactNode; toolbar?: ReactNode; children: ReactNode }>) {
  return (
    <section className="settings-list" aria-label={title}>
      <header className="settings-column-header settings-list-header">
        <h2 className="settings-list-title">{title}</h2>
        {action}
      </header>
      {toolbar === undefined ? null : <div className="settings-list-toolbar">{toolbar}</div>}
      <div className="settings-list-body">{children}</div>
    </section>
  )
}

/** Grouped rows of a collection category: a name and one status line each. */
export function SettingsListSections({
  sections,
  selectedId,
  onSelect,
  label,
}: Readonly<{
  sections: readonly SettingsListSection[]
  selectedId: string | undefined
  onSelect: (id: string) => void
  label: string
}>) {
  const { showDetail } = useSettingsShellNavigation()
  return (
    <nav aria-label={label} className="settings-list-sections">
      {sections.map((section) => (
        <div key={section.id} className="settings-list-section">
          {section.label === '' ? null : <h3 className="settings-list-section-title">{section.label}</h3>}
          {section.items.length === 0 && section.emptyNote !== undefined ? (
            <p className="settings-list-empty">{section.emptyNote}</p>
          ) : null}
          {section.items.map((item) => {
            const selected = item.id === selectedId
            return (
              <button
                key={item.id}
                type="button"
                aria-current={selected ? 'true' : undefined}
                className={`settings-list-item${selected ? ' settings-list-item--active' : ''}`}
                onClick={() => {
                  onSelect(item.id)
                  showDetail()
                }}
              >
                <span className="settings-list-item-label">
                  {item.label}
                  {item.unsaved ? (
                    <span className="settings-list-item-unsaved">
                      <span className="sr-only">Unsaved changes</span>
                    </span>
                  ) : null}
                </span>
                {item.status === undefined ? null : (
                  <span className="settings-list-item-status">
                    {item.tone === undefined ? null : (
                      <span className={`settings-status-dot settings-status-dot--${item.tone}`} aria-hidden="true" />
                    )}
                    <span className="settings-list-item-status-text">{item.status}</span>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
