import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [
	app,
	projectTabList,
	projectTabModel,
	terminalActivityOverview,
	dockviewLifecycle,
	projectCollection,
	projectTabTransfer,
	projectEditor,
	remoteConnectionForm,
	remoteConnectionModal,
	remoteAccessMenu,
	remoteAccessController,
	macroRunController,
	macroLauncherController,
	terminalRecordingController,
	terminalActivityController,
	dictationController,
	dictationAudioSupport,
	terminalSwitcherController,
	terminalTransferOrchestration,
	fileExplorerController,
	terminalDockviewCommands,
	terminalCreationController,
	terminalAdoptionController,
	gitPushMenuController,
	fileExplorerTree,
	terminalControlController,
	terminalDockviewWindowController,
] = await Promise.all([
	readFile('src/App.tsx', 'utf8'),
	readFile('src/workspace/ProjectTabList.tsx', 'utf8'),
	readFile('src/workspace/projectTabModel.ts', 'utf8'),
	readFile('src/workspace/TerminalActivityOverview.tsx', 'utf8'),
	readFile('src/workspace/useDockviewPanelLifecycle.ts', 'utf8'),
	readFile('src/workspace/useProjectCollection.ts', 'utf8'),
	readFile('src/workspace/useProjectTabTransfer.ts', 'utf8'),
	readFile('src/workspace/useProjectEditor.ts', 'utf8'),
	Promise.resolve('removed'),
	Promise.resolve('removed'),
	readFile('src/workspace/RemoteAccessConnectionMenu.tsx', 'utf8'),
	readFile('src/workspace/useRemoteAccessController.ts', 'utf8'),
	readFile('src/workspace/useMacroRunController.ts', 'utf8'),
	readFile('src/workspace/useMacroLauncherController.ts', 'utf8'),
	readFile('src/workspace/useTerminalRecordingController.ts', 'utf8'),
	readFile('src/workspace/useTerminalActivityController.ts', 'utf8'),
	readFile('src/workspace/useDictationController.ts', 'utf8'),
	readFile('src/workspace/dictationAudioSupport.ts', 'utf8'),
	readFile('src/workspace/useTerminalSwitcherController.ts', 'utf8'),
	readFile('src/workspace/terminalTransferOrchestration.ts', 'utf8'),
	readFile('src/workspace/useFileExplorerController.ts', 'utf8'),
	readFile('src/workspace/terminalDockviewCommands.ts', 'utf8'),
	readFile('src/workspace/useTerminalCreationController.ts', 'utf8'),
	readFile('src/workspace/useTerminalAdoptionController.ts', 'utf8'),
	readFile('src/workspace/useGitPushMenuController.ts', 'utf8'),
	readFile('src/workspace/FileExplorerTree.tsx', 'utf8'),
	readFile('src/workspace/useTerminalControlController.ts', 'utf8'),
	readFile('src/workspace/useTerminalDockviewWindowController.ts', 'utf8'),
]);

test('App delegates file explorer tree rendering to the workspace feature', () => {
	assert.match(app, /<FileExplorerTree\b/);
	assert.doesNotMatch(app, /function FileExplorerTree\s*\(/);
	assert.doesNotMatch(app, /className="file-explorer-tree-item"/);
	assert.match(fileExplorerTree, /export function FileExplorerTree\s*\(/);
	assert.match(fileExplorerTree, /'file-explorer-tree-item'/);
});

test('the file explorer controller owns directory, Git, and worktree lifecycle', () => {
	assert.match(app, /useFileExplorerController\(\{/);
	assert.doesNotMatch(app, /const loadDirectory = useCallback/);
	assert.doesNotMatch(app, /const refreshGitStatuses = useCallback/);
	assert.doesNotMatch(app, /const handleRenameWorktree = useCallback/);
	assert.match(fileExplorerController, /const loadDirectory = useCallback/);
	assert.doesNotMatch(
		fileExplorerController,
		/const refreshGitStatuses = useCallback/,
	);
	assert.match(
		fileExplorerController,
		/const refreshGitStatusesForRoot = useCallback/,
	);
	assert.match(fileExplorerController, /\.subscribeStatusChanges\(/);
	assert.match(fileExplorerController, /fileObservationClient\.startWatch/);
	assert.match(
		fileExplorerController,
		/const handleRenameWorktree = useCallback/,
	);
});

test('project root updates are committed through the server workspace authority', () => {
	assert.match(
		projectCollection,
		/workspaceSnapshotStore[\s\S]*\.setProjectRoot\(\{ projectId, root: rootFolder \}\)/,
	);
	assert.match(projectCollection, /workspaceSnapshotStore\.refresh\(\)\.catch/);
	assert.doesNotMatch(
		projectCollection,
		/project\.id === projectId \? \{ \.\.\.project, \.\.\.updates \} : project/,
	);
});

test('the Git push feature owns the canonical agent push menu state', () => {
	assert.match(app, /useGitPushMenuController\(\{/);
	assert.doesNotMatch(app, /setGitPushMenuPosition/);
	assert.doesNotMatch(app, /setQuickPushAction/);
	assert.match(gitPushMenuController, /setGitPushMenuPosition/);
	assert.doesNotMatch(gitPushMenuController, /setQuickPushAction|launchQuickPush|quickPushClient/u);
	assert.match(gitPushMenuController, /const launchGitPushAgent = useCallback/);
});

test('the terminal switcher controller owns Dockview ordering and event lifecycle', () => {
	assert.match(app, /useTerminalSwitcherController\(\{/);
	assert.doesNotMatch(app, /const getOrderedTerminalSwitcherItems/);
	assert.doesNotMatch(app, /terminay-open-terminal-switcher/);
	assert.doesNotMatch(app, /terminalSwitcherSelectionRef/);
	assert.match(terminalSwitcherController, /getOrderedTerminalSwitcherItems/);
	assert.match(terminalSwitcherController, /wrapTerminalSwitcherIndex/);
	assert.match(terminalSwitcherController, /OPEN_TERMINAL_SWITCHER_EVENT/);
	assert.match(
		terminalSwitcherController,
		/window\.addEventListener\('blur', onBlur\)/,
	);
});

test('the terminal transfer feature owns immutable move snapshots and export bookkeeping', () => {
	assert.match(app, /exportTerminalPresentationForMove\(\{/);
	assert.match(app, /exportProjectPresentationsForMove\(\{/);
	assert.doesNotMatch(app, /const buildMovedTerminalFromPanel/);
	assert.doesNotMatch(app, /type MovedTerminalTab\s*=/);
	assert.match(terminalTransferOrchestration, /export type MovedTerminalTab/);
	assert.match(
		terminalTransferOrchestration,
		/export function snapshotMovedTerminal/,
	);
	assert.match(terminalTransferOrchestration, /movingSessionIds\.add/);
	assert.match(terminalTransferOrchestration, /panel\.api\.close\(\)/);
});

test('terminal features own creation, adoption, and active Dockview commands', () => {
	assert.match(app, /useTerminalCreationController\(\{/);
	assert.match(app, /useTerminalAdoptionController\(\{/);
	assert.doesNotMatch(app, /app\.workspace\.adopt\.before-add-panel/);
	assert.doesNotMatch(app, /formatMacroTypeTextForTerminal/);
	assert.match(
		terminalCreationController,
		/app\.workspace\.create\.await-delta/,
	);
	assert.match(terminalCreationController, /formatTerminalInitialInput/);
	assert.match(
		terminalAdoptionController,
		/app\.workspace\.adopt\.before-add-panel/,
	);
	assert.match(
		terminalAdoptionController,
		/api\.addPanel<TerminalPanelParams>/,
	);
	assert.match(
		terminalAdoptionController,
		/getServerTerminalPresentationTitle/,
	);
	assert.match(terminalDockviewCommands, /findTerminalFocusTarget/);
	assert.match(terminalDockviewCommands, /closeActiveDockviewPanel/);
	assert.match(terminalDockviewCommands, /saveActiveDockviewPanel/);
	assert.match(terminalDockviewCommands, /popoutActiveDockviewPanel/);
});

test('the terminal control feature owns MCP command resolution and waiters', () => {
	assert.match(app, /useTerminalControlController\(\{/);
	assert.doesNotMatch(app, /case 'list_terminals'/);
	assert.doesNotMatch(app, /case 'wait_for_command'/);
	assert.doesNotMatch(app, /controlCommandWaitersRef/);
	assert.doesNotMatch(app, /controlAttentionWaitersRef/);
	assert.match(terminalControlController, /case 'list_terminals'/);
	assert.match(terminalControlController, /case 'wait_for_command'/);
	assert.match(terminalControlController, /recordTerminalControlActivity/);
	assert.match(terminalControlController, /recordTerminalControlExit/);
});

test('the Dockview window controller owns header and popout listeners', () => {
	assert.match(app, /useTerminalDockviewWindowController\(\{/);
	assert.doesNotMatch(app, /const addTerminalInHeaderSpace/);
	assert.doesNotMatch(app, /const ensureHeaderButtons/);
	assert.doesNotMatch(app, /const collectDockviewWindows/);
	assert.doesNotMatch(app, /getPanelData\(\)/);
	assert.match(
		terminalDockviewWindowController,
		/const addTerminalInHeaderSpace/,
	);
	assert.match(terminalDockviewWindowController, /const ensureHeaderButtons/);
	assert.match(
		terminalDockviewWindowController,
		/const collectDockviewWindows/,
	);
	assert.match(terminalDockviewWindowController, /getPanelData\(\)/);
});

test('the project explorer toggle remains available during root hydration', () => {
	assert.match(
		app,
		/className=\{`project-tab-sidebar-toggle[\s\S]*?disabled=\{!activeProject\}/,
	);
	assert.doesNotMatch(
		app,
		/disabled=\{\s*!activeProject\s*\|\|\s*activeProject\.rootFolder/,
	);
});

test('the macro run controller owns run state and cancellation lifecycle', () => {
	assert.match(app, /useMacroRunController\(\{/);
	assert.doesNotMatch(app, /setRunningMacroRunsBySession/);
	assert.doesNotMatch(app, /macroRunControllersRef/);
	assert.match(macroRunController, /const registerRun = useCallback/);
	assert.match(macroRunController, /const cancelSessionRuns = useCallback/);
	assert.match(
		macroRunController,
		/const clearFinishedSessionRuns = useCallback/,
	);
	assert.match(macroRunController, /controllersRef\.current\.delete\(runId\)/);
	assert.match(macroRunController, /const executeMacro = useCallback/);
	assert.match(macroRunController, /renderMacroTemplate\(/);
});

test('the macro launcher controller owns launcher and parameter state', () => {
	assert.match(app, /useMacroLauncherController\(\{/);
	assert.doesNotMatch(app, /const \[macroQuery, setMacroQuery\] = useState/);
	assert.doesNotMatch(app, /const \[macroToRun, setMacroToRun\] = useState/);
	assert.doesNotMatch(app, /const runMacro = useCallback/);
	assert.doesNotMatch(app, /const validateMacroValues = useCallback/);
	assert.match(macroLauncherController, /const runMacro = useCallback/);
	assert.match(
		macroLauncherController,
		/const validateMacroValues = useCallback/,
	);
	assert.match(
		macroLauncherController,
		/const closeMacroLauncher = useCallback/,
	);
	assert.match(
		macroLauncherController,
		/const closeMacroParameterModal = useCallback/,
	);
});

test('the recording controller owns terminal recording lifecycle', () => {
	assert.match(app, /useTerminalRecordingController\(\{/);
	assert.doesNotMatch(app, /const startRecordingForSession = useCallback/);
	assert.doesNotMatch(
		app,
		/recordingsClient\.onStateChanged\(applyTerminalRecordingState\)/,
	);
	assert.match(
		terminalRecordingController,
		/const startRecordingForSession = useCallback/,
	);
	assert.match(
		terminalRecordingController,
		/const stopRecordingForSession = useCallback/,
	);
	assert.match(
		terminalRecordingController,
		/const hydrateRecordingStateForSession = useCallback/,
	);
	assert.doesNotMatch(
		terminalRecordingController,
		/legacyClient|onStateChanged/,
	);
});

test('the activity controller owns evaluation and timer lifecycle', () => {
	assert.match(app, /useTerminalActivityController\(\{/);
	assert.doesNotMatch(
		app,
		/const applyTerminalActivityEvaluation = useCallback/,
	);
	assert.doesNotMatch(app, /const evaluateTerminalActivityState = useCallback/);
	assert.doesNotMatch(
		app,
		/const scheduleDeferredTerminalActivityFlush = useCallback/,
	);
	assert.match(
		terminalActivityController,
		/const applyEvaluation = useCallback/,
	);
	assert.match(terminalActivityController, /const evaluate = useCallback/);
	assert.match(
		terminalActivityController,
		/const scheduleDeferredFlush = useCallback/,
	);
	assert.match(terminalActivityController, /const markViewed = useCallback/);
});

test('the dictation controller owns capture resources and overlay lifecycle', () => {
	assert.match(app, /useDictationController\(\{/);
	assert.doesNotMatch(app, /const dictationMediaRecorderRef = useRef/);
	assert.doesNotMatch(app, /const cleanupDictationAudio = useCallback/);
	assert.doesNotMatch(app, /const insertDictationTranscript = useCallback/);
	assert.doesNotMatch(app, /const startDictation = useCallback/);
	assert.doesNotMatch(app, /terminay-dictation-overlay/);
	assert.match(dictationController, /const cleanup = useCallback/);
	assert.match(dictationController, /const stop = useCallback/);
	assert.match(dictationController, /const cancel = useCallback/);
	assert.match(dictationController, /const retry = useCallback/);
	assert.match(dictationController, /const insertTranscript = useCallback/);
	assert.match(dictationController, /const startDictation = useCallback/);
	assert.match(dictationController, /Dictation audio diagnostics/);
	assert.match(dictationController, /terminay-dictation-overlay/);
});

test('dictation PCM and WAV support is feature-owned', () => {
	assert.doesNotMatch(app, /function encodeDictationWav/);
	assert.doesNotMatch(app, /async function measureDictationBlobAudio/);
	assert.doesNotMatch(app, /const DICTATION_UPLOAD_LIMIT_BYTES/);
	assert.match(dictationAudioSupport, /export function encodeDictationWav/);
	assert.match(
		dictationAudioSupport,
		/export async function measureDictationBlobAudio/,
	);
	assert.match(
		dictationAudioSupport,
		/export const DICTATION_UPLOAD_LIMIT_BYTES/,
	);
});

test('App delegates project tab rendering to the workspace feature', () => {
	assert.match(app, /<ProjectTabList\b/);
	assert.doesNotMatch(app, /<Reorder\.(?:Group|Item)\b/);
	assert.match(projectTabList, /export function ProjectTabList/);
	assert.match(projectTabList, /<Reorder\.Group\b/);
	assert.match(projectTabList, /<Reorder\.Item\b/);
});

test('App delegates remote access menu rendering', () => {
	assert.match(app, /<RemoteAccessConnectionMenu\b/);
	assert.doesNotMatch(app, /className="remote-access-menu"/);
	assert.match(remoteAccessMenu, /className="remote-access-menu"/);
	assert.match(remoteAccessMenu, /Expose this server…/);
	assert.match(remoteAccessMenu, /Add connection…/);
});

test('the remote access controller owns exposure and pairing lifecycle', () => {
	assert.match(
		app,
		/useRemoteAccessController\(\s*remoteAccessClients\?\.pairingPin,\s*remoteAccessClients\?\.status,/,
	);
	assert.doesNotMatch(
		app,
		/terminayRemoteAccessStatusHost\.(?:getStatus|subscribe|toggleServer|setPairingAddress)\(/,
	);
	assert.doesNotMatch(app, /isRemoteAccessPairingPinConfigured\(/);
	assert.doesNotMatch(app, /saveRemoteAccessPairingPin\(/);
	assert.doesNotMatch(app, /import\('qrcode'\)/);
	assert.match(remoteAccessController, /settingsClient\.(?:get|update)</);
	assert.doesNotMatch(
		remoteAccessController,
		/terminayTerminalSettingsCompatibilityHost/,
	);
	assert.match(remoteAccessController, /statusClient\.subscribe\(/);
	assert.match(remoteAccessController, /statusClient\.toggleServer\(/);
	assert.doesNotMatch(
		remoteAccessController,
		/window\.terminayRemoteAccessStatusHost/,
	);
	assert.match(remoteAccessController, /isRemoteAccessPairingPinConfigured\(/);
	assert.match(remoteAccessController, /saveRemoteAccessPairingPin\(/);
	assert.match(remoteAccessController, /import\('qrcode'\)/);
});

test('connection management is delegated to the canonical host route', () => {
	assert.doesNotMatch(app, /terminayConnectionHost/);
	assert.doesNotMatch(app, /<RemoteConnectionModal\b/);
	assert.match(app, /onOpenConnectionManager/);
});

test('the project editor hook owns canonical root conflict reconciliation', () => {
	assert.match(app, /useProjectEditor\(\{/);
	assert.doesNotMatch(app, /updateProjectRoot\(/);
	assert.doesNotMatch(app, /error instanceof ClientError/);
	assert.match(projectEditor, /updateProjectRoot\(/);
	assert.match(projectEditor, /error instanceof ClientError/);
	assert.match(projectEditor, /error\.code !== 'conflict'/);
	assert.match(projectEditor, /workspaceSnapshotStore\?\.refresh\(\)/);
});

test('the transfer hook owns cross-window project tab lifecycle', () => {
	assert.match(app, /useProjectTabTransfer\(\{/);
	assert.match(projectTabTransfer, /beginWorkspaceDrag\(/);
	assert.match(projectTabTransfer, /endWorkspaceDrag\(/);
	assert.match(projectTabTransfer, /workspaceSnapshotStore\.moveProject\(/);
	assert.match(projectTabTransfer, /presentWorkspaceView\(/);
	assert.doesNotMatch(projectTabTransfer, /terminayProjectTabHost/u);
	assert.doesNotMatch(projectTabTransfer, /terminayWorkspaceTransferHost/u);
});

test('the project collection hook owns project CRUD and adoption reconciliation', () => {
	assert.match(app, /useProjectCollection<MovedTerminalTab>\(\{/);
	assert.doesNotMatch(app, /const addProject = useCallback/);
	assert.doesNotMatch(app, /const closeProject = useCallback/);
	assert.doesNotMatch(app, /const updateProject = useCallback/);
	assert.match(projectCollection, /const addProject = useCallback/);
	assert.match(projectCollection, /const closeProject = useCallback/);
	assert.match(projectCollection, /const adoptProject = useCallback/);
	assert.match(projectCollection, /const updateProject = useCallback/);
	assert.match(projectCollection, /closeHostPresentation\(\)/);
	assert.doesNotMatch(projectCollection, /terminayWindowLifecycleHost/u);
});

test('the workspace lifecycle hook owns Dockview panel reconciliation', () => {
	assert.match(app, /useDockviewPanelLifecycle\(\{/);
	assert.doesNotMatch(app, /event\.api\.onDidRemovePanel\(/);
	assert.doesNotMatch(app, /event\.api\.onDidActivePanelChange\(/);
	assert.match(dockviewLifecycle, /onDidRemovePanel\(/);
	assert.match(dockviewLifecycle, /onDidActivePanelChange\(/);
	assert.match(dockviewLifecycle, /movingTerminalSessionIdsRef/);
	assert.match(dockviewLifecycle, /terminalActivityTimersRef/);
});

test('the workspace feature owns project tab state shape and construction', () => {
	assert.doesNotMatch(app, /type ProjectTab\s*=/);
	assert.doesNotMatch(app, /function createProjectTab\s*\(/);
	assert.doesNotMatch(app, /function getRandomProjectTabColor\s*\(/);
	assert.match(projectTabModel, /export type ProjectTab\s*=/);
	assert.match(projectTabModel, /export function createProjectTab\s*\(/);
	assert.match(
		projectTabModel,
		/export function getRandomProjectTabColor\s*\(/,
	);
});

test('App delegates terminal activity projection and menu rendering', () => {
	assert.match(app, /buildTerminalActivityOverview\(items\)/);
	assert.match(app, /<TerminalActivityOverview\b/);
	assert.doesNotMatch(app, /className="terminal-activity-menu"/);
	assert.doesNotMatch(app, /function terminalOverviewStateToAgentState/);
	assert.match(
		terminalActivityOverview,
		/export function buildTerminalActivityOverview/,
	);
	assert.match(
		terminalActivityOverview,
		/export function TerminalActivityOverview/,
	);
});
