import {
	CircleCheck,
	CircleDashed,
	CircleX,
	GitPullRequest,
	GitPullRequestDraft,
	MinusCircle,
} from 'lucide-react';
import { type JSX, useState } from 'react';
import { openExternalUrl } from '../../host/nativeActions';
import type {
	GitWorktreeStatus,
	WorktreeCheckState,
	WorktreeProperties,
} from '../../types/terminay';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import {
	checksAccessibleName,
	checksTone,
	hasWorktreeProperties,
	orderedCheckItems,
	pullRequestAccessibleName,
	pullRequestTitle,
} from './worktreePropertyPresentation';

type Checks = NonNullable<WorktreeProperties['checks']>;

export type WorktreePropertyChipsProps = {
	worktree: GitWorktreeStatus;
	/** Fetches every check item; listings carry only the counts. */
	onLoadChecks?: (worktree: GitWorktreeStatus) => Promise<Checks | undefined>;
};

const CHECK_ICONS: Readonly<Record<WorktreeCheckState, typeof CircleX>> = {
	failed: CircleX,
	pending: CircleDashed,
	passed: CircleCheck,
	skipped: MinusCircle,
};

/** Terminay's own rendering of extension-published worktree facts. */
export function WorktreePropertyChips({
	worktree,
	onLoadChecks,
}: WorktreePropertyChipsProps): JSX.Element | null {
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		items: ContextMenuItem[];
	} | null>(null);
	const properties = worktree.properties;
	if (!hasWorktreeProperties(properties)) return null;
	const { pullRequest, checks } = properties;

	const showChecks = async (anchor: { x: number; y: number }) => {
		if (checks === undefined) return;
		let loaded: Checks | undefined = checks;
		try {
			loaded = (await onLoadChecks?.(worktree)) ?? checks;
		} catch {
			loaded = checks;
		}
		const items = orderedCheckItems(loaded);
		setMenu({
			...anchor,
			items:
				items.length === 0
					? [
							{
								label: 'No check details available',
								disabled: true,
								onClick: () => {},
							},
						]
					: items.map((item) => {
							const Icon = CHECK_ICONS[item.state];
							return {
								label: item.name,
								icon: (
									<Icon
										size={14}
										className={`worktree-chip__check-icon worktree-chip__check-icon--${item.state}`}
										aria-label={item.state}
									/>
								),
								disabled: item.url === undefined,
								onClick: () => {
									if (item.url !== undefined) void openExternalUrl(item.url);
								},
							};
						}),
		});
	};

	const PullRequestIcon =
		pullRequest?.state === 'draft' ? GitPullRequestDraft : GitPullRequest;
	return (
		<div className="worktrees-panel__properties">
			{pullRequest === undefined ? null : (
				<button
					type="button"
					className={`worktree-chip worktree-chip--pr worktree-chip--pr-${pullRequest.state}`}
					aria-label={pullRequestAccessibleName(pullRequest)}
					title={pullRequestTitle(pullRequest)}
					onClick={(event) => {
						event.stopPropagation();
						void openExternalUrl(pullRequest.url);
					}}
				>
					<PullRequestIcon size={12} aria-hidden="true" />#{pullRequest.number}
				</button>
			)}
			{checks === undefined || checks.total === 0 ? null : (
				<button
					type="button"
					className={`worktree-chip worktree-chip--checks worktree-chip--${checksTone(checks)}`}
					aria-label={checksAccessibleName(checks)}
					aria-haspopup="menu"
					aria-expanded={menu !== null}
					title={checksAccessibleName(checks).replace(/\. Show checks$/, '')}
					onClick={(event) => {
						event.stopPropagation();
						const rect = event.currentTarget.getBoundingClientRect();
						void showChecks({ x: rect.left, y: rect.bottom + 4 });
					}}
				>
					{checks.failed > 0 ? (
						<span className="worktree-chip__count worktree-chip__count--failed">
							<CircleX size={12} aria-hidden="true" />
							{checks.failed}
						</span>
					) : null}
					{checks.passed > 0 ? (
						<span className="worktree-chip__count worktree-chip__count--passed">
							<CircleCheck size={12} aria-hidden="true" />
							{checks.passed}
						</span>
					) : null}
					{checks.pending > 0 ? (
						<span className="worktree-chip__count worktree-chip__count--pending">
							<CircleDashed size={12} aria-hidden="true" />
							{checks.pending}
						</span>
					) : null}
				</button>
			)}
			{menu ? (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					items={menu.items}
					onClose={() => setMenu(null)}
				/>
			) : null}
		</div>
	);
}
