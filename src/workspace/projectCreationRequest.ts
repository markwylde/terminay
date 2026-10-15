import type {
	ProjectCreateRequest,
	ProjectSidebarState,
} from '@terminay/client-core';

/**
 * The `project.create` a person's "new project" sends.
 *
 * It never names a root. A new project never takes another project's folder,
 * the active one's or the first one's: the server holds it awaiting a start
 * choice, or, when the connection did not negotiate one, puts it in its own
 * default folder (ADR-0066). Nothing about the projects already open is an
 * input here, so none can leak into the request.
 */
export function newProjectCreateRequest(
	input: Readonly<{
		projectId: string;
		viewId: string;
		color: string;
		icon: string;
		sidebar?: ProjectSidebarState;
	}>,
): ProjectCreateRequest {
	return {
		projectId: input.projectId,
		viewId: input.viewId,
		color: input.color,
		icon: input.icon,
		...(input.sidebar === undefined ? {} : { sidebar: input.sidebar }),
	};
}
