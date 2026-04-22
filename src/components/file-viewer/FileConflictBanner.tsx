type FileConflictBannerProps = {
  onKeepLocal: () => void
  onReload: () => void
}

export function FileConflictBanner({ onKeepLocal, onReload }: FileConflictBannerProps) {
  return (
    <div className="file-conflict-banner" role="alert">
      <span>This file changed on disk while you had unsaved edits.</span>
      <div className="file-conflict-banner__actions">
        <button type="button" onClick={onReload}>
          Reload from disk
        </button>
        <button type="button" onClick={onKeepLocal}>
          Keep local edits
        </button>
      </div>
    </div>
  )
}
