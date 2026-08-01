import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import { normalizeSidebarPanelOrder } from '../terminalSettings';
import type { SidebarSettings } from '../types/settings';
import { createProjectTab, type ProjectTab } from './projectTabModel';

const DEFAULT_AGENTS_PANE_HEIGHT = 200;

export function useProjectCollection<TTerminal>({
	defaultProjectRoot = '',
	isAdoptWindow,
	isSettingsLoading,
	projectColorScope,
	sidebarSettings,
	workspaceSnapshotStore,
}: {
	/** Canonical server-projected root for newly created projects. The hook
	 * never discovers host filesystem paths on its own. */
	defaultProjectRoot?: string;
	isAdoptWindow: boolean;
	isSettingsLoading: boolean;
	/** Stable server identity used only to synthesize unpersisted project colors. */
	projectColorScope: string;
	sidebarSettings: SidebarSettings;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
}) {
	const sidebarDefaultsRef = useRef(sidebarSettings);
	const didApplyPersistedSidebarOrderRef = useRef(false);
	const projectCounterRef = useRef(1);
	const initialServerSnapshot = workspaceSnapshotStore?.snapshot;
	const hasServerWorkspace = workspaceSnapshotStore !== undefined;
	const initialServerProjects =
		initialServerSnapshot?.viewOrder.flatMap(
			(viewId) =>
				initialServerSnapshot.views[viewId]?.projectIds
					.map((projectId) => initialServerSnapshot.projects[projectId])
					.filter((project) => project !== undefined) ?? [],
		) ?? [];
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
					title: serverProject.name,
					rootFolder: serverProject.root,
					color,
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
				: (initialServerSnapshot?.views[
						initialServerSnapshot.viewOrder[0] ?? ''
					]?.activeProjectId ??
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
			const orderedServerProjects = snapshot.viewOrder.flatMap((viewId) => {
				const view = snapshot.views[viewId];
				return (
					view?.projectIds
						.map((projectId) => snapshot.projects[projectId])
						.filter((project) => project !== undefined) ?? []
				);
			});
			setProjects((current) => {
				const currentById = new Map(
					current.map((project) => [project.id, project]),
				);
				const usedColors: string[] = [];
				const next = orderedServerProjects.map((serverProject, index) => {
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
						id: serverProject.id,
						title: serverProject.name,
						rootFolder: serverProject.root,
						color,
						emoji: serverProject.icon ?? base.emoji,
					};
				});
				projectsRef.current = next;
				return next;
			});
			const activeView = snapshot.views[snapshot.viewOrder[0] ?? ''];
			const nextActiveId =
				activeView?.activeProjectId ??
				activeView?.projectIds[0] ??
				orderedServerProjects[0]?.id ??
				'';
			activeProjectIdRef.current = nextActiveId;
			setActiveProjectId(nextActiveId);
		});
	}, [projectColorScope, workspaceSnapshotStore]);

	const addProject = useCallback(() => {
		if (workspaceSnapshotStore !== undefined) {
			const snapshot = workspaceSnapshotStore.snapshot;
			const viewId = snapshot?.viewOrder[0];
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
	}, [defaultProjectRoot, projectColorScope, workspaceSnapshotStore]);

	const closeProject = useCallback(
		(projectId: string) => {
			const current = projectsRef.current;
			const index = current.findIndex((project) => project.id === projectId);
			if (index === -1) return;
			if (current.length === 1) {
				void window.terminayWindowLifecycleHost?.closeCurrent();
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
		[workspaceSnapshotStore],
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
				expandedAgentEntryIds: Array.isArray(project.expandedAgentEntryIds)
					? project.expandedAgentEntryIds.filter(
							(entryId): entryId is string => typeof entryId === 'string',
						)
					: [],
				sidebarAgentsHeight:
					project.sidebarAgentsHeight ?? DEFAULT_AGENTS_PANE_HEIGHT,
				sidebarGitHeight:
					project.sidebarGitHeight ?? DEFAULT_AGENTS_PANE_HEIGHT,
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
