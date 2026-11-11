/**
 * The order the pull request and issue actions run in (ADR-0106), apart from
 * the window that supplies each step. Opening a worktree is: use the matched
 * one, or ask the server to create one (taking the worktree it names when the
 * branch is already out in that project, as after a retry); wait for its
 * folder; select it; then open the chosen terminal there.
 */

import type {
	ForgeActionResult,
	ForgeTerminalChoice,
	ForgeWorktreeRequest,
	ForgeWorktreeTarget,
} from './ForgeViews.tsx';

export type ForgeWorktreeCreation = Readonly<{
	path: string | null;
	error?: Readonly<{ code: string; message: string; path?: string }>;
}>;

export type ForgeActionSteps = Readonly<{
	createWorktree?: (request: ForgeWorktreeRequest) => Promise<ForgeWorktreeCreation>;
	folderForWorktree: (projectId: string, path: string) => Promise<string | undefined>;
	selectFolder: (projectId: string, folderId: string) => void;
	startTerminal: (
		projectId: string,
		folderId: string,
		launcher: Readonly<{ launcherId: string; prompt: string }> | undefined,
	) => Promise<boolean>;
}>;

export async function openInWorktree(
	steps: ForgeActionSteps,
	target: ForgeWorktreeTarget,
	terminal: ForgeTerminalChoice,
): Promise<ForgeActionResult> {
	let projectId: string;
	let path: string;
	if ('match' in target) {
		if (target.match.path === undefined) return { ok: false, message: 'That worktree is not on this server.' };
		projectId = target.match.projectId;
		path = target.match.path;
	} else {
		if (steps.createWorktree === undefined) return { ok: false, message: 'This connection cannot create worktrees.' };
		const result = await steps.createWorktree(target.create);
		projectId = target.create.projectId;
		if (result.error !== undefined) {
			if (result.error.code === 'checkedOut' && result.error.path !== undefined) path = result.error.path;
			else return { ok: false, message: result.error.message, code: result.error.code };
		} else if (result.path === null) {
			return { ok: false, message: 'The worktree was not created.' };
		} else path = result.path;
	}
	const folderId = await steps.folderForWorktree(projectId, path);
	if (folderId === undefined)
		return { ok: false, message: `The worktree at ${path} has no folder yet. Try again in a moment.` };
	if (terminal.kind === 'none') {
		steps.selectFolder(projectId, folderId);
		return { ok: true };
	}
	const created = await steps.startTerminal(
		projectId,
		folderId,
		terminal.kind === 'launcher' ? { launcherId: terminal.launcherId, prompt: terminal.prompt } : undefined,
	);
	return created
		? { ok: true }
		: { ok: false, message: 'The worktree is ready, but its terminal could not be started. Retry to open it there.' };
}

/** What Start work says about the branch, and whether it may go ahead. */
export function startWorkPlanState(
	plan:
		| Readonly<{ path: string | null; branchValid: boolean; branchExists: boolean; checkedOutAt: string | null }>
		| undefined,
	useExisting: boolean,
): Readonly<{ note: string; offerExisting: boolean; reuseExisting: boolean; blocked: boolean }> {
	if (plan === undefined)
		return { note: 'Working out where the worktree goes…', offerExisting: false, reuseExisting: false, blocked: false };
	if (!plan.branchValid)
		return { note: 'That is not a valid branch name.', offerExisting: false, reuseExisting: false, blocked: true };
	if (plan.checkedOutAt !== null)
		return {
			note: `Already checked out at ${plan.checkedOutAt}; Start work opens there.`,
			offerExisting: false,
			reuseExisting: true,
			blocked: false,
		};
	const note = plan.path === null ? 'Working out where the worktree goes…' : `Worktree: ${plan.path}`;
	if (plan.branchExists) return { note, offerExisting: true, reuseExisting: useExisting, blocked: !useExisting };
	return { note, offerExisting: false, reuseExisting: false, blocked: false };
}
