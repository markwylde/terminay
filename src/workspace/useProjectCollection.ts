import {
	type MutableRefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import { closeHostPresentation } from '../host/nativeActions';
import { normalizeSidebarPanelOrder } from '../terminalSettings';
import type { SidebarSettings } from '../types/settings';
import { createProjectTab, type ProjectTab } from './projectTabModel';

const DEFAULT_AGENTS_PANE_HEIGHT = 200;

export function useProjectCollection<TTerminal>({
	defaultProjectRoot = '',
	isAdoptWindow,
	isSettingsLoading,
	projectColorScope,
	confirmProjectClose,
	holdProjectOrderRef,
	sidebarSettings,
	workspaceSnapshotStore,
	workspaceViewId,
}: {
	/** Canonical server-projected root for newly created projects. The hook
	 * never discovers host filesystem paths on its own. */
	defaultProjectRoot?: string;
	isAdoptWindow: boolean;
	isSettingsLoading: boolean;
	/** Stable server identity used only to synthesize unpersisted project colors. */
	projectColorScope: string;
	confirmProjectClose?: (projectId: string) => Promise<boolean>;
	holdProjectOrderRef?: MutableRefObject<string | null>;
	sidebarSettings: SidebarSettings;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
	workspaceViewId: string | null;
}) {
	const sidebarDefaultsRef = useRef(sidebarSettings);
	const didApplyPersistedSidebarOrderRef = useRef(false);
	const projectCounterRef = useRef(1);
	const initialServerSnapshot = workspaceSnapshotStore?.snapshot;
	const hasServerWorkspace = workspaceSnapshotStore !== undefined;
	const initialViewId =
		workspaceViewId ?? initialServerSnapshot?.viewOrder[0] ?? null;
	const initialServerView =
		initialViewId === null ? undefined : initialServerSnapshot?.views[initialViewId];
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
	const [activeProjectId, setActiveProjectId] = useState(
		isAdoptWindow
			? ''
			: hasServerWorkspace && initialServerSnapshot === null
				? ''
				: (initialServerView?.activeProjectId ??
					initialServerProjects[0]?.id ??
					(hasServerWorkspace ? '' : 'project-1')),
	);
	const activeProjectIdRef = useRef(activeProjectId);
	const reservedProjectColorsRef = useRef(new Set<string>());
	const [projectCreationError, setProjectCreationError] = useState<
		string | null
	>(null);
	const [adoptedTerminalsByProject, setAdoptedTerminalsByProject] = useState<
		Record<string, TTerminal[]>
	>({});

	useEffect(() => {
		sidebarDefaultsRef.current = sidebarSettings;
	}, [sidebarSettings]);

	useEffect(() => {
		if (isSettingsLoading || didApplyPersistedSidebarOrderRef.current) return;
		didApplyPersistedSidebarOrderRef.current = true;
		setProjects((current) =>
			current.map((project) => ({
				...project,
				sidebarPanelOrder: [...sidebarSettings.panelOrder],
			})),
		);
	}, [isSettingsLoading, sidebarSettings.panelOrder]);

	useEffect(() => {
		projectsRef.current = projects;
	}, [projects]);

	useEffect(() => {
		activeProjectIdRef.current = activeProjectId;
	}, [activeProjectId]);

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
						return {
							...base,
							hasResolvedDocumentationPaneDefault:
								existing !== undefined && existing.rootFolder === serverProject.root
									? existing.hasResolvedDocumentationPaneDefault
									: false,
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
			const nextActiveId =
				view?.activeProjectId ??
				view?.projectIds[0] ??
				orderedServerProjects[0]?.id ??
				'';
			activeProjectIdRef.current = nextActiveId;
			setActiveProjectId(nextActiveId);
		});
	}, [projectColorScope, workspaceSnapshotStore, workspaceViewId]);

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
					name: `Project ${Object.keys(snapshot.projects).length + 1}`,
					color: presentation.color,
					icon: presentation.emoji,
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
	}, [defaultProjectRoot, projectColorScope, workspaceSnapshotStore, workspaceViewId]);

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
						if (nextId.length > 0) {
							void workspaceSnapshotStore
								.activateProject({ projectId: nextId })
								.catch(() => undefined);
						}
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
				isAgentsPaneCollapsed: project.isAgentsPaneCollapsed ?? false,
				isDocumentationPaneCollapsed: project.isDocumentationPaneCollapsed ?? true,
				hasResolvedDocumentationPaneDefault:
					project.hasResolvedDocumentationPaneDefault ?? true,
				expandedAgentEntryIds: Array.isArray(project.expandedAgentEntryIds)
					? project.expandedAgentEntryIds.filter(
							(entryId): entryId is string => typeof entryId === 'string',
						)
						: [],
				expandedDocumentationFolderIds: Array.isArray(project.expandedDocumentationFolderIds)
					? project.expandedDocumentationFolderIds.filter(
							(folder): folder is string => typeof folder === 'string' && folder.length > 0 && folder.length <= 4096 && !folder.startsWith('/') && !folder.includes('\\') && !folder.split('/').some((part) => !part || part === '.' || part === '..'),
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

	const updateProject = useCallback(
		(projectId: string, updates: Partial<ProjectTab>) => {
			const { rootFolder, ...localUpdates } = updates;
			if (rootFolder !== undefined)
				localUpdates.hasResolvedDocumentationPaneDefault = false;
			if (Object.keys(localUpdates).length > 0) {
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId
							? { ...project, ...localUpdates }
							: project,
					),
				);
			}
			if (rootFolder === undefined) return;
			if (workspaceSnapshotStore === undefined) {
				setProjects((current) =>
					current.map((project) =>
						project.id === projectId
							? {
									...project,
									rootFolder,
									hasResolvedDocumentationPaneDefault: false,
								}
							: project,
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
		[workspaceSnapshotStore],
	);

	const activateProject = useCallback(
		(projectId: string) => {
			activeProjectIdRef.current = projectId;
			setActiveProjectId(projectId);
			if (workspaceSnapshotStore === undefined) return;
			void workspaceSnapshotStore.activateProject({ projectId }).catch(() => {
				void workspaceSnapshotStore.refresh().catch(() => undefined);
			});
		},
		[workspaceSnapshotStore],
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
		setActiveProjectId,
		setProjects,
		updateProject,
	};
}
