export * from './activity/index.js';
export * from './aiService/index.js';
export * from './auth.js';
export * from './capabilities.js';
export * from './composition.js';
export * from './connection.js';
export * from './control/index.js';
export * from './diagnostics.js';
export * from './dispatcher.js';
export * from './events.js';
export * from './extensions/index.js';
export type {
	ApplyDraftOptions,
	ApplyDraftPatchOptions,
	CanonicalPathAdapter,
	CanonicalProjectPathOptions,
	CanonicalProjectPathResolverOptions,
	DocumentationCatalogAdapterOptions,
	DocumentationCatalogOptions,
	DocumentationCatalogResult,
	DocumentationDocument,
	DocumentationFolder,
	DocumentationProjectContext,
	ExternalDiskChange,
	FileAdapterOptions,
	FileAuthorization,
	FileCatalogAdapterOptions,
	FileCatalogAuthorization,
	FileCatalogEntry,
	FileCatalogEntryKind,
	FileCatalogListOptions,
	FileCatalogOptions,
	FileCatalogPage,
	FileCatalogPreviewKind,
	FileCatalogPreviewMetadata,
	FileCatalogPreviewMode,
	FileCatalogPreviewOptions,
	FileCatalogProjectContext,
	FileCatalogRequest,
	FileCatalogSearchOptions,
	FileCatalogSearchPage,
	FileCatalogSearchResult,
	FileCatalogSizeOptions,
	FileCatalogSizeResult,
	FileCatalogStorage,
	FileCloseRequest,
	FileContentAdapterOptions,
	FileContentAuthorization,
	FileContentCapabilities,
	FileContentErrorCode,
	FileContentHexRange,
	FileContentHexRow,
	FileContentKind,
	FileContentPreview,
	FileContentProjectContext,
	FileContentRange,
	FileContentRequest,
	FileContentStorage,
	FileContentStreamOptions,
	FileContentTextRange,
	FileDirectoryEntry,
	FileEditRequest,
	FileMetadata,
	FileMutationFailure,
	FileMutationResult,
	FileMutationSuccess,
	FileObservationAdapterOptions,
	FileObservationHost,
	FileOpenRequest,
	FileOpenResult,
	FileOperationHandlers,
	FileProjectContext,
	FileReadRange,
	FileReadRangeRequest,
	FileReloadRequest,
	FileSaveRequest,
	FileServiceErrorCode,
	FileServiceErrorDetails,
	FileSessionMetadata,
	FileSessionOpenOptions,
	FileSessionOptions,
	FileSessionRegistryOptions,
	FileSessionRequest,
	FileSessionState,
	FileSessionStorage,
	FileTextRange,
	FileWatchBatch,
	FileWatchEvent,
	FileWatchEventInput,
	FileWatchEventKind,
	FileWatchKey,
	FileWatchPublishResult,
	FileWatchRegistryOptions,
	FileWatchState,
	FileWatchSubscription,
	FileWatchSubscriptionOptions,
	MarkdownTaskAggregationOptions,
	MarkdownTaskAggregationResult,
	MarkdownTaskDirectory,
	MarkdownTaskFile,
	MarkdownTaskItem,
	MarkdownTaskSection,
	MarkdownTaskStats,
	PathStat,
	ReloadOptions,
	SaveOptions,
} from './fileService/index.js';
export {
	aggregateMarkdownTasks,
	CanonicalProjectPathResolver,
	createFileObservationEventProjector,
	DEFAULT_IGNORED_DIRECTORIES,
	DOCUMENTATION_CATALOG_LIMITS,
	DOCUMENTATION_OPERATIONS,
	DocumentationCatalog,
	FILE_CATALOG_OPERATIONS,
	FILE_CONTENT_OPERATIONS,
	FILE_OBSERVATION_OPERATIONS,
	FILE_OPERATIONS,
	FileCatalog,
	FileContentError,
	FileContentStreamService,
	FileServiceError,
	FileSession,
	FileSessionRegistry,
	FileWatchRegistry,
	frontmatterTitle,
	isHiddenDirectoryName,
	isIgnoredDirectoryName,
	isIgnoredPath,
	matchesIgnorePattern,
	resolveCanonicalProjectPath,
	ServerDocumentationCatalogAdapter,
	ServerFileAdapter,
	ServerFileCatalogAdapter,
	ServerFileContentAdapter,
	ServerFileObservationAdapter,
	shouldSkipDocumentationDirectory,
	titleCase,
	validIgnorePattern,
} from './fileService/index.js';
export * from './gitService/index.js';
export * from './languageService/index.js';
export * from './macroService/index.js';
export * from './mdxRuntime/index.js';
export * from './migration/index.js';
export * from './outboundDelivery.js';
export * from './platform.js';
export * from './recordingService/index.js';
export * from './remote/index.js';
export * from './runtime.js';
export * from './settings/index.js';
export * from './shellProfiles/index.js';
export * from './streamDiagnostics.js';
export * from './terminalService/index.js';
export * from './types.js';
export * from './uiBundle/index.js';
export * from './workspace.js';
export * from './workspaceHydration.js';
export * from './workspaceProtocol.js';
export * from './workspaceRecovery.js';
export * from './workspaceRepository.js';
