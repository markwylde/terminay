import { useCallback, useState } from 'react';
import type { GitWorktreeStatus, QuickPushAction } from '../types/terminay';

export type GitPushMenuTarget = {
	branch: string | null;
	cwd: string;
	defaultBranch?: string | null;
	worktreePath?: string;
};

type Options = {
	defaultBranch: string | null | undefined;
	isAgentEnabled: boolean;
	onDisabled: () => void;
	onLaunchAgent: (action: QuickPushAction, target: GitPushMenuTarget) => void;
};

export function useGitPushMenuController({
	defaultBranch,
	isAgentEnabled,
	onDisabled,
	onLaunchAgent,
}: Options) {
	const [gitPushMenuPosition, setGitPushMenuPosition] = useState<{
		target: GitPushMenuTarget;
		x: number;
		y: number;
	} | null>(null);
	const [quickPushAction, setQuickPushAction] =
		useState<QuickPushAction | null>(null);
	const [quickPushCwd, setQuickPushCwd] = useState<string | null>(null);

	const closeGitPushMenu = useCallback(() => setGitPushMenuPosition(null), []);
	const closeQuickPush = useCallback(() => {
		setQuickPushAction(null);
		setQuickPushCwd(null);
	}, []);
	const handleOpenWorktreePushMenu = useCallback(
		(worktree: GitWorktreeStatus, anchor: { x: number; y: number }) => {
			setGitPushMenuPosition((current) =>
				current?.target.worktreePath === worktree.path
					? null
					: {
							x: anchor.x,
							y: anchor.y,
							target: {
								branch: worktree.branch,
								cwd: worktree.path,
								defaultBranch: defaultBranch ?? 'main',
								worktreePath: worktree.path,
							},
						},
			);
		},
		[defaultBranch],
	);
	const launchGitPushAgent = useCallback(
		(action: QuickPushAction, target: GitPushMenuTarget) => {
			closeGitPushMenu();
			if (!isAgentEnabled) {
				onDisabled();
				return;
			}
			onLaunchAgent(action, target);
		},
		[closeGitPushMenu, isAgentEnabled, onDisabled, onLaunchAgent],
	);
	const launchQuickPush = useCallback(
		(action: QuickPushAction, target: GitPushMenuTarget) => {
			closeGitPushMenu();
			if (!isAgentEnabled) {
				onDisabled();
				return;
			}
			setQuickPushCwd(target.cwd);
			setQuickPushAction(action);
		},
		[closeGitPushMenu, isAgentEnabled, onDisabled],
	);

	return {
		closeGitPushMenu,
		closeQuickPush,
		gitPushMenuPosition,
		handleOpenWorktreePushMenu,
		launchGitPushAgent,
		launchQuickPush,
		quickPushAction,
		quickPushCwd,
	};
}
