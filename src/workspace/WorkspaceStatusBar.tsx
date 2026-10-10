import type { DockviewApi, IDockviewPanel } from 'dockview';
import { Folder, GitBranch, Monitor, Smartphone, Tablet } from 'lucide-react';
import { type Ref, useCallback, useEffect, useRef, useState } from 'react';
import { LiveTerminalTitle } from '../shared/useWorkspaceProjection';
import {
	firstChangedSegmentIndex,
	findContainingWorktree,
	formatStatusBarFileSize,
	inferHomeDirectory,
	type RemoteDeviceKind,
	type RemoteIndicatorState,
	splitStatusBarPath,
	type StatusBarBranch,
	type StatusBarLayoutCell,
	type StatusBarWorktree,
	statusBarBranch,
	statusBarBreadcrumb,
	statusBarLayoutCells,
} from './workspaceStatusBarModel';

/** After Enter, the shell usually finishes a `cd` or `git switch` quickly;
 * the later one-shot catches slower commands. Both are one-shot timeouts
 * after an observed event, never a poll (ADR-0028). */
const CWD_SETTLE_DELAYS_MS = [300, 1_500] as const;

type WorkspaceStatusBarProps = {
	remote: RemoteIndicatorState;
	onToggleConnectionMenu: () => void;
	/** The active project renders its focused-terminal summary into this slot. */
	slotRef: Ref<HTMLDivElement>;
};

const DEVICE_ICONS: Record<RemoteDeviceKind, typeof Smartphone> = {
	computer: Monitor,
	phone: Smartphone,
	tablet: Tablet,
};

export function WorkspaceStatusBar({
	onToggleConnectionMenu,
	remote,
	slotRef,
}: WorkspaceStatusBarProps) {
	return (
		<footer className="workspace-status-bar" data-testid="workspace-status-bar">
			<div className="workspace-status-bar__focused" ref={slotRef} />
			<button
				aria-label={remote.accessibleLabel}
				className={`workspace-status-bar__remote workspace-status-bar__remote--${remote.tone}`}
				onClick={onToggleConnectionMenu}
				// The connection menu closes on an outside mousedown. Keep this
				// button's own mousedown from reaching that listener so a click
				// toggles the menu instead of closing and reopening it.
				onMouseDown={(event) => event.stopPropagation()}
				title={remote.accessibleLabel}
				type="button"
			>
				{remote.devices.length > 0 ? (
					<span className="workspace-status-bar__devices" aria-hidden="true">
						{remote.devices.map((kind, index) => {
							const Icon = DEVICE_ICONS[kind];
							return <Icon key={index} size={13} strokeWidth={2} />;
						})}
					</span>
				) : null}
				{remote.label ? <span className="workspace-status-bar__remote-label">{remote.label}</span> : null}
				<span className="workspace-status-bar__dot" aria-hidden="true" />
			</button>
		</footer>
	);
}

export type FocusedTerminalStatus = {
	sessionId: string;
	panelId: string;
	/** The title the bar was built with; the text shown follows the terminal. */
	title: string;
	layout: StatusBarLayoutCell[];
	/** Null until the server has observed the live working directory. */
	cwd: string | null;
};

type FocusedTerminalSummaryProps = {
	status: FocusedTerminalStatus;
	worktrees: readonly StatusBarWorktree[];
};

function LayoutMiniature({ cells }: Readonly<{ cells: StatusBarLayoutCell[] }>) {
	return (
		<span className="workspace-status-bar__layout" aria-hidden="true">
			{cells.map((cell, index) => (
				<i
					className={cell.isFocused ? 'is-focused' : undefined}
					key={index}
					style={{
						left: `${cell.x * 100}%`,
						top: `${cell.y * 100}%`,
						width: `${cell.width * 100}%`,
						height: `${cell.height * 100}%`,
					}}
				/>
			))}
		</span>
	);
}

function BranchChip({ branch }: Readonly<{ branch: StatusBarBranch }>) {
	return (
		<span className="workspace-status-bar__branch" title={branch.name}>
			<GitBranch aria-hidden="true" size={12} strokeWidth={2} />
			<span className="workspace-status-bar__branch-name">{branch.name}</span>
			{branch.uncommittedCount > 0 ? (
				<span
					className="workspace-status-bar__git-count workspace-status-bar__git-count--dirty"
					title={`${branch.uncommittedCount} uncommitted changes`}
				>
					●{branch.uncommittedCount}
				</span>
			) : null}
			{branch.aheadCount > 0 ? (
				<span
					className="workspace-status-bar__git-count workspace-status-bar__git-count--ahead"
					title={`${branch.aheadCount} commits ahead of the default branch`}
				>
					↑{branch.aheadCount}
				</span>
			) : null}
		</span>
	);
}

type PathBreadcrumbProps = {
	/** Remounts the crumbs, and so replays the entry animation, when it changes. */
	identity: string;
	path: string;
};

function PathBreadcrumb({ identity, path }: Readonly<PathBreadcrumbProps>) {
	const homePath = inferHomeDirectory(path);
	const segments = splitStatusBarPath(path, homePath);
	// The previously shown path decides which segments are new. It is kept in a
	// ref so re-renders for unrelated reasons do not replay the animation.
	const shownRef = useRef<{ key: string; firstChanged: number; segments: string[] | null }>({
		key: '',
		firstChanged: Number.POSITIVE_INFINITY,
		segments: null,
	});
	const key = segments.join('\u0000');
	if (shownRef.current.key !== key) {
		shownRef.current = {
			key,
			firstChanged: firstChangedSegmentIndex(shownRef.current.segments, segments),
			segments,
		};
	}
	const firstChanged = shownRef.current.firstChanged;
	const crumbs = statusBarBreadcrumb(path, homePath);
	let delay = 0;

	return (
		<span className="workspace-status-bar__path" title={path}>
			<Folder aria-hidden="true" size={12} strokeWidth={2} />
			<span className="workspace-status-bar__crumbs" key={`${identity}:${key}`}>
				{crumbs.map((crumb, position) => {
					const isNew = crumb.index >= firstChanged;
					const style = isNew
						? { animationDelay: `${(delay++) * 45}ms` }
						: undefined;
					return (
						<span className="workspace-status-bar__crumb-wrap" key={`${crumb.index}:${crumb.label}`}>
							{position > 0 ? (
								<span className="workspace-status-bar__sep" aria-hidden="true">
									/
								</span>
							) : null}
							<span
								className={[
									'workspace-status-bar__crumb',
									position === crumbs.length - 1 ? 'is-last' : '',
									isNew ? 'is-new' : '',
								]
									.filter(Boolean)
									.join(' ')}
								style={style}
								title={crumb.path ?? undefined}
							>
								{crumb.label}
							</span>
						</span>
					);
				})}
			</span>
		</span>
	);
}

/** Rendered by the active project into the status bar slot. */
export function FocusedTerminalSummary({
	status,
	worktrees,
}: FocusedTerminalSummaryProps) {
	const worktree =
		status.cwd === null ? null : findContainingWorktree(status.cwd, worktrees);
	const branch = statusBarBranch(worktree);

	return (
		<>
			<span className="workspace-status-bar__tab">
				<LayoutMiniature cells={status.layout} />
				<span className="workspace-status-bar__tab-title">
					<LiveTerminalTitle panelId={status.panelId} fallback={status.title} />
				</span>
			</span>
			{status.cwd === null ? null : (
				<PathBreadcrumb identity={status.sessionId} path={status.cwd} />
			)}
			{/* Branches are known only for the project's own worktrees. Outside
			    them the directory may still be a repository, so say nothing
			    rather than claim it is not one. */}
			{branch === null ? null : <BranchChip branch={branch} />}
		</>
	);
}

export type FocusedFileStatus = {
	panelId: string;
	title: string;
	layout: StatusBarLayoutCell[];
	path: string;
	/** Null until the server has described the file. */
	size: number | null;
	isDirty: boolean;
};

type FocusedFileSummaryProps = {
	status: FocusedFileStatus;
	worktrees: readonly StatusBarWorktree[];
};

/** Rendered into the status bar slot while a file panel holds focus. */
export function FocusedFileSummary({ status, worktrees }: FocusedFileSummaryProps) {
	const separator = Math.max(status.path.lastIndexOf('/'), status.path.lastIndexOf('\\'));
	const directory = separator > 0 ? status.path.slice(0, separator) : status.path;
	const branch = statusBarBranch(findContainingWorktree(directory, worktrees));

	return (
		<>
			<span className="workspace-status-bar__tab" data-testid="workspace-status-bar-file">
				<LayoutMiniature cells={status.layout} />
				<span className="workspace-status-bar__tab-title">{status.title}</span>
			</span>
			<PathBreadcrumb identity={status.panelId} path={directory} />
			{branch === null ? null : <BranchChip branch={branch} />}
			{status.size === null ? null : (
				<span
					className="workspace-status-bar__file-size"
					title={`${status.size.toLocaleString()} bytes`}
				>
					{formatStatusBarFileSize(status.size)}
				</span>
			)}
			{status.isDirty ? (
				<span className="workspace-status-bar__file-unsaved">Unsaved</span>
			) : null}
		</>
	);
}

type UseFocusedTerminalStatusOptions = {
	apiRef: { readonly current: DockviewApi | null };
	isDockviewReady: boolean;
	isActive: boolean;
	focusedSessionId: string | null;
	getCwd: (sessionId: string) => Promise<string | null>;
};

function readLayout(api: DockviewApi, isFocusedPanel: (panel: IDockviewPanel) => boolean): {
	panelId: string;
	title: string;
	layout: StatusBarLayoutCell[];
} | null {
	let focused: { panelId: string; title: string } | null = null;
	const rects = api.groups.map((group) => {
		const holdsFocus = group.panels.some((panel) => {
			const matches = isFocusedPanel(panel);
			if (matches) focused = { panelId: panel.id, title: panel.title ?? panel.id };
			return matches;
		});
		const rect = group.element.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			width: rect.width,
			height: rect.height,
			isFocused: holdsFocus,
		};
	});
	if (focused === null) return null;
	return {
		...(focused as { panelId: string; title: string }),
		layout: statusBarLayoutCells(rects),
	};
}

/** The focused terminal's title, split layout and live working directory.
 * The cwd is fetched on demand — on focus, window focus and after Enter —
 * because the server has no cwd watch and a timer would be a poll. */
export function useFocusedTerminalStatus({
	apiRef,
	focusedSessionId,
	getCwd,
	isActive,
	isDockviewReady,
}: UseFocusedTerminalStatusOptions): FocusedTerminalStatus | null {
	const [layoutState, setLayoutState] = useState<{
		sessionId: string;
		panelId: string;
		title: string;
		layout: StatusBarLayoutCell[];
	} | null>(null);
	// Last known cwd per session, so returning to a terminal shows where it
	// was while the fresh answer is on its way.
	const [cwdBySession, setCwdBySession] = useState<
		Readonly<Record<string, string | null>>
	>({});
	const focusedRef = useRef(focusedSessionId);
	focusedRef.current = focusedSessionId;

	const recomputeLayout = useCallback(() => {
		const api = apiRef.current;
		const sessionId = focusedRef.current;
		if (api === null || sessionId === null) {
			setLayoutState(null);
			return;
		}
		const read = readLayout(
			api,
			(panel) =>
				(panel.params as { sessionId?: unknown } | undefined)?.sessionId ===
				sessionId,
		);
		const next = read === null ? null : { sessionId, ...read };
		// Dockview reports layout changes for every sash drag and resize; only
		// re-render the workspace when what the bar shows actually changed.
		setLayoutState((current) =>
			JSON.stringify(current) === JSON.stringify(next) ? current : next,
		);
	}, [apiRef]);

	const refreshCwd = useCallback(() => {
		const sessionId = focusedRef.current;
		if (sessionId === null) return;
		void getCwd(sessionId)
			.then((cwd) => {
				if (focusedRef.current !== sessionId) return;
				setCwdBySession((current) =>
					current[sessionId] === cwd ? current : { ...current, [sessionId]: cwd },
				);
			})
			.catch(() => {
				// An unobservable cwd leaves the breadcrumb as it was; the next
				// focus or input settle asks again.
			});
	}, [getCwd]);

	useEffect(() => {
		if (!isActive || !isDockviewReady) return;
		const api = apiRef.current;
		if (api === null) return;
		const schedule = () => window.requestAnimationFrame(recomputeLayout);
		const disposables = [
			api.onDidLayoutChange(schedule),
			api.onDidActiveGroupChange(schedule),
			api.onDidActivePanelChange(schedule),
			api.onDidAddPanel(schedule),
			api.onDidRemovePanel(schedule),
			api.onDidMovePanel(schedule),
		];
		schedule();
		return () => {
			for (const disposable of disposables) disposable.dispose();
		};
	}, [apiRef, isActive, isDockviewReady, recomputeLayout]);

	useEffect(() => {
		if (!isActive) return;
		recomputeLayout();
		refreshCwd();
	}, [focusedSessionId, isActive, recomputeLayout, refreshCwd]);

	useEffect(() => {
		if (!isActive) return;
		const timers = new Set<number>();
		const clearTimers = () => {
			for (const timer of timers) window.clearTimeout(timer);
			timers.clear();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' || event.isComposing) return;
			clearTimers();
			for (const delay of CWD_SETTLE_DELAYS_MS) {
				const timer = window.setTimeout(() => {
					timers.delete(timer);
					refreshCwd();
				}, delay);
				timers.add(timer);
			}
		};
		window.addEventListener('keydown', onKeyDown, true);
		window.addEventListener('focus', refreshCwd);
		return () => {
			clearTimers();
			window.removeEventListener('keydown', onKeyDown, true);
			window.removeEventListener('focus', refreshCwd);
		};
	}, [isActive, refreshCwd]);

	if (layoutState === null || layoutState.sessionId !== focusedSessionId) return null;
	return {
		...layoutState,
		cwd: cwdBySession[layoutState.sessionId] ?? null,
	};
}

type FilePanelStatusParams = {
	filePath?: unknown;
	fileInfo?: { size?: unknown };
	isDirty?: unknown;
};

type UseFocusedFileStatusOptions = {
	apiRef: { readonly current: DockviewApi | null };
	isDockviewReady: boolean;
	isActive: boolean;
};

/** The focused file panel's title, split layout, path, size and draft state,
 * or null while the active panel is not a file. Everything is read from the
 * panel's own parameters, which the file panel already keeps current. */
export function useFocusedFileStatus({
	apiRef,
	isActive,
	isDockviewReady,
}: UseFocusedFileStatusOptions): FocusedFileStatus | null {
	const [status, setStatus] = useState<FocusedFileStatus | null>(null);

	useEffect(() => {
		if (!isActive || !isDockviewReady) return;
		const api = apiRef.current;
		if (api === null) return;
		let frame = 0;
		let parameters: { dispose: () => void } | null = null;
		let watchedPanelId: string | null = null;

		const recompute = () => {
			const panel = api.activePanel ?? null;
			const params = panel?.params as FilePanelStatusParams | undefined;
			const path = typeof params?.filePath === 'string' ? params.filePath : null;
			const read =
				panel === null || path === null
					? null
					: readLayout(api, (candidate) => candidate.id === panel.id);
			const next: FocusedFileStatus | null =
				panel === null || path === null || read === null
					? null
					: {
							...read,
							path,
							size:
								typeof params?.fileInfo?.size === 'number'
									? params.fileInfo.size
									: null,
							isDirty: params?.isDirty === true,
						};
			setStatus((current) =>
				JSON.stringify(current) === JSON.stringify(next) ? current : next,
			);
			const nextWatchedId = next === null ? null : next.panelId;
			if (nextWatchedId !== watchedPanelId) {
				parameters?.dispose();
				watchedPanelId = nextWatchedId;
				parameters =
					panel !== null && nextWatchedId !== null
						? panel.api.onDidParametersChange(schedule)
						: null;
			}
		};
		const schedule = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(recompute);
		};
		const disposables = [
			api.onDidLayoutChange(schedule),
			api.onDidActiveGroupChange(schedule),
			api.onDidActivePanelChange(schedule),
			api.onDidAddPanel(schedule),
			api.onDidRemovePanel(schedule),
			api.onDidMovePanel(schedule),
		];
		schedule();
		return () => {
			window.cancelAnimationFrame(frame);
			parameters?.dispose();
			for (const disposable of disposables) disposable.dispose();
		};
	}, [apiRef, isActive, isDockviewReady]);

	return isActive ? status : null;
}
