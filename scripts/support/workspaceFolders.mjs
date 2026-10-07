/**
 * Give a hand-built workspace snapshot the folders the server always sends:
 * one General folder per project holding that project's panels. Fixtures that
 * are about something else stay readable, and still have a valid shape.
 */
export function withGeneralFolders(state) {
	const folders = { ...(state.folders ?? {}) };
	const panels = { ...state.panels };
	const projects = {};
	for (const [projectId, project] of Object.entries(state.projects)) {
		if (project.folderIds !== undefined) {
			projects[projectId] = project;
			continue;
		}
		const folderId = `general:${projectId}`;
		const panelIds = project.panelIds ?? [];
		folders[folderId] = {
			id: folderId,
			projectId,
			name: 'General',
			kind: 'general',
			panelIds: [...panelIds],
			...(project.activePanelId === undefined
				? {}
				: { activePanelId: project.activePanelId }),
		};
		projects[projectId] = { ...project, folderIds: [folderId] };
		for (const panelId of panelIds)
			if (panels[panelId] !== undefined && panels[panelId].folderId === undefined)
				panels[panelId] = { ...panels[panelId], folderId };
	}
	// A panel a fixture lists only under `panels` still needs a folder.
	for (const [panelId, panel] of Object.entries(panels)) {
		if (panel.folderId !== undefined) continue;
		const folderId = projects[panel.projectId]?.folderIds[0];
		if (folderId === undefined) continue;
		panels[panelId] = { ...panel, folderId };
		if (!folders[folderId].panelIds.includes(panelId))
			folders[folderId] = {
				...folders[folderId],
				panelIds: [...folders[folderId].panelIds, panelId],
			};
	}
	return { ...state, projects, folders, panels };
}
