import {
	ClientError,
	ShellProfilesClient,
	type TerminayClient,
	TerminayClientFacade,
	WorkspaceClient,
} from '@terminay/client-core';
import { useCallback, useRef } from 'react';
import type { AuxiliaryRouteController } from '../shared/auxiliaryRoutes';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import type { ProjectTab } from './projectTabModel';

/** A busy workspace can advance its revision again during a retry. */
export const PROJECT_SAVE_ATTEMPTS = 4;

/**
 * The root a person typed, with `~` expanded when the home folder is known.
 * Without one (another project's folder is never a stand-in for it) the path
 * goes to the server as typed, which validates it. An empty field keeps a
 * project with no root folder as it is.
 */
export function normalizeProjectRoot(value: string, homePath: string): string {
	const trimmed = value.trim();
	if (!trimmed) return homePath;
	if (homePath.length === 0) return trimmed;
	if (trimmed === '~') return homePath;
	if (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))
		return `${homePath}${trimmed.slice(1)}`;
	return trimmed;
}

function isStaleRevision(error: unknown): boolean {
	return (
		error instanceof ClientError &&
		error.code === 'conflict' &&
		error.message.toLowerCase().includes('stale')
	);
}

/**
 * Run one workspace write against the current revision. Each attempt is built
 * afresh, so a retry carries what the server has committed since the last one.
 */
export async function withFreshRevision<T>(
	revision: () => number | undefined,
	refresh: () => Promise<unknown>,
	write: (expectedRevision: number | undefined) => Promise<T>,
	attempts: number = PROJECT_SAVE_ATTEMPTS,
): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await write(revision());
		} catch (error) {
			if (attempt >= attempts || !isStaleRevision(error)) throw error;
			await refresh();
		}
	}
}

/** Run tasks of one key in order; a failed task never blocks the next. */
export function enqueueByKey<T>(
	queues: Map<string, Promise<unknown>>,
	key: string,
	task: () => Promise<T>,
): Promise<T> {
	const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
	const settled = run.then(
		() => undefined,
		() => undefined,
	);
	queues.set(key, settled);
	void settled.then(() => {
		if (queues.get(key) === settled) queues.delete(key);
	});
	return run;
}

/**
 * Write one saved edit to the server and return the project's canonical root.
 * Every attempt reads the snapshot again, so a root the person left alone is
 * always the one the server has committed by then.
 */
export async function writeProjectEdit({
	client,
	store,
	projectId,
	root,
	rootChanged,
	title,
	color,
	emoji,
	shellProfile,
}: {
	client: Pick<WorkspaceClient, 'setProjectShellProfile' | 'updateProject' | 'updateProjectRoot'>;
	store?: Pick<WorkspaceSnapshotStore, 'snapshot' | 'refresh'>;
	projectId: string;
	root: string;
	rootChanged: boolean;
	title: string;
	color: string;
	emoji: string;
	shellProfile?: { readonly profileId: string | null };
}): Promise<string> {
	const revision = () => store?.snapshot?.revision;
	const refresh = async () => {
		await store?.refresh();
	};
	const commandOptions = (expectedRevision: number | undefined) => ({
		commandId: crypto.randomUUID(),
		...(expectedRevision === undefined ? {} : { expectedRevision }),
	});
	if (shellProfile !== undefined) {
		await withFreshRevision(revision, refresh, (expectedRevision) =>
			client.setProjectShellProfile(
				{ projectId, ...(shellProfile.profileId === null ? {} : { profileId: shellProfile.profileId }) },
				commandOptions(expectedRevision),
			),
		);
		await refresh();
	}
	let canonicalRoot = root;
	if (rootChanged) {
		canonicalRoot = (
			await withFreshRevision(revision, refresh, (expectedRevision) =>
				client.updateProjectRoot(
					{
						projectId,
						root,
						...(expectedRevision === undefined ? {} : { expectedRevision }),
					},
					{ commandId: crypto.randomUUID() },
				),
			)
		).root;
		await refresh();
	}
	await withFreshRevision(revision, refresh, (expectedRevision) =>
		client.updateProject(
			{
				projectId,
				name: title.trim() || 'Untitled Project',
				root: store?.snapshot?.projects[projectId]?.root ?? canonicalRoot,
				color,
				icon: emoji.trim(),
			},
			commandOptions(expectedRevision),
		),
	);
	await refresh();
	return store?.snapshot?.projects[projectId]?.root ?? canonicalRoot;
}

/** What the person is told when a save could not be applied. */
export function projectSaveErrorMessage(error: unknown): string {
	return `Unable to save project: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Each call starts an edit and returns whether it is still the latest. A
 * finished edit must not pull focus out of an editor opened after it, or what
 * the person types there goes to the terminal's shell.
 */
export function createLatestEditGuard(): () => () => boolean {
	let latest = 0;
	return () => {
		latest += 1;
		const edit = latest;
		return () => edit === latest;
	};
}

export function useProjectEditor({
	applicationClient,
	focusProject,
	homePath,
	auxiliaryRoutes,
	onSaveError,
	projects,
	updateProject,
	workspaceSnapshotStore,
}: {
	applicationClient?: TerminayClient;
	auxiliaryRoutes: Pick<AuxiliaryRouteController, 'editProjectTab'>;
	focusProject: (projectId: string) => void;
	homePath: string;
	onSaveError?: (projectId: string, message: string) => void;
	projects: ProjectTab[];
	updateProject: (projectId: string, updates: Partial<ProjectTab>) => void;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
}) {
	const saves = useRef(new Map<string, Promise<unknown>>());
	const startEdit = useRef(createLatestEditGuard());
	return useCallback(
		async (projectId: string) => {
			const project = projects.find((candidate) => candidate.id === projectId);
			if (!project) return;
			const isLatestEdit = startEdit.current();
			try {
				const serverProject = workspaceSnapshotStore?.snapshot?.projects[projectId];
				const currentDefaultShellProfileId = serverProject?.defaultShellProfileId ?? project.defaultShellProfileId ?? null;
				const shellProfileCatalogue = applicationClient === undefined
					? null
					: await new ShellProfilesClient(new TerminayClientFacade(applicationClient)).catalogue();
				const result = await auxiliaryRoutes.editProjectTab({
					kind: 'project',
					projectId,
						draft: {
							color: project.color,
							defaultShellProfileId: currentDefaultShellProfileId,
							emoji: project.emoji,
							rootFolder: project.rootFolder,
							shellProfileOptions: (shellProfileCatalogue?.entries ?? []).filter((profile) => profile.kind !== 'discovered').map((profile) => ({ id: profile.id, name: profile.name, available: profile.availability.available })),
							title: project.title,
					},
				});
				if (!result) return;
				const root = normalizeProjectRoot(result.rootFolder, homePath);
				const rootChanged = root !== project.rootFolder;
				await enqueueByKey(saves.current, projectId, async () => {
					const canonicalRoot = applicationClient
						? await writeProjectEdit({
								client: new WorkspaceClient(applicationClient),
								store: workspaceSnapshotStore,
								projectId,
								root,
								rootChanged,
								title: result.title,
								color: result.color,
								emoji: result.emoji,
								shellProfile:
									result.defaultShellProfileId !== currentDefaultShellProfileId
										? { profileId: result.defaultShellProfileId }
										: undefined,
							})
						: root;
					updateProject(projectId, {
						...(result.defaultShellProfileId === null ? { defaultShellProfileId: undefined } : { defaultShellProfileId: result.defaultShellProfileId }),
						title: result.title.trim() || 'Untitled Project',
						emoji: result.emoji.trim(),
						color: result.color,
						...(rootChanged ? { rootFolder: canonicalRoot } : {}),
					});
				});
			} catch (error) {
				if (!onSaveError) throw error;
				onSaveError(projectId, projectSaveErrorMessage(error));
			} finally {
				// Native modal teardown and the server snapshot reconciliation
				// each consume a frame. Restore terminal input focus only after
				// both presentation transitions have committed.
				window.requestAnimationFrame(() => {
					window.requestAnimationFrame(() => {
						if (isLatestEdit()) focusProject(projectId);
					});
				});
			}
		},
		[
			applicationClient,
			auxiliaryRoutes,
			focusProject,
			homePath,
			onSaveError,
			projects,
			updateProject,
			workspaceSnapshotStore,
		],
	);
}
