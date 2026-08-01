import {
	ClientError,
	type TerminayClient,
	WorkspaceClient,
} from '@terminay/client-core';
import { useCallback } from 'react';
import type { AuxiliaryRouteController } from '../shared/auxiliaryRoutes';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import type { ProjectTab } from './projectTabModel';

export function normalizeProjectRoot(value: string, homePath: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed === '~') return homePath;
	if (trimmed.startsWith('~/') || trimmed.startsWith('~\\'))
		return `${homePath}${trimmed.slice(1)}`;
	return trimmed;
}

export function useProjectEditor({
	applicationClient,
	focusProject,
	homePath,
	auxiliaryRoutes,
	projects,
	updateProject,
	workspaceSnapshotStore,
}: {
	applicationClient?: TerminayClient;
	auxiliaryRoutes: Pick<AuxiliaryRouteController, 'editProjectTab'>;
	focusProject: (projectId: string) => void;
	homePath: string;
	projects: ProjectTab[];
	updateProject: (projectId: string, updates: Partial<ProjectTab>) => void;
	workspaceSnapshotStore?: WorkspaceSnapshotStore;
}) {
	return useCallback(
		async (projectId: string) => {
			const project = projects.find((candidate) => candidate.id === projectId);
			if (!project) return;
			try {
				const result = await auxiliaryRoutes.editProjectTab({
					kind: 'project',
					projectId,
					draft: {
						color: project.color,
						emoji: project.emoji,
						rootFolder: project.rootFolder,
						title: project.title,
					},
				});
				if (!result) return;
				const root = normalizeProjectRoot(result.rootFolder, homePath);
				let canonicalRoot = root;
				if (applicationClient) {
					const client = new WorkspaceClient(applicationClient);
					if (root !== project.rootFolder) {
						const updateRoot = (expectedRevision?: number) =>
							client.updateProjectRoot(
								{
									projectId,
									root,
									...(expectedRevision === undefined ? {} : { expectedRevision }),
								},
								{ commandId: crypto.randomUUID() },
							);
						try {
							canonicalRoot = (await updateRoot(
								workspaceSnapshotStore?.snapshot?.revision,
							)).root;
						} catch (error) {
							if (!(error instanceof ClientError) || error.code !== 'conflict') throw error;
							const refreshed = await workspaceSnapshotStore?.refresh();
							canonicalRoot = (await updateRoot(refreshed?.revision)).root;
						}
						await workspaceSnapshotStore?.refresh();
					}
					const update = (expectedRevision?: number) =>
						client.updateProject(
							{
								projectId,
								name: result.title.trim() || 'Untitled Project',
								root: canonicalRoot,
								color: result.color,
								icon: result.emoji.trim(),
							},
							{
								commandId: crypto.randomUUID(),
								...(expectedRevision === undefined ? {} : { expectedRevision }),
							},
						);
					try {
						await update(
							workspaceSnapshotStore?.snapshot?.revision,
						);
					} catch (error) {
						if (
							!(error instanceof ClientError) ||
							error.code !== 'conflict' ||
							!error.message.toLowerCase().includes('stale')
						)
							throw error;
						const refreshed = await workspaceSnapshotStore?.refresh();
						await update(refreshed?.revision);
					}
					await workspaceSnapshotStore?.refresh();
				}
				updateProject(projectId, {
					title: result.title.trim() || 'Untitled Project',
					emoji: result.emoji.trim(),
					color: result.color,
					rootFolder: canonicalRoot,
				});
			} finally {
				// Native modal teardown and the server snapshot reconciliation
				// each consume a frame. Restore terminal input focus only after
				// both presentation transitions have committed.
				window.requestAnimationFrame(() => {
					window.requestAnimationFrame(() => focusProject(projectId));
				});
			}
		},
		[
			applicationClient,
			auxiliaryRoutes,
			focusProject,
			homePath,
			projects,
			updateProject,
			workspaceSnapshotStore,
		],
	);
}
