import type { TerminayHostMenuCommand } from '@terminay/protocol';

export type AppCommand = TerminayHostMenuCommand;

export type ProjectTabDragPreview = {
	title: string;
	emoji: string;
	color: string;
	width: number;
};

export type FileViewerTextEncoding =
	| 'utf8'
	| 'utf-8'
	| 'utf16le'
	| 'utf-16le'
	| 'latin1'
	| 'ascii';

export type FileViewerFileInfo = {
	birthtimeMs: number | null;
	ctimeMs: number | null;
	exists: boolean;
	extension: string;
	ino: number | null;
	isDirectory: boolean;
	isFile: boolean;
	isSymbolicLink: boolean;
	mtimeMs: number | null;
	name: string;
	path: string;
	size: number;
};

export type FileViewerByteRange = {
	dataBase64: string;
	eof: boolean;
	length: number;
	path: string;
	start: number;
	totalSize: number;
};

export type FileViewerTextRange = {
	encoding: FileViewerTextEncoding;
	eof: boolean;
	length: number;
	path: string;
	start: number;
	text: string;
	totalSize: number;
};

export type FileViewerTextMetadata = {
	indexedByteLength: number;
	ino: number;
	isComplete: boolean;
	lineCount: number;
	mtimeMs: number;
	path: string;
	size: number;
};

export type FileViewerTextLine = {
	end: number;
	eol: '' | '\n' | '\r\n';
	lineNumber: number;
	start: number;
	text: string;
};

export type FileViewerTextWindow = {
	lineCount: number;
	lines: FileViewerTextLine[];
	path: string;
	startLine: number;
};

export type FileViewerSparseFileEdit = {
	dataBase64: string;
	end: number;
	start: number;
};

export type FileViewerSparseFileSaveRequest = {
	edits: FileViewerSparseFileEdit[];
	expectedIno: number;
	expectedMtimeMs: number;
	expectedSize: number;
	path: string;
	projectRoot: string;
};

export type FileViewerSaveRequest =
	| {
			data: string;
			encoding?: FileViewerTextEncoding;
			kind: 'text';
			path: string;
	  }
	| {
			dataBase64: string;
			kind: 'base64';
			path: string;
	  };

export type FileViewerSaveResult = {
	byteLength: number;
	path: string;
	savedAt: string;
	size: number;
};

export type FileViewerWatchEvent = {
	event: 'changed' | 'deleted' | 'error' | 'renamed';
	exists: boolean;
	info: FileViewerFileInfo | null;
	message?: string;
	path: string;
};

export type FileViewerPreviewSource = {
	mimeType: string | null;
	path: string;
	url: string;
};

export type FileViewerGitRepoInfo = {
	canDiff: boolean;
	gitAvailable: boolean;
	isTracked: boolean;
	path: string;
	relativePath: string | null;
	repoRoot: string | null;
};

export type FileViewerGitDiff = {
	compareTarget: 'HEAD';
	gitAvailable: boolean;
	hasDiff: boolean;
	hunks: FileViewerGitDiffHunk[];
	isBinary: boolean;
	isTracked: boolean;
	path: string;
	relativePath: string | null;
	repoRoot: string | null;
	tooLarge: boolean;
};

export type FileViewerGitDiffHunk = {
	header: string;
	lines: FileViewerGitDiffLine[];
};

export type FileViewerGitDiffLine = {
	newLineNumber: number | null;
	oldLineNumber: number | null;
	type: 'add' | 'context' | 'delete';
	value: string;
};

export type TerminalDataMessage = {
	id: string;
	data: string;
};

export type ParakeetRuntimeState =
	| 'unsupported'
	| 'not-installed'
	| 'installing'
	| 'ready'
	| 'error';

export type ParakeetRuntimeStatus = {
	message?: string;
	model: 'mlx-community/parakeet-tdt-0.6b-v3';
	progress?: number;
	state: ParakeetRuntimeState;
};

export type DictationMicrophonePermissionStatus =
	| 'not-determined'
	| 'granted'
	| 'denied'
	| 'restricted'
	| 'unknown';

export type {
	TerminalActivityMessage,
	SemanticActivity,
} from './terminalSignals';
export type { AgentStatusSnapshot } from './agentStatus';

export type TerminalExitMessage = {
	id: string;
	exitCode: number;
	signal?: number | null;
};

export type SettingsChangeMessage = {
	settings: import('./settings').TerminalSettings;
};

export type MacrosChangeMessage = {
	macros: import('./macros').MacroDefinition[];
};

export type RemoteAccessStatus = {
	activeConnectionCount: number;
	pendingWebRtcConnectionCount: number;
	auditEvents: Array<{
		action:
			| 'pairing-completed'
			| 'auth-verified'
			| 'device-revoked'
			| 'connection-opened'
			| 'connection-closed'
			| 'connection-revoked';
		connectionId: string | null;
		deviceId: string | null;
		deviceName: string | null;
		occurredAt: string;
		reason?: string;
	}>;
	connections: Array<{
		attachedSessionCount: number;
		connectionId: string;
		deviceId: string;
		deviceName: string;
	}>;
	configurationIssue: string | null;
	configurationPath: string;
	errorMessage: string | null;
	isRunning: boolean;
	pairedDeviceCount: number;
	pairedDevices: Array<{
		addedAt: string;
		deviceId: string;
		lastSeenAt: string | null;
		name: string;
	}>;
	webRtcPairingExpiresAt: string | null;
	webRtcPairingQrCodeDataUrl: string | null;
	webRtcPairingUrl: string | null;
	webRtcRoomId: string | null;
	webRtcStatus: 'error' | 'not-configured' | 'pairing-ready' | 'registering';
	webRtcStatusMessage: string | null;
};

export type FileExplorerEntry = {
	createdAtMs?: number | null;
	isDirectory: boolean;
	isSymbolicLink: boolean;
	mode?: number | null;
	modifiedAtMs?: number | null;
	name: string;
	path: string;
	size?: number;
};

export type FolderSizeProgress = {
	entryCount: number;
	jobId: string;
	size: number;
};

export type FolderSizeResult = {
	cancelled: boolean;
	entryCount: number;
	jobId: string;
	size: number;
};

export type FileExplorerWatchEvent = {
	entryName?: string | null;
	event: 'changed' | 'error';
	message?: string;
	path: string;
};

export type FileSearchResult = {
	isDirectory: boolean;
	path: string;
	relativePath: string;
};

export type FileExplorerGitStatus = 'modified' | 'new';

export type FileExplorerGitStatuses = {
	gitAvailable: boolean;
	repoRoot: string | null;
	statuses: Record<string, FileExplorerGitStatus>;
};

export type GitFileState =
	| 'added'
	| 'modified'
	| 'deleted'
	| 'renamed'
	| 'copied'
	| 'untracked'
	| 'conflicted';

export type GitChangeEntry = {
	/** Absolute path to the changed file. */
	path: string;
	/** Path relative to the repository root, using forward slashes. */
	relativePath: string;
	state: GitFileState;
	/** True when the change is in the index (staged), false when in the working tree. */
	staged: boolean;
	/** Absolute path of the original file for renames/copies. */
	originalPath?: string;
	/** Original path relative to the repository root for renames/copies. */
	originalRelativePath?: string;
};

export type GitPanelStatus = {
	gitAvailable: boolean;
	repoRoot: string | null;
	/** Current branch name, or a short detached-HEAD label, or null when unknown. */
	branch: string | null;
	entries: GitChangeEntry[];
};

export type GitWorktreeStatus = {
	path: string;
	name: string;
	/** Branch name, or a short detached-HEAD label, or null when unknown. */
	branch: string | null;
	head: string | null;
	aheadOfMainCount: number | null;
	lineAdditions: number | null;
	lineDeletions: number | null;
	lastChangedAt: string | null;
	isDirtyBranch: boolean;
	isCurrent: boolean;
	isMain: boolean;
	isBare: boolean;
	isDetached: boolean;
	isLocked: boolean;
	isPrunable: boolean;
	errorMessage?: string;
	entries: GitChangeEntry[];
};

export type WorktreePanelStatus = {
	gitAvailable: boolean;
	repoRoot: string | null;
	defaultBranch: string | null;
	worktrees: GitWorktreeStatus[];
};

export type TerminalRecordingState = {
	bytesWritten: number;
	errorMessage: string | null;
	eventCount: number;
	recordingId: string | null;
	sessionId: string;
	startedAt: string | null;
	status: 'idle' | 'recording' | 'failed';
};

export type TerminalRecordingStartMetadata = {
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	projectColor?: string;
	projectEmoji?: string;
	projectId?: string;
	projectTitle?: string;
	title?: string;
};

export type TerminalRecordingMetadata = {
	version: 2;
	bytesWritten: number;
	castAvailable: boolean;
	capturedInput: boolean;
	color: string | null;
	cols: number;
	cwdLabel: string | null;
	durationMs: number | null;
	endedAt: string | null;
	errorMessage?: string | null;
	eventCount: number;
	exitCode: number | null;
	inputPolicy: 'none' | 'record-with-sensitive-filter';
	projectColor: string | null;
	projectEmoji: string | null;
	projectId: string | null;
	projectTitle: string | null;
	recordingId: string;
	recordingState: 'recording' | 'completed' | 'interrupted' | 'failed';
	rows: number;
	sensitiveInputPolicy: 'drop' | 'mask';
	sessionId: string;
	shellName: string | null;
	signal: number | null;
	startedAt: string;
	theme: import('./settings').TerminalThemeSettings | null;
	title: string;
};

export type TerminalRecordingListItem = TerminalRecordingMetadata;

export type TerminalRecordingChunkRequest = {
	maxBytes?: number;
	recordingId: string;
	start?: number;
};

/**
 * A byte-bounded sequence of complete UTF-8 asciicast NDJSON records.
 *
 * Callers continue with `nextOffset`. A non-zero `start` must be an offset
 * previously returned by this API, so chunks never split a UTF-8 code point or
 * an NDJSON record. `incompleteTail` means a trailing partial record was
 * withheld; it may become complete while an active recording is still growing.
 */
export type TerminalRecordingChunk = {
	content: string;
	eof: boolean;
	incompleteTail: boolean;
	nextOffset: number;
	recordingId: string;
	start: number;
	totalSize: number;
};

export type TerminalRecordingChangeMessage = {
	state: TerminalRecordingState;
};

export type AppUpdateStatus = {
	checkedAt: string | null;
	currentVersion: string;
	errorMessage: string | null;
	hasUpdate: boolean;
	latestVersion: string | null;
	releaseUrl: string | null;
};

export type AiTabMetadataProvider = 'claudeCode' | 'codex';

export type AiTabMetadataTarget = 'title' | 'note';

export type AiTabMetadataModel = {
	id: string;
	label: string;
};

export type AiTabMetadataContext = {
	currentTitle: string;
	existingNote?: string;
	projectRoot: string;
	projectTitle: string;
	recentOutput: string;
	sessionId: string;
};

export type AiTabMetadataGenerateRequest = {
	context: AiTabMetadataContext;
	model: string;
	provider: AiTabMetadataProvider;
	target: AiTabMetadataTarget;
};

export type AiTabMetadataGenerateResult = {
	text: string;
};

export type QuickPushAction =
	| 'current'
	| 'current-pr'
	| 'new'
	| 'new-pr'
	| 'default';

export type QuickPushCommit = {
	message: string;
	files: string[];
};

export type QuickPushPullRequest = {
	title: string;
	body: string;
};

export type QuickPushPlan = {
	branchName: string | null;
	pullRequest: QuickPushPullRequest | null;
	commits: QuickPushCommit[];
	/** Changed files that the model did not assign to any commit. */
	uncoveredFiles: string[];
	/** Non-fatal notes to surface to the user (e.g. unknown files, truncated context). */
	warnings: string[];
};

export type QuickPushGenerateRequest = {
	provider: AiTabMetadataProvider;
	model: string;
	action: QuickPushAction;
	cwd: string;
};

export type QuickPushApplyRequest = {
	cwd: string;
	action: QuickPushAction;
	branchName: string | null;
	pullRequest: QuickPushPullRequest | null;
	commits: QuickPushCommit[];
};

export type QuickPushApplyStep = {
	label: string;
	ok: boolean;
	output?: string;
};

export type QuickPushApplyResult = {
	ok: boolean;
	steps: QuickPushApplyStep[];
	/** Branch the commits ultimately landed on. */
	branch: string | null;
	pushed: boolean;
	pullRequestUrl: string | null;
	pullRequestUrlLabel?: string | null;
	error: string | null;
};

export type ProjectEditWindowDraft = {
	color: string;
	defaultShellProfileId: string | null;
	environmentLabel: string;
	environmentStatus: string;
	environmentDefaultRoot: string | null;
	projectEnvironmentId: string;
	emoji: string;
	rootFolder: string;
	shellProfileOptions: Array<{ id: string; name: string; available: boolean }>;
	title: string;
};

export type ProjectEditWindowResult = Omit<
	ProjectEditWindowDraft,
	| 'shellProfileOptions'
	| 'environmentLabel'
	| 'environmentStatus'
	| 'environmentDefaultRoot'
	| 'projectEnvironmentId'
>;

export type TerminalEditWindowDraft = {
	activityIndicatorsEnabled: boolean;
	color: string;
	emoji: string;
	inheritsProjectColor: boolean;
	projectColor: string;
	title: string;
};

export type TerminalEditWindowResult = TerminalEditWindowDraft;

export type EditWindowState =
	| {
			draft: ProjectEditWindowDraft;
			kind: 'project';
			projectId: string;
	  }
	| {
			draft: TerminalEditWindowDraft;
			kind: 'terminal';
	  };

export type EditWindowResult =
	| {
			result: ProjectEditWindowResult;
			kind: 'project';
	  }
	| {
			result: TerminalEditWindowResult;
			kind: 'terminal';
	  };

/** A provider whose user-wide MCP registration Terminay can manage. */
export type McpAgentId =
	| 'claudeCode'
	| 'codex'
	| 'cursor'
	| 'gemini'
	| 'openCode';
export type McpAgentRegistrationState =
	| 'not-installed'
	| 'installed'
	| 'changed'
	| 'unavailable';

export interface McpAgentInstallState {
	id: McpAgentId;
	label: string;
	state: McpAgentRegistrationState;
	installed: boolean;
	/** Provider-owned registration location, for transparent review. */
	configPath: string;
	message?: string;
}

export interface McpInstallStatus {
	agents: McpAgentInstallState[];
}

export interface McpInstallActionResult {
	ok: boolean;
	installed: boolean;
	message?: string;
	error?: string;
}

export interface TerminayTestApi {
	/** Test-only renderer-side failure of the one exact active Local application transport. */
	failActiveLocalServerConnection: () => Promise<{ connectionId: string }>;
	/** Test-only server-owned terminal creation. Never exposed in production. */
	createServerTerminal: (options?: {
		cwd?: string;
		projectId?: string;
	}) => Promise<{ id: string }>;
	/** Test-only input through the canonical embedded server terminal authority. */
	writeServerTerminal: (sessionId: string, data: string) => Promise<void>;
	getServerTerminalCwd: (sessionId: string) => Promise<{
		cwd: string;
		source: 'observed' | 'spawn';
		observationError?: 'unavailable' | 'failed' | 'timeout';
	} | null>;
	getServerGitWorkspace: (sessionId: string) => Promise<{
		projectId: string;
		projectRoot: string | null;
		binding: {
			projectRoot: string;
			repositoryRoot: string | null;
			state: string;
			worktreeRoot: string | null;
		} | null;
		worktrees: {
			repositoryRoot: string | null;
			state: string;
			paths: string[];
		};
	} | null>;
	getServerTerminalActivity: (sessionId: string) => Promise<{
		foregroundBusy: boolean;
		foregroundObservation: 'available' | 'limited';
		status: 'working' | 'idle';
		acknowledged: boolean;
		claimed: boolean;
		source: string;
	} | null>;
	emitAgentJournalRecord: (payload: {
		provider: import('./agentStatus').AgentProvider;
		terminalSessionId: string;
		record: Record<string, unknown>;
	}) => Promise<boolean>;
	getMcpControlEnvironment: (
		terminalSessionId: string,
	) => Promise<{ socketPath: string; token: string }>;
	sendAppCommand: (command: AppCommand) => Promise<void>;
	reportAppCommandStage: (stage: string) => void;
	setAiTabMetadataMock: (mock: {
		error?: string | null;
		models?: AiTabMetadataModel[];
		noteResult?: string;
		titleResult?: string;
	}) => Promise<void>;
}
