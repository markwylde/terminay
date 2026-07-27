export * from "./auth.js";
export * from "./events.js";
export * from "./types.js";
export * from "./connection.js";
export * from "./dispatcher.js";
export * from "./workspace.js";
export * from "./workspaceRecovery.js";
export * from "./runtime.js";
export * from "./workspaceRepository.js";
export * from "./activity/index.js";
export * from "./control/index.js";
export * from "./settings/index.js";
export * from "./macroService/index.js";
export {
  FileServiceError,
  CanonicalProjectPathResolver,
  resolveCanonicalProjectPath,
  FileSession,
  FileSessionRegistry,
  FileWatchRegistry,
  FileCatalog,
  aggregateMarkdownTasks,
  FileContentError,
  FileContentStreamService,
  ServerFileAdapter,
  FILE_OPERATIONS,
} from "./fileService/index.js";
export type {
  PathStat,
  CanonicalPathAdapter,
  FileMetadata,
  FileSessionStorage,
  FileWatchState,
  FileSessionState,
  FileSessionMetadata,
  FileReadRange,
  FileSessionOptions,
  ExternalDiskChange,
  SaveOptions,
  ReloadOptions,
  FileServiceErrorCode,
  FileServiceErrorDetails,
  FileMutationSuccess,
  FileMutationFailure,
  FileMutationResult,
  CanonicalProjectPathOptions,
  CanonicalProjectPathResolverOptions,
  ApplyDraftOptions,
  ApplyDraftPatchOptions,
  FileSessionOpenOptions,
  FileSessionRegistryOptions,
  FileWatchEventKind,
  FileWatchKey,
  FileWatchEventInput,
  FileWatchEvent,
  FileWatchSubscriptionOptions,
  FileWatchSubscription,
  FileWatchBatch,
  FileWatchRegistryOptions,
  FileWatchPublishResult,
  FileDirectoryEntry,
  FileCatalogStorage,
  FileCatalogOptions,
  FileCatalogEntryKind,
  FileCatalogEntry,
  FileCatalogListOptions,
  FileCatalogPage,
  FileCatalogSearchOptions,
  FileCatalogSearchResult,
  FileCatalogSearchPage,
  FileCatalogSizeOptions,
  FileCatalogSizeResult,
  FileCatalogPreviewKind,
  FileCatalogPreviewMode,
  FileCatalogPreviewMetadata,
  FileCatalogPreviewOptions,
  MarkdownTaskItem,
  MarkdownTaskSection,
  MarkdownTaskStats,
  MarkdownTaskFile,
  MarkdownTaskDirectory,
  MarkdownTaskAggregationOptions,
  MarkdownTaskAggregationResult,
  FileContentStorage,
  FileContentStreamOptions,
  FileContentKind,
  FileContentErrorCode,
  FileContentCapabilities,
  FileContentRange,
  FileContentTextRange,
  FileContentHexRow,
  FileContentHexRange,
  FileContentPreview,
  FileProjectContext,
  FileAuthorization,
  FileAdapterOptions,
  FileOpenRequest,
  FileOpenResult,
  FileSessionRequest,
  FileReadRangeRequest,
  FileTextRange,
  FileEditRequest,
  FileSaveRequest,
  FileReloadRequest,
  FileCloseRequest,
  FileOperationHandlers,
} from "./fileService/index.js";
export * from "./aiService/index.js";
export * from "./terminalService/index.js";
export * from "./recordingService/index.js";
export * from "./gitService/index.js";
export * from "./migration/index.js";
export * from "./diagnostics.js";
export * from "./remote/index.js";
export * from "./uiBundle/index.js";
