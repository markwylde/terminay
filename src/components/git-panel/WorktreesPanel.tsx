import {
	ChevronDown,
	CircleCheck,
	CircleDashed,
	CircleX,
	Copy,
	Download,
	EllipsisVertical,
	FileEdit,
	FolderGit,
	FolderInput,
	FolderOpen,
	GitBranch,
	GitPullRequest,
	MinusCircle,
	Terminal,
	Trash2,
	Upload,
} from 'lucide-react';
import { type JSX, type MouseEvent, useEffect, useRef, useState } from 'react';
import { openExternalUrl, writeClipboardText } from '../../host/nativeActions';
import type {
	GitChangeEntry,
	GitWorktreeStatus,
	WorktreeCheckState,
	WorktreePanelStatus,
	WorktreeProperties,
} from '../../types/terminay';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { GitPanel } from './GitPanel';
import {
	checksAccessibleName,
	checksTone,
	hasWorktreeProperties,
	orderedCheckItems,
	pullRequestAccessibleName,
	pullRequestTitle,
} from './worktreePropertyPresentation';
import {
	type WorktreeSignInChoice,
	WorktreeSignInDialog,
} from './WorktreeSignInDialog';
import { getPathRelativeToRoot } from '../../pathUtils';
import { isWorktreeShownClean } from '../../workspace/cleanWorktreeSweep';
import './gitPanel.css';

type WorktreeChecks = NonNullable<WorktreeProperties['checks']>;

export type WorktreesPanelProps = {
	activePushMenuWorktreePath?: string | null;
	deletingWorktreePaths?: ReadonlySet<string>;
	pullingWorktreePaths?: ReadonlySet<string>;
	status: WorktreePanelStatus | null;
	viewMode: 'list' | 'tree';
	onDeleteWorktree: (worktree: GitWorktreeStatus) => void;
	onDeletePath: (path: string) => void;
	onNewFile: (path: string) => void;
	onNewFolder: (path: string) => void;
	onOpenEntry: (entry: GitChangeEntry) => void;
	onOpenFolder: (path: string, worktreeRoot: string) => void;
	onOpenPushMenu: (
		worktree: GitWorktreeStatus,
		anchor: { x: number; y: number },
	) => void;
	onOpenTerminal: (worktree: GitWorktreeStatus) => void;
	onOpenTerminalAtPath: (path: string) => void;
	onPullFromOrigin: (worktree: GitWorktreeStatus) => void;
	onRenameWorktree: (worktree: GitWorktreeStatus) => void;
	onRenamePath: (path: string) => void;
	onRevealWorktree: (worktree: GitWorktreeStatus) => void;
	onSwitchProjectRoot: (worktree: GitWorktreeStatus) => void;
	/** Every check item for one worktree; listings carry only the counts. */
	onLoadWorktreeChecks?: (
		worktree: GitWorktreeStatus,
	) => Promise<WorktreeProperties['checks'] | undefined>;
	/** The user's answer to a forge sign-in prompt. */
	onRespondSignIn?: (
		choice: WorktreeSignInChoice,
		token?: string,
	) => Promise<void>;
};

function getWorktreeTitle(worktree: GitWorktreeStatus): string {
	const parts = [worktree.path];
	if (worktree.branch) {
		parts.push(`Branch: ${worktree.branch}`);
	}
	if (worktree.head) {
		parts.push(`HEAD: ${worktree.head.slice(0, 12)}`);
	}
	if (worktree.aheadOfMainCount !== null) {
		parts.push(
			worktree.aheadOfMainCount > 0
				? `${worktree.aheadOfMainCount} commit${worktree.aheadOfMainCount === 1 ? '' : 's'} ahead of main`
				: 'No commits ahead of main',
		);
	}
	if (worktree.entries.length > 0) {
		parts.push(
			`${worktree.entries.length} file change${worktree.entries.length === 1 ? '' : 's'}`,
		);
	}
	if (worktree.lineAdditions !== null || worktree.lineDeletions !== null) {
		parts.push(
			`+${worktree.lineAdditions ?? 0} -${worktree.lineDeletions ?? 0}`,
		);
	}
	if (worktree.lastChangedAt) {
		parts.push(`Last changed: ${formatWorktreeDate(worktree.lastChangedAt)}`);
	}
	return parts.join('\n');
}

function formatWorktreeDate(value: string | null): string {
	if (!value) {
		return 'No changes';
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return 'Unknown date';
	}

	return new Intl.DateTimeFormat(undefined, {
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		month: 'short',
	}).format(date);
}

export function WorktreesPanel(props: WorktreesPanelProps): JSX.Element {
	const {
		activePushMenuWorktreePath,
		deletingWorktreePaths,
		pullingWorktreePaths,
		status,
		viewMode,
		onDeletePath,
		onDeleteWorktree,
		onNewFile,
		onNewFolder,
		onOpenEntry,
		onOpenFolder,
		onOpenPushMenu,
		onOpenTerminal,
		onOpenTerminalAtPath,
		onPullFromOrigin,
		onRenamePath,
		onRenameWorktree,
		onRevealWorktree,
		onSwitchProjectRoot,
		onLoadWorktreeChecks,
		onRespondSignIn,
	} = props;
	const initializedWorktreesRef = useRef<Set<string>>(new Set());
	const [collapsedWorktrees, setCollapsedWorktrees] = useState<Set<string>>(
		() => new Set(),
	);
	/** Worktrees whose checks list is shown; independent of their files. */
	const [openChecks, setOpenChecks] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const toggleChecks = (worktreePath: string) => {
		setOpenChecks((prev) => {
			const next = new Set(prev);
			if (next.has(worktreePath)) next.delete(worktreePath);
			else next.add(worktreePath);
			return next;
		});
	};
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		worktree: GitWorktreeStatus;
	} | null>(null);
	const worktreePathSignature =
		status?.repoRoot == null
			? ''
			: status.worktrees.map((worktree) => worktree.path).join('\n');

	useEffect(() => {
		if (!status?.repoRoot) {
			initializedWorktreesRef.current = new Set();
			setCollapsedWorktrees(new Set());
			return;
		}

		const currentPaths = new Set(
			status.worktrees.map((worktree) => worktree.path),
		);
		setCollapsedWorktrees((prev) => {
			const next = new Set(
				Array.from(prev).filter((worktreePath) =>
					currentPaths.has(worktreePath),
				),
			);

			for (const worktreePath of currentPaths) {
				if (!initializedWorktreesRef.current.has(worktreePath)) {
					next.add(worktreePath);
				}
			}

			return next;
		});
		initializedWorktreesRef.current = currentPaths;
	}, [status?.repoRoot, worktreePathSignature]);

	const toggleWorktree = (worktreePath: string) => {
		setCollapsedWorktrees((prev) => {
			const next = new Set(prev);
			if (next.has(worktreePath)) {
				next.delete(worktreePath);
			} else {
				next.add(worktreePath);
			}
			return next;
		});
	};

	const openContextMenu = (
		event: MouseEvent<HTMLElement>,
		worktree: GitWorktreeStatus,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setContextMenu({
			x: event.clientX,
			y: event.clientY,
			worktree,
		});
	};

	if (status === null) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Loading…</div>
			</div>
		);
	}

	if (!status.gitAvailable) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Git is not available</div>
			</div>
		);
	}

	if (!status.repoRoot) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">Not a git repository</div>
			</div>
		);
	}

	if (status.worktrees.length === 0) {
		return (
			<div className="worktrees-panel">
				<div className="git-panel__message">No worktrees</div>
			</div>
		);
	}

	const showForgeColumns = status.worktrees.some((worktree) =>
		hasWorktreeProperties(worktree.properties),
	);
	const columnsClass = showForgeColumns
		? ' worktrees-panel--forge-columns'
		: '';

	return (
		<div
			className={`worktrees-panel worktrees-panel--table${columnsClass}`}
		>
			{status.worktrees.map((worktree) => {
				const isDeleting = deletingWorktreePaths?.has(worktree.path) ?? false;
				const isPulling = pullingWorktreePaths?.has(worktree.path) ?? false;
				const collapsed = collapsedWorktrees.has(worktree.path);
				const hasUnmergedOrUncommittedWork =
					!isDeleting &&
					(worktree.isDirtyBranch || worktree.entries.length > 0);
				const hasLineChanges =
					!isDeleting &&
					((worktree.lineAdditions ?? 0) > 0 ||
						(worktree.lineDeletions ?? 0) > 0);
				const WorktreeIcon = worktree.isMain ? FolderGit : GitBranch;
				const menuOpen =
					activePushMenuWorktreePath === worktree.path ||
					contextMenu?.worktree.path === worktree.path;
				const pullRequest = worktree.properties?.pullRequest;
				const checks = worktree.properties?.checks;
				const checksOpen = openChecks.has(worktree.path);
				const worktreeStatus = {
					gitAvailable: status.gitAvailable,
					repoRoot: worktree.path,
					branch: worktree.branch,
					entries: worktree.entries,
				};

				return (
					<section
						key={worktree.path}
						className={`worktrees-panel__worktree${
							isDeleting ? ' worktrees-panel__worktree--deleting' : ''
						}${isPulling ? ' worktrees-panel__worktree--pulling' : ''}`}
						aria-busy={isDeleting || isPulling}
					>
						<div
							className={[
								'worktrees-panel__worktree-header',
								collapsed ? 'worktrees-panel__worktree-header--collapsed' : '',
								worktree.isCurrent
									? 'worktrees-panel__worktree-header--current'
									: '',
								hasUnmergedOrUncommittedWork
									? 'worktrees-panel__worktree-header--dirty'
									: '',
							]
								.filter(Boolean)
								.join(' ')}
							onContextMenu={(event) => {
								if (isDeleting) {
									event.preventDefault();
									event.stopPropagation();
									return;
								}
								openContextMenu(event, worktree);
							}}
							title={
								isDeleting
									? `${worktree.path}\nDeleting…`
									: isPulling
										? `${worktree.path}\nPulling…`
										: getWorktreeTitle(worktree)
							}
						>
							<button
								type="button"
								className="worktrees-panel__worktree-toggle"
								disabled={isDeleting}
								onClick={() => toggleWorktree(worktree.path)}
								aria-expanded={!collapsed}
							>
								<span
									className={`git-panel__folder-chevron${
										collapsed ? ' git-panel__folder-chevron--collapsed' : ''
									}`}
									aria-hidden="true"
								>
									<ChevronDown size={14} aria-hidden />
								</span>
								<span
									className={`worktrees-panel__worktree-icon${
										hasUnmergedOrUncommittedWork
											? ' worktrees-panel__worktree-icon--dirty'
											: ''
									}${
										worktree.isCurrent
											? ' worktrees-panel__worktree-icon--current'
											: ''
									}`}
									aria-hidden="true"
								>
									<WorktreeIcon size={14} aria-hidden />
								</span>
								<span className="worktrees-panel__worktree-name">
									{worktree.name}
								</span>
							</button>
							<button
								type="button"
								className={`worktrees-panel__row-menu${
									menuOpen ? ' worktrees-panel__row-menu--active' : ''
								}`}
								disabled={isDeleting}
								onClick={(event) => {
									event.stopPropagation();
									const rect = event.currentTarget.getBoundingClientRect();
									setContextMenu({
										x: rect.left,
										y: rect.bottom + 4,
										worktree,
									});
								}}
								aria-label={`Actions for ${worktree.name}`}
								aria-haspopup="menu"
								aria-expanded={menuOpen}
								title="Worktree actions"
							>
								<EllipsisVertical size={14} aria-hidden="true" />
							</button>
							{/* Second line: change size, pull request, and checks in fixed slots
							    so they line up from row to row. Clicking its gaps toggles too. */}
							<div
								className="worktrees-panel__metrics"
								onClick={(event) => {
									if (event.target === event.currentTarget)
										toggleWorktree(worktree.path);
								}}
							>
								<span className="worktrees-panel__cell worktrees-panel__cell--delta">
									{isDeleting ? (
										<span className="worktrees-panel__deleting">deleting…</span>
									) : isPulling ? (
										<span className="worktrees-panel__pulling">pulling…</span>
									) : hasLineChanges ? (
										<>
											<span className="worktrees-panel__delta worktrees-panel__delta--additions">
												+{formatCount(worktree.lineAdditions ?? 0)}
											</span>
											<span className="worktrees-panel__delta worktrees-panel__delta--deletions">
												−{formatCount(worktree.lineDeletions ?? 0)}
											</span>
										</>
									) : !isWorktreeShownClean(worktree) ? (
										<span className="worktrees-panel__changed">changed</span>
									) : (
										<span className="worktrees-panel__clean">clean</span>
									)}
								</span>
								{showForgeColumns ? (
									<>
										<span className="worktrees-panel__cell worktrees-panel__cell--pr">
											{pullRequest === undefined ? (
												<span />
											) : (
												<button
													type="button"
													className={`worktrees-panel__pr worktrees-panel__pr--${pullRequest.state}`}
													aria-label={pullRequestAccessibleName(pullRequest)}
													title={pullRequestTitle(pullRequest)}
													onClick={() => void openExternalUrl(pullRequest.url)}
												>
													#{pullRequest.number}
												</button>
											)}
										</span>
										<span className="worktrees-panel__cell worktrees-panel__cell--ci">
											{checks === undefined || checks.total === 0 ? (
												<span />
											) : (
												<button
													type="button"
													className={`worktrees-panel__ci worktrees-panel__ci--${checksTone(checks)}`}
													aria-label={checksAccessibleName(checks)}
													aria-expanded={checksOpen}
													title={checksAccessibleName(checks).replace(
														/\. Show checks$/,
														'',
													)}
													onClick={() => toggleChecks(worktree.path)}
												>
													<ChecksRing checks={checks} />
													{checksHeadline(checks)}
												</button>
											)}
										</span>
									</>
								) : null}
							</div>
						</div>
						{isDeleting || !checksOpen ? null : (
							<div className="worktrees-panel__detail">
								<WorktreeDetailSummary
									worktree={worktree}
									onLoadChecks={onLoadWorktreeChecks}
								/>
							</div>
						)}
						{isDeleting || collapsed ? null : worktree.errorMessage ? (
							<div className="git-panel__message">{worktree.errorMessage}</div>
						) : worktree.isBare ? (
							<div className="git-panel__message">Bare worktree</div>
						) : worktree.isPrunable ? (
							<div className="git-panel__message">Prunable worktree</div>
						) : (
							<div className="worktrees-panel__changes">
								<GitPanel
									status={worktreeStatus}
									viewMode={viewMode}
									onDelete={onDeletePath}
									onNewFile={onNewFile}
									onNewFolder={onNewFolder}
									onOpenEntry={onOpenEntry}
									onOpenFolder={(path) => onOpenFolder(path, worktree.path)}
									onOpenTerminal={onOpenTerminalAtPath}
									onRename={onRenamePath}
								/>
							</div>
						)}
					</section>
				);
			})}
			{status.signIn && onRespondSignIn ? (
				<WorktreeSignInDialog
					key={status.signIn.origin}
					prompt={status.signIn}
					onRespond={onRespondSignIn}
				/>
			) : null}
			{contextMenu ? (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={buildWorktreeContextMenuItems({
						isPulling:
							pullingWorktreePaths?.has(contextMenu.worktree.path) ?? false,
						onCommitAndPush: () =>
							onOpenPushMenu(contextMenu.worktree, {
								x: contextMenu.x,
								y: contextMenu.y,
							}),
						onDeleteWorktree,
						onOpenTerminal,
						onPullFromOrigin,
						onRenameWorktree,
						...(status.revealAvailable === true ? { onRevealWorktree } : {}),
						onSwitchProjectRoot,
						rootPath: status.repoRoot,
						worktree: contextMenu.worktree,
					})}
				/>
			) : null}
		</div>
	);
}

function formatCount(value: number): string {
	if (value < 1_000) return String(value);
	return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
}

/** The number a CI cell shows: failures first, then running, then passed. */
function checksHeadline(checks: WorktreeChecks): number {
	return checks.failed || checks.pending || checks.passed;
}

/** Failed, running, and passed checks as proportional arcs of one ring. */
function ChecksRing({ checks }: { checks: WorktreeChecks }): JSX.Element {
	const radius = 5;
	const circumference = 2 * Math.PI * radius;
	let offset = 0;
	const segments = (
		[
			['failed', checks.failed],
			['pending', checks.pending],
			['passed', checks.passed],
		] as const
	).flatMap(([state, count]) => {
		if (count === 0 || checks.total === 0) return [];
		const length = (circumference * count) / checks.total;
		const segment = (
			<circle
				key={state}
				className={`worktrees-panel__ring-segment worktrees-panel__ring-segment--${state}`}
				r={radius}
				cx={7}
				cy={7}
				strokeDasharray={`${length} ${circumference - length}`}
				strokeDashoffset={-offset}
				transform="rotate(-90 7 7)"
			/>
		);
		offset += length;
		return [segment];
	});
	return (
		<svg
			className="worktrees-panel__ring"
			viewBox="0 0 14 14"
			width={14}
			height={14}
			aria-hidden="true"
		>
			<circle className="worktrees-panel__ring-track" r={radius} cx={7} cy={7} />
			{segments}
		</svg>
	);
}

const CHECK_ICONS: Readonly<Record<WorktreeCheckState, typeof CircleX>> = {
	failed: CircleX,
	pending: CircleDashed,
	passed: CircleCheck,
	skipped: MinusCircle,
};

/** Checks listed before the rest are collapsed into a "+ N passed" line. */
const DETAIL_CHECK_LIMIT = 6;

/** Branch, pull request, and checks at the top of an expanded row. */
function WorktreeDetailSummary({
	worktree,
	onLoadChecks,
}: {
	worktree: GitWorktreeStatus;
	onLoadChecks?: WorktreesPanelProps['onLoadWorktreeChecks'];
}): JSX.Element | null {
	const summary = worktree.properties?.checks;
	const [loaded, setLoaded] = useState<WorktreeChecks | undefined>(undefined);
	const countsKey =
		summary === undefined
			? ''
			: `${summary.failed}/${summary.pending}/${summary.passed}/${summary.skipped}`;
	// The counts identify a change worth refetching; the worktree object is
	// recreated on every listing.
	useEffect(() => {
		if (summary === undefined || onLoadChecks === undefined) return;
		let cancelled = false;
		void onLoadChecks(worktree)
			.then((checks) => {
				if (!cancelled) setLoaded(checks);
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [countsKey, worktree.path, onLoadChecks]);
	const pullRequest = worktree.properties?.pullRequest;
	const checks = loaded ?? summary;
	if (worktree.branch === null && pullRequest === undefined && !checks)
		return null;
	const items = checks === undefined ? [] : orderedCheckItems(checks);
	// Everything that needs attention is listed; passes fill what room is left.
	const attention = items.filter((item) => item.state !== 'passed');
	const passed = items.filter((item) => item.state === 'passed');
	const shown = [
		...attention,
		...passed.slice(0, Math.max(0, DETAIL_CHECK_LIMIT - attention.length)),
	];
	const hidden = checks === undefined ? 0 : checks.total - shown.length;
	return (
		<div className="worktrees-panel__summary">
			{worktree.branch === null ? null : (
				<div className="worktrees-panel__summary-line worktrees-panel__summary-branch">
					{worktree.branch}
				</div>
			)}
			{pullRequest === undefined ? null : (
				<button
					type="button"
					className="worktrees-panel__summary-line worktrees-panel__summary-link"
					onClick={() => void openExternalUrl(pullRequest.url)}
					title={pullRequestTitle(pullRequest)}
				>
					<GitPullRequest
						size={12}
						aria-hidden="true"
						className={`worktrees-panel__pr--${pullRequest.state}`}
					/>
					<span>{pullRequest.title}</span>
				</button>
			)}
			{shown.map((item) => {
				const Icon = CHECK_ICONS[item.state];
				const content = (
					<>
						<Icon
							size={12}
							aria-label={item.state}
							className={`worktrees-panel__check-icon--${item.state}`}
						/>
						<span>{item.name}</span>
					</>
				);
				return item.url === undefined ? (
					<div key={item.name} className="worktrees-panel__summary-line">
						{content}
					</div>
				) : (
					<button
						key={item.name}
						type="button"
						className="worktrees-panel__summary-line worktrees-panel__summary-link"
						onClick={() => void openExternalUrl(item.url as string)}
					>
						{content}
					</button>
				);
			})}
			{hidden > 0 ? (
				<div className="worktrees-panel__summary-line worktrees-panel__summary-more">
					+ {hidden} more
				</div>
			) : null}
		</div>
	);
}

export function buildWorktreeContextMenuItems(options: {
	isPulling?: boolean;
	onCommitAndPush?: () => void;
	onDeleteWorktree: (worktree: GitWorktreeStatus) => void;
	onOpenTerminal: (worktree: GitWorktreeStatus) => void;
	onPullFromOrigin: (worktree: GitWorktreeStatus) => void;
	onRenameWorktree: (worktree: GitWorktreeStatus) => void;
	/** Omitted when the server cannot reveal for this client. */
	onRevealWorktree?: (worktree: GitWorktreeStatus) => void;
	onSwitchProjectRoot: (worktree: GitWorktreeStatus) => void;
	rootPath: string;
	worktree: GitWorktreeStatus;
}): ContextMenuItem[] {
	const {
		isPulling = false,
		onCommitAndPush,
		onDeleteWorktree,
		onOpenTerminal,
		onPullFromOrigin,
		onRenameWorktree,
		onRevealWorktree,
		onSwitchProjectRoot,
		rootPath,
		worktree,
	} = options;
	const unavailable = worktree.isBare || worktree.isPrunable;
	const cannotMoveOrRemove =
		worktree.isCurrent || worktree.isMain || worktree.isBare;

	const pushUnavailable =
		worktree.isBare || worktree.isPrunable || !!worktree.errorMessage;
	return [
		...(onCommitAndPush === undefined
			? []
			: [
					{
						label: 'Commit & push with AI…',
						icon: <Upload size={14} />,
						disabled: pushUnavailable,
						onClick: onCommitAndPush,
					},
					{ separator: true, label: '', onClick: () => {} },
				]),
		{
			label: isPulling ? 'Pulling from origin…' : 'Pull from origin',
			icon: <Download size={14} />,
			disabled:
				isPulling ||
				unavailable ||
				worktree.isDetached ||
				!worktree.branch ||
				!!worktree.errorMessage,
			onClick: () => onPullFromOrigin(worktree),
		},
		{
			label: 'Switch project root',
			icon: <FolderInput size={14} />,
			disabled: worktree.isCurrent || unavailable,
			onClick: () => onSwitchProjectRoot(worktree),
		},
		{
			label: 'Rename worktree',
			icon: <FileEdit size={14} />,
			disabled: cannotMoveOrRemove || worktree.isPrunable,
			onClick: () => onRenameWorktree(worktree),
		},
		{
			label: 'Delete worktree',
			icon: <Trash2 size={14} />,
			danger: true,
			disabled: cannotMoveOrRemove,
			onClick: () => onDeleteWorktree(worktree),
		},
		{ separator: true, label: '', onClick: () => {} },
		{
			label: 'Copy path',
			icon: <Copy size={14} />,
			disabled: unavailable,
			onClick: () => void writeClipboardText(worktree.path),
		},
		{
			label: 'Copy relative path',
			icon: <Copy size={14} />,
			disabled: unavailable,
			onClick: () =>
				void writeClipboardText(
					getPathRelativeToRoot(worktree.path, rootPath),
				),
		},
		{ separator: true, label: '', onClick: () => {} },
		{
			label: 'Open shell in folder',
			icon: <Terminal size={14} />,
			disabled: unavailable,
			onClick: () => onOpenTerminal(worktree),
		},
		...(onRevealWorktree === undefined
			? []
			: [
					{
						label: 'Reveal in OS',
						icon: <FolderOpen size={14} />,
						disabled: unavailable,
						onClick: () => onRevealWorktree(worktree),
					},
				]),
	];
}
