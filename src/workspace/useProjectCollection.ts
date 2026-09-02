import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { closeHostPresentation } from '../host/nativeActions';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import { normalizeSidebarPanelOrder } from '../terminalSettings';
import type { SidebarSettings } from '../types/settings';
import {
	createProjectTab,
	isProjectSidebarOpenOnDevice,
	type ProjectSidebarState,
	type ProjectTab,
	projectSidebarPatch,
	projectSidebarState,
	projectSidebarVisibilityKey,
	sidebarActiveGroupOnDevice,
} from './projectTabModel';

const DEFAULT_AGENTS_PANE_HEIGHT = 200;
const WORKSPACE_SELECTION_STORAGE_PREFIX = 'terminay.workspace-selection.v1:';

function readPresentationActiveProject(
	serverId: string,
	viewId: string | null,
): string | null {
	if (viewId === null || typeof sessionStorage === 'undefined') return null;
	try {
		const value = sessionStorage.getItem(
			`${WORKSPACE_SELECTION_STORAGE_PREFIX}${serverId}:${viewId}`,
		);
		return value !== null && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

function writePresentationActiveProject(
	serverId: string,
	viewId: string | null,
	projectId: string,
): void {
	if (
		viewId === null ||
		projectId.length === 0 ||
		typeof sessionStorage === 'undefined'
	)
		return;
	try {
		sessionStorage.setItem(
			`${WORKSPACE_SELECTION_STORAGE_PREFIX}${serverId}:${viewId}`,
			projectId,
		);
	} catch {
		// Presentation selection is best-effort local state.
	}
}

function pickLocalActiveProjectId(
	candidateIds: readonly string[],
	...preferred: Array<string | null | undefined>
): string {
	const available = new Set(candidateIds);
	for (const id of preferred) {
		if (id !== null && id !== undefined && id.length > 0 && available.has(id))
			return id;
	}
	return candidateIds[0] ?? '';
}

type PendingSidebarCommit = Readonly<{
	sequence: number;
	patch: Partial<ProjectSidebarState>;
}>;

type ProjectSidebarSnapshot = Omit<
	ProjectSidebarState,
	| 'expandedAgentEntryIds'
	| 'expandedDocumentationFolderIds'
	| 'sidebarPanelOrder'
> & {
	readonly expandedAgentEntryIds: readonly string[];
	readonly expandedDocumentationFolderIds: readonly string[];
	readonly sidebarPanelOrder: readonly ProjectSidebarState['sidebarPanelOrder'][number][];
};

function applyPendingSidebarCommits(
	sidebar: ProjectSidebarSnapshot,
	commits: readonly PendingSidebarCommit[] | undefined,
): ProjectSidebarState {
	const resolved: ProjectSidebarState = {
		...sidebar,
		expandedAgentEntryIds: [...sidebar.expandedAgentEntryIds],
		expandedDocumentationFolderIds: [...sidebar.expandedDocumentationFolderIds],
		sidebarPanelOrder: [...sidebar.sidebarPanelOrder],
	};
	if (commits === undefined || commits.length === 0) return resolved;
	for (const commit of commits) Object.assign(resolved, commit.patch);
	return resolved;
}

function sidebarMatchesPatch(
	sidebar: ProjectSidebarSnapshot,
	patch: Partial<ProjectSidebarState>,
): boolean {
	return Object.entries(patch).every(([key, value]) => {
		const current = sidebar[key as keyof ProjectSidebarState];
		if (Array.isArray(value)) {
			return (
				Array.isArray(current) &&
				current.length === value.length &&
				current.every((entry, index) => entry === value[index])
			);
		}
		return current === value;
	});
}

export function useProjectCollection<TTerminal>({
	defaultProjectRoot = '',
	isAdoptWindow,
	projectColorScope,
	sidebarVisibilityScope,
	onProjectSidebarVisibilityChange,
	onProjectSidebarActiveGroupChange,
	confirmProjectClose,
	holdProjectOrderRef,
	holdActiveProjectIdRef,
	sidebarSettings,
	workspaceSnapshotStore,
	workspaceViewId,
}: {
	/** Canonical server-projected root for newly created projects. The hook
	 * never discovers host filesystem paths on its own. */
	defaultProjectRoot?: string;
	isAdoptWindow: boolean;
	/** Stable server identity used only to synthesize unpersisted project colors. */
	projectColorScope: string;
	/** Stable server identity that scopes an opaque project id to this device. */
	sidebarVisibilityScope: string;
	onProjectSidebarVisibilityChange?: (
		projectId: string,
		isOpen: boolean,
	) => void;
	onProjectSidebarActiveGroupChange?: (
		projectId: string,
		groupId: ProjectTab['sidebarActiveGroup'],
	) => void;
	confirmProjectClose?: (projectId: string) => Promise<boolean>;
	holdProjectOrderRef?: MutableRefObject<string | null>;
	/** While non-null, keep this presentation's selection stable during a
	 * background project-creation journey. */
	holdActiveProjectIdRef?: MutableRefObject<string | null>;
	sidebarSettings: SidebarSettings;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
	workspaceViewId: string | null;
}) {
	const sidebarDefaultsRef = useRef(sidebarSettings);
	const sidebarVisibilityRef = useRef(sidebarSettings.projectVisibility);
	const sidebarActiveGroupRef = useRef(sidebarSettings.projectActiveGroup);
	const projectCounterRef = useRef(1);
	const initialServerSnapshot = workspaceSnapshotStore?.snapshot;
	const hasServerWorkspace = workspaceSnapshotStore !== undefined;
	const initialViewId =
		workspaceViewId ?? initialServerSnapshot?.viewOrder[0] ?? null;
	const initialServerView =
		initialViewId === null
			? undefined
			: initialServerSnapshot?.views[initialViewId];
	const initialServerProjects =
		initialServerView?.projectIds
			.map((projectId) => initialServerSnapshot?.projects[projectId])
			.filter((project) => project !== undefined) ?? [];
	const [projects, setProjects] = useState<ProjectTab[]>(() => {
		if (isAdoptWindow) return [];
		if (hasServerWorkspace && initialServerSnapshot === null) return [];
		if (initialServerProjects.length > 0) {
			const usedColors: string[] = [];
			return initialServerProjects.map((serverProject, index) => {
				const base = createProjectTab(
					index + 1,
					serverProject.root,
					usedColors,
					sidebarSettings,
					projectColorScope,
				);
				const color = serverProject.color ?? base.color;
				usedColors.push(color);
				return {
					...base,
					...projectSidebarState(serverProject.sidebar),
					isFileExplorerOpen: isProjectSidebarOpenOnDevice(
						sidebarSettings,
						sidebarVisibilityScope,
						serverProject.id,
					),
					sidebarActiveGroup: sidebarActiveGroupOnDevice(
						sidebarSettings,
						sidebarVisibilityScope,
						serverProject.id,
					),
					id: serverProject.id,
					projectEnvironmentId: serverProject.projectEnvironmentId,
					environmentRevision: serverProject.environmentRevision,
					environmentLabel:
						serverProject.projectEnvironmentId === 'terminay:this-server'
							? 'This server'
							: 'Remote environment',
					environmentStatus: 'ready',
					title: serverProject.name,
					rootFolder: serverProject.root,
					color,
					...(serverProject.defaultShellProfileId === undefined
						? {}
						: { defaultShellProfileId: serverProject.defaultShellProfileId }),
					...(serverProject.icon === undefined
						? {}
						: { emoji: serverProject.icon }),
				};
			});
		}
		if (hasServerWorkspace) return [];
		return [
			createProjectTab(
				1,
				defaultProjectRoot,
				[],
				sidebarSettings,
				projectColorScope,
			),
		];
	});
	const projectsRef = useRef(projects);
	const [activeProjectId, setActiveProjectId] = useState(() => {
		if (isAdoptWindow) return '';
		if (hasServerWorkspace && initialServerSnapshot === null) return '';
		const storedId = readPresentationActiveProject(
			projectColorScope,
			initialViewId,
		);
		const localId = pickLocalActiveProjectId(
			initialServerProjects.map((project) => project.id),
			storedId,
			initialServerView?.activeProjectId,
		);
		return localId.length > 0
			? localId
			: hasServerWorkspace
				? ''
				: 'project-1';
	});
	const activeProjectIdRef = useRef(activeProjectId);
	const reservedProjectColorsRef = useRef(new Set<string>());
	const [projectCreationError, setProjectCreationError] = useState<
		string | null
	>(null);
	const [adoptedTerminalsByProject, setAdoptedTerminalsByProject] = useState<
		Record<string, TTerminal[]>
	>({});
	/**
	 * Sidebar changes are optimistic, but snapshots remain the canonical source.
	 * Keep outstanding patches separate from the server projection so an event for
	 * an earlier revision cannot visibly undo a completed local interaction while
	 * its command is still converging.
	 */
	const pendingSidebarCommitsRef = useRef<Map<string, PendingSidebarCommit[]>>(
		new Map(),
	);
	const sidebarCommitTailsRef = useRef<Map<string, Promise<void>>>(new Map());
	const sidebarCommitSequenceRef = useRef(0);

	useEffect(() => {
		sidebarDefaultsRef.current = sidebarSettings;
	}, [sidebarSettings]);

	useEffect(() => {
		sidebarVisibilityRef.current = sidebarSettings.projectVisibility;
		sidebarActiveGroupRef.current = sidebarSettings.projectActiveGroup;
		setProjects((current) =>
			current.map((project) => ({
				...project,
				isFileExplorerOpen: isProjectSidebarOpenOnDevice(
					sidebarSettings,
					sidebarVisibilityScope,
					project.id,
				),
				sidebarActiveGroup: sidebarActiveGroupOnDevice(
					sidebarSettings,
					sidebarVisibilityScope,
					project.id,
				),
			})),
		);
	}, [sidebarSettings, sidebarVisibilityScope]);

	useEffect(() => {
		projectsRef.current = projects;
	}, [projects]);

	useEffect(() => {
		activeProjectIdRef.current = activeProjectId;
		writePresentationActiveProject(
			projectColorScope,
			workspaceViewId,
			activeProjectId,
		);
	}, [activeProjectId, projectColorScope, workspaceViewId]);

	useEffect(() => {
		if (workspaceSnapshotStore === undefined) return;
		return workspaceSnapshotStore.subscribe((snapshot) => {
			const viewId = workspaceViewId ?? snapshot.viewOrder[0];
			const view = viewId === undefined ? undefined : snapshot.views[viewId];
			const orderedServerProjects =
				view?.projectIds
					.map((projectId) => snapshot.projects[projectId])
					.filter((project) => project !== undefined) ?? [];
			setProjects((current) => {
				const currentById = new Map(
					current.map((project) => [project.id, project]),
				);
				const usedColors: string[] = [];
				const nextFromServer = orderedServerProjects.map(
					(serverProject, index) => {
						const existing = currentById.get(serverProject.id);
						const generated = createProjectTab(
							index + 1,
							serverProject.root,
							usedColors,
							sidebarDefaultsRef.current,
							projectColorScope,
						);
						const base = existing ?? generated;
						const color = serverProject.color ?? generated.color;
						usedColors.push(color);
						const sidebar = applyPendingSidebarCommits(
							projectSidebarState(serverProject.sidebar),
							pendingSidebarCommitsRef.current.get(serverProject.id),
						);
						return {
							...base,
							...sidebar,
							isFileExplorerOpen: isProjectSidebarOpenOnDevice(
								{
									...sidebarDefaultsRef.current,
									projectVisibility: sidebarVisibilityRef.current,
								},
								sidebarVisibilityScope,
								serverProject.id,
							),
							sidebarActiveGroup: sidebarActiveGroupOnDevice(
								{
									...sidebarDefaultsRef.current,
									projectActiveGroup: sidebarActiveGroupRef.current,
								},
								sidebarVisibilityScope,
								serverProject.id,
							),
							id: serverProject.id,
							projectEnvironmentId: serverProject.projectEnvironmentId,
							environmentRevision: serverProject.environmentRevision,
							environmentLabel:
								serverProject.projectEnvironmentId === 'terminay:this-server'
									? 'This server'
									: 'Remote environment',
							environmentStatus: 'ready' as const,
							title: serverProject.name,
							rootFolder: serverProject.root,
							color,
							defaultShellProfileId: serverProject.defaultShellProfileId,
							emoji: serverProject.icon ?? base.emoji,
						};
					},
				);
				const serverById = new Map(
					nextFromServer.map((project) => [project.id, project]),
				);
				const sameMembership =
					holdProjectOrderRef?.current !== null &&
					holdProjectOrderRef?.current !== undefined &&
					current.length === nextFromServer.length &&
					current.every((project) => serverById.has(project.id));
				const next = sameMembership
					? current.map((project) => serverById.get(project.id) ?? project)
					: nextFromServer;
				projectsRef.current = next;
				return next;
			});
			const heldActiveProjectId = holdActiveProjectIdRef?.current;
			const nextActiveId = pickLocalActiveProjectId(
				orderedServerProjects.map((project) => project.id),
				heldActiveProjectId,
				activeProjectIdRef.current,
				readPresentationActiveProject(projectColorScope, viewId ?? null),
			);
			activeProjectIdRef.current = nextActiveId;
			setActiveProjectId(nextActiveId);
		});
	}, [
		holdActiveProjectIdRef,
		projectColorScope,
		sidebarVisibilityScope,
		workspaceSnapshotStore,
		workspaceViewId,
	]);

	const addProject = useCallback(() => {
		if (workspaceSnapshotStore !== undefined) {
			const snapshot = workspaceSnapshotStore.snapshot;
			const viewId = workspaceViewId ?? snapshot?.viewOrder[0];
			if (snapshot === null || viewId === undefined) {
				setProjectCreationError('Workspace is still loading from the server.');
				return;
			}
			projectCounterRef.current += 1;
			const suffix = projectCounterRef.current;
			const projectId = `project-${Date.now().toString(36)}-${suffix}`;
			const activeView = snapshot.views[viewId];
			const fallbackProjectRoot =
				defaultProjectRoot.trim().length > 0 ? defaultProjectRoot : '.';
			const serverRoot =
				snapshot.projects[activeView?.activeProjectId ?? '']?.root ??
				activeView?.projectIds
					.map((id) => snapshot.projects[id]?.root)
					.find((root) => root !== undefined) ??
				fallbackProjectRoot;
			const presentation = createProjectTab(
				suffix,
				serverRoot,
				[
					...projectsRef.current.map((project) => project.color),
					...reservedProjectColorsRef.current,
				],
				sidebarDefaultsRef.current,
				projectColorScope,
			);
			reservedProjectColorsRef.current.add(presentation.color);
			void workspaceSnapshotStore
				.createProject({
					projectId,
					viewId,
					root: serverRoot,
					color: presentation.color,
					icon: presentation.emoji,
					sidebar: {
						...projectSidebarState(presentation),
						isFileExplorerOpen: false,
					},
				})
				.then(() => setProjectCreationError(null))
				.catch((error) => {
					setProjectCreationError(
						error instanceof Error ? error.message : String(error),
					);
				});
			return;
		}
		setProjectCreationError(null);
		projectCounterRef.current += 1;
		const index = projectCounterRef.current;
		setProjects((current) => [
			...current,
			createProjectTab(
				index,
				defaultProjectRoot,
				current.map((project) => project.color),
				sidebarDefaultsRef.current,
				projectColorScope,
			),
		]);
		setActiveProjectId(`project-${index}`);
	}, [
		defaultProjectRoot,
		projectColorScope,
		workspaceSnapshotStore,
		workspaceViewId,
	]);

	const closeProject = useCallback(
		(projectId: string, options: { skipConfirmation?: boolean } = {}) => {
			const current = projectsRef.current;
			const index = current.findIndex((project) => project.id === projectId);
			if (index === -1) return;
			if (
				options.skipConfirmation !== true &&
				confirmProjectClose !== undefined
			) {
				void confirmProjectClose(projectId).then((confirmed) => {
					if (confirmed) closeProject(projectId, { skipConfirmation: true });
				});
				return;
			}
			if (current.length === 1) {
				void closeHostPresentation();
				return;
			}
			if (workspaceSnapshotStore !== undefined) {
				const next = current.filter((project) => project.id !== projectId);
				const nextId =
					activeProjectIdRef.current === projectId
						? (next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? '')
						: activeProjectIdRef.current;
				projectsRef.current = next;
				setProjects(next);
				activeProjectIdRef.current = nextId;
				setActiveProjectId(nextId);
				void workspaceSnapshotStore
					.closeProject(projectId)
					.then(() => {
						setProjectCreationError(null);
					})
					.catch((error) => {
						setProjectCreationError(
							error instanceof Error ? error.message : String(error),
						);
						void workspaceSnapshotStore.refresh().catch(() => undefined);
					});
				return;
			}
			const next = current.filter((project) => project.id !== projectId);
			projectsRef.current = next;
			setProjects(next);
			setAdoptedTerminalsByProject((adopted) => {
				if (!(projectId in adopted)) return adopted;
				const { [projectId]: removed, ...rest } = adopted;
				void removed;
				return rest;
			});
			if (activeProjectIdRef.current === projectId) {
				const nextId = next[Math.max(0, index - 1)]?.id ?? next[0].id;
				activeProjectIdRef.current = nextId;
				setActiveProjectId(nextId);
			}
		},
		[confirmProjectClose, workspaceSnapshotStore],
	);

	const adoptProject = useCallback(
		(
			project: ProjectTab,
			terminals: TTerminal[],
			insertIndex: number | null,
		) => {
			projectCounterRef.current += 1;
			const id = `project-${projectCounterRef.current}`;
			const adopted: ProjectTab = {
				...project,
				id,
				sidebarActiveGroup: project.sidebarActiveGroup ?? 'explorer',
				isAgentsPaneCollapsed: project.isAgentsPaneCollapsed ?? false,
				isDocumentationPaneCollapsed:
					project.isDocumentationPaneCollapsed ?? true,
				expandedAgentEntryIds: Array.isArray(project.expandedAgentEntryIds)
					? project.expandedAgentEntryIds.filter(
							(entryId): entryId is string => typeof entryId === 'string',
						)
					: [],
				expandedDocumentationFolderIds: Array.isArray(
					project.expandedDocumentationFolderIds,
				)
					? project.expandedDocumentationFolderIds.filter(
							(folder): folder is string =>
								typeof folder === 'string' &&
								folder.length > 0 &&
								folder.length <= 4096 &&
								!folder.startsWith('/') &&
								!folder.includes('\\') &&
								!folder
									.split('/')
									.some((part) => !part || part === '.' || part === '..'),
						)
					: [],
				sidebarAgentsHeight:
					project.sidebarAgentsHeight ?? DEFAULT_AGENTS_PANE_HEIGHT,
				sidebarGitHeight:
					project.sidebarGitHeight ?? DEFAULT_AGENTS_PANE_HEIGHT,
				sidebarDocumentationHeight:
					project.sidebarDocumentationHeight ?? DEFAULT_AGENTS_PANE_HEIGHT,
				sidebarPanelOrder: normalizeSidebarPanelOrder(
					project.sidebarPanelOrder,
				),
			};
			setAdoptedTerminalsByProject((current) => ({
				...current,
				[id]: terminals,
			}));
			setProjects((current) => {
				if (insertIndex === null || insertIndex >= current.length)
					return [...current, adopted];
				const next = [...current];
				next.splice(Math.max(0, insertIndex), 0, adopted);
				return next;
			});
			setActiveProjectId(id);
		},
		[],
	);

	const commitProjectSidebar = useCallback(
		(projectId: string, patch: Partial<ProjectSidebarState>): Promise<void> => {
			if (Object.keys(patch).length === 0) return Promise.resolve();

			// Always update presentation immediately. The pending patch below keeps
			// this value intact when an older canonical snapshot is published before
			// the command's resulting revision arrives.
			setProjects((current) =>
				current.map((project) =>
					project.id === projectId ? { ...project, ...patch } : project,
				),
			);
			if (workspaceSnapshotStore === undefined) return Promise.resolve();

			const commit: PendingSidebarCommit = {
				sequence: ++sidebarCommitSequenceRef.current,
				patch,
			};
			const pending = pendingSidebarCommitsRef.current.get(projectId) ?? [];
			pendingSidebarCommitsRef.current.set(projectId, [...pending, commit]);

			const removePending = () => {
				const current = pendingSidebarCommitsRef.current.get(projectId);
				if (current === undefined) return;
				const next = current.filter(
					(candidate) => candidate.sequence !== commit.sequence,
				);
				if (next.length === 0)
					pendingSidebarCommitsRef.current.delete(projectId);
				else pendingSidebarCommitsRef.current.set(projectId, next);
			};

			// Serialize sidebar commands per project. A later drag can begin before
			// the earlier one has converged, but it cannot overtake it at the
			// canonical authority or leave an older response to win locally.
			const previous = sidebarCommitTailsRef.current.get(projectId);
			const run = (
				previous === undefined
					? Promise.resolve()
					: previous.catch(() => undefined)
			)
				.then(async () => {
					await workspaceSnapshotStore.updateProjectSidebar({
						projectId,
						sidebar: commit.patch,
					});
					// A command response proves the server may have advanced, but the
					// workspace event can be delayed or lost. `waitForSnapshot` installs
					// its listener before forcing reconciliation, so the pending overlay
					// is released only after the authoritative projection contains this
					// commit (or a refresh has made the conflict visible).
					await workspaceSnapshotStore.waitForSnapshot(
						(snapshot) => {
							const serverProject = snapshot.projects[projectId];
							return (
								serverProject !== undefined &&
								sidebarMatchesPatch(serverProject.sidebar, commit.patch)
							);
						},
						{ timeoutMs: 2_000 },
					);
					removePending();
					// Publishing the current canonical snapshot after removing the
					// overlay ensures a conflict from another client is accepted rather
					// than leaving the optimistic value mounted indefinitely.
					await workspaceSnapshotStore.refresh();
				})
				.catch(async (error) => {
					removePending();
					try {
						await workspaceSnapshotStore.refresh();
					} catch {
						// Preserve the existing failure path; the next interaction can
						// still attempt a fresh bounded commit.
					}
					throw error;
				});
			sidebarCommitTailsRef.current.set(projectId, run);
			const clearTail = () => {
				if (sidebarCommitTailsRef.current.get(projectId) === run) {
					sidebarCommitTailsRef.current.delete(projectId);
				}
			};
			void run.then(clearTail, clearTail);
			return run;
		},
		[workspaceSnapshotStore],
	);

	const updateProject = useCallback(
		(projectId: string, updates: Partial<ProjectTab>) => {
			const { isFileExplorerOpen, sidebarActiveGroup, rootFolder, ...localUpdates } =
				updates;
			if (isFileExplorerOpen !== undefined) {
				sidebarVisibilityRef.current = {
					...sidebarVisibilityRef.current,
					[projectSidebarVisibilityKey(sidebarVisibilityScope, projectId)]:
						isFileExplorerOpen,
				};
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId
							? { ...project, isFileExplorerOpen }
							: project,
					),
				);
				onProjectSidebarVisibilityChange?.(projectId, isFileExplorerOpen);
			}
			if (sidebarActiveGroup !== undefined) {
				sidebarActiveGroupRef.current = {
					...sidebarActiveGroupRef.current,
					[projectSidebarVisibilityKey(sidebarVisibilityScope, projectId)]:
						sidebarActiveGroup,
				};
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId
							? { ...project, sidebarActiveGroup }
							: project,
					),
				);
				onProjectSidebarActiveGroupChange?.(projectId, sidebarActiveGroup);
			}
			const sidebar = projectSidebarPatch(localUpdates);
			const nonSidebarUpdates = { ...localUpdates };
			if (sidebar !== null) {
				for (const key of Object.keys(sidebar)) {
					delete (nonSidebarUpdates as Record<string, unknown>)[key];
				}
			}
			if (Object.keys(nonSidebarUpdates).length > 0) {
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId
							? { ...project, ...nonSidebarUpdates }
							: project,
					),
				);
			}
			if (sidebar !== null) {
				void commitProjectSidebar(projectId, sidebar).catch(() => {
					// `commitProjectSidebar` has already reconciled the last known
					// authority. Keep generic project interactions non-throwing.
				});
			}
			if (rootFolder === undefined) return;
			if (workspaceSnapshotStore === undefined) {
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId ? { ...project, rootFolder } : project,
					),
				);
				return;
			}
			void workspaceSnapshotStore
				.setProjectRoot({ projectId, root: rootFolder })
				.catch(() => {
					void workspaceSnapshotStore.refresh().catch(() => undefined);
				});
		},
		[
			commitProjectSidebar,
			onProjectSidebarActiveGroupChange,
			onProjectSidebarVisibilityChange,
			sidebarVisibilityScope,
			workspaceSnapshotStore,
		],
	);

	const activateProject = useCallback(
		(projectId: string) => {
			if (
				holdActiveProjectIdRef !== undefined &&
				holdActiveProjectIdRef.current !== null
			) {
				holdActiveProjectIdRef.current = projectId;
			}
			activeProjectIdRef.current = projectId;
			setActiveProjectId(projectId);
		},
		[holdActiveProjectIdRef],
	);

	return {
		activateProject,
		activeProjectId,
		activeProjectIdRef,
		addProject,
		adoptedTerminalsByProject,
		adoptProject,
		canAddProject:
			workspaceSnapshotStore === undefined ||
			workspaceSnapshotStore.snapshot !== null,
		closeProject,
		homePath: defaultProjectRoot,
		isWorkspaceHydrating:
			workspaceSnapshotStore !== undefined &&
			workspaceSnapshotStore.snapshot === null,
		projectCreationError,
		projects,
		projectsRef,
		commitProjectSidebar,
		setActiveProjectId,
		setProjects,
		updateProject,
	};
}
