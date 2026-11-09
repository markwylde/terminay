import type {
	ProjectStartChoiceDto,
	RecentListResult,
} from '@terminay/client-core';
import { FolderOpen, House, Search, X } from 'lucide-react';
import {
	type CSSProperties,
	type JSX,
	type KeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	chooserFocusMove,
	commitStartChoice,
	openProjectWithRoot,
	type ProjectStartStore,
	RECENT_FOLDERS_COLLAPSED,
	type RecentFolderRow,
	recentFolderRows,
	recentFoldersSearchable,
	startRefusalMessage,
	visibleRecentFolders,
} from './projectStart';
import { RootFolderBrowser } from './RootFolderBrowser';
import './projectStart.css';

export type ProjectStartChooserProps = Readonly<{
	projectId: string;
	projectTitle: string;
	projectColor: string;
	isActive: boolean;
	isCompact: boolean;
	/** Named when more than one connection is attached. */
	serverLabel?: string;
	store: ProjectStartStore;
	/** Changes whenever the server's recent folders do, so the list is asked
	 * for again, as when another client forgets one. */
	recentFoldersKey: unknown;
	/** The server took this client's choice; the project's first terminal is
	 * the caller's to launch. */
	onStarted: (projectId: string) => void;
	/** The projects this window shows, which a recent folder may already be
	 * the root of. */
	shownProjectIds: readonly string[];
	/** A recent folder is already this project's root: show it, and close
	 * the one awaiting its start. */
	onReuseProject: (existingProjectId: string, projectId: string) => void;
}>;

/**
 * What a project awaiting its start choice shows in place of its panels
 * (ADR-0066): open a folder, work in the home directory with no root folder,
 * or reopen one of the server's recent project folders.
 */
export function ProjectStartChooser({
	projectId,
	projectTitle,
	projectColor,
	isActive,
	isCompact,
	serverLabel,
	store,
	recentFoldersKey,
	onStarted,
	shownProjectIds,
	onReuseProject,
}: ProjectStartChooserProps): JSX.Element {
	const [recent, setRecent] = useState<RecentListResult | null>(null);
	const [recentError, setRecentError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [isBrowsing, setIsBrowsing] = useState(false);
	const firstActionRef = useRef<HTMLButtonElement | null>(null);
	const browse = useCallback(
		(path?: string) => store.browseRootFolders(path),
		[store],
	);

	// The list, with whether each folder still exists, is asked for when the
	// chooser is shown and when the server's list changes; it is never polled.
	useEffect(() => {
		if (!isActive) return;
		let current = true;
		store.listRecentProjectFolders().then(
			(result) => {
				if (!current) return;
				setRecent(result);
				setRecentError(null);
			},
			(cause: unknown) => {
				if (current) setRecentError(startRefusalMessage(cause));
			},
		);
		return () => {
			current = false;
		};
	}, [isActive, recentFoldersKey, store]);

	// The first start is where a person begins, as a terminal would be.
	useEffect(() => {
		if (isActive) firstActionRef.current?.focus({ preventScroll: true });
	}, [isActive]);

	const choose = useCallback(
		async (choice: ProjectStartChoiceDto) => {
			if (busy) return;
			setBusy(true);
			setError(null);
			const outcome = await commitStartChoice(store, projectId, choice);
			setBusy(false);
			if (outcome.kind === 'started') onStarted(projectId);
			else if (outcome.kind === 'refused') setError(outcome.message);
			// A conflict needs nothing more: the store now shows the project as
			// the server holds it, started by the choice that won.
		},
		[busy, onStarted, projectId, store],
	);

	const forget = useCallback(
		async (path: string) => {
			setError(null);
			try {
				await store.forgetRecentProjectFolder(path);
				setRecent((current) =>
					current === null
						? current
						: {
								...current,
								entries: current.entries.filter((entry) => entry.path !== path),
							},
				);
			} catch (cause) {
				setError(startRefusalMessage(cause));
			}
		},
		[store],
	);

	return (
		<>
			<ProjectStartChooserView
				projectId={projectId}
				projectTitle={projectTitle}
				projectColor={projectColor}
				isActive={isActive}
				isCompact={isCompact}
				{...(serverLabel === undefined ? {} : { serverLabel })}
				recent={recent === null ? null : recentFolderRows(recent)}
				recentError={recentError}
				error={error}
				busy={busy}
				firstActionRef={firstActionRef}
				onOpenFolder={() => {
					setError(null);
					setIsBrowsing(true);
				}}
				onHome={() => void choose({ kind: 'home' })}
				onOpenRecent={(path) => {
					const existing = openProjectWithRoot(
						store.snapshot,
						path,
						projectId,
						shownProjectIds,
					);
					if (existing === undefined) void choose({ kind: 'folder', path });
					else onReuseProject(existing, projectId);
				}}
				onForgetRecent={(path) => void forget(path)}
			/>
			{isBrowsing ? (
				<RootFolderBrowser
					browse={browse}
					{...(serverLabel === undefined ? {} : { serverLabel })}
					onCancel={() => setIsBrowsing(false)}
					onChoose={(path) => {
						setIsBrowsing(false);
						void choose({ kind: 'folder', path });
					}}
				/>
			) : null}
		</>
	);
}

export type ProjectStartChooserViewProps = Readonly<{
	projectId: string;
	projectTitle: string;
	projectColor: string;
	isActive: boolean;
	isCompact: boolean;
	serverLabel?: string;
	/** `null` while the server's list is still being read. */
	recent: readonly RecentFolderRow[] | null;
	recentError: string | null;
	error: string | null;
	busy: boolean;
	firstActionRef?: RefObject<HTMLButtonElement | null>;
	onOpenFolder: () => void;
	onHome: () => void;
	onOpenRecent: (path: string) => void;
	onForgetRecent: (path: string) => void;
}>;

/** Arrow keys move through every control in order; Tab and Enter work as
 * they do anywhere. */
function moveFocus(event: KeyboardEvent<HTMLElement>): void {
	// In the search box, sideways keys and Home/End edit the text.
	if (
		event.target instanceof HTMLInputElement &&
		event.key !== 'ArrowUp' &&
		event.key !== 'ArrowDown'
	)
		return;
	const items = [
		...event.currentTarget.querySelectorAll<HTMLElement>(
			'[data-start-chooser-item]',
		),
	];
	const next = chooserFocusMove(
		event.key,
		items.indexOf(document.activeElement as HTMLElement),
		items.length,
	);
	if (next === null) return;
	event.preventDefault();
	items[next]?.focus();
}

export function ProjectStartChooserView({
	projectId,
	projectTitle,
	projectColor,
	isActive,
	isCompact,
	serverLabel,
	recent,
	recentError,
	error,
	busy,
	firstActionRef,
	onOpenFolder,
	onHome,
	onOpenRecent,
	onForgetRecent,
}: ProjectStartChooserViewProps): JSX.Element {
	const titleId = `project-start-${projectId}-title`;
	const [query, setQuery] = useState('');
	const [expanded, setExpanded] = useState(false);
	const listRef = useRef<HTMLUListElement | null>(null);
	const focusRevealed = useRef(false);
	const searchable = recent !== null && recentFoldersSearchable(recent);
	const visible = useMemo(
		() => visibleRecentFolders(recent ?? [], searchable ? query : '', expanded),
		[recent, searchable, query, expanded],
	);
	// Show more leaves with its press, so focus goes to the first folder it
	// revealed rather than to the page.
	useEffect(() => {
		if (!expanded || !focusRevealed.current) return;
		focusRevealed.current = false;
		listRef.current
			?.querySelectorAll<HTMLElement>('[data-terminay-recent-open]')
			[RECENT_FOLDERS_COLLAPSED]?.focus();
	}, [expanded]);
	const openFirstMatch = () => {
		if (busy) return;
		const first = visibleRecentFolders(recent ?? [], query, true).rows.find(
			(row) => row.available,
		);
		if (first !== undefined) onOpenRecent(first.path);
	};
	return (
		<section
			className={`project-workspace project-start${isActive ? ' project-workspace--active' : ''}${isCompact ? ' project-start--compact' : ''}`}
			data-terminay-project-id={projectId}
			data-terminay-start-chooser="true"
			aria-labelledby={titleId}
			aria-busy={busy || undefined}
			style={{ '--project-color': projectColor } as CSSProperties}
		>
			<div className="project-start__panel" onKeyDown={moveFocus}>
				<header className="project-start__header">
					<h2
						className="project-start__title"
						id={titleId}
						title={projectTitle}
					>
						Start {projectTitle}
					</h2>
					{serverLabel === undefined ? null : (
						<p
							className="project-start__server"
							data-terminay-start-chooser-server="true"
						>
							On {serverLabel}
						</p>
					)}
				</header>
				<div className="project-start__actions">
					<button
						ref={firstActionRef}
						type="button"
						className="project-start__action"
						disabled={busy}
						onClick={onOpenFolder}
						data-start-chooser-item=""
						data-terminay-start-action="folder"
					>
						<FolderOpen size={18} aria-hidden="true" />
						<span className="project-start__action-text">
							<strong>Open a folder</strong>
							<small>
								Choose this project&apos;s root folder on the server.
							</small>
						</span>
					</button>
					<button
						type="button"
						className="project-start__action"
						disabled={busy}
						onClick={onHome}
						data-start-chooser-item=""
						data-terminay-start-action="home"
					>
						<House size={18} aria-hidden="true" />
						<span className="project-start__action-text">
							<strong>Home directory</strong>
							<small>Work in the home directory, with no root folder.</small>
						</span>
					</button>
				</div>
				{error === null ? null : (
					<div
						className="project-start__error"
						role="alert"
						data-terminay-start-chooser-error="true"
					>
						{error}
					</div>
				)}
				<h3 className="project-start__section-title" id={`${titleId}-recent`}>
					Recent projects
				</h3>
				{recentError !== null ? (
					<p className="project-start__note" role="alert">
						{recentError}
					</p>
				) : recent === null ? (
					<p className="project-start__note" role="status">
						Loading recent projects…
					</p>
				) : recent.length === 0 ? (
					<p className="project-start__note">No recent projects yet.</p>
				) : (
					<>
						{searchable ? (
							<div className="project-start__search">
								<Search size={14} aria-hidden="true" />
								<input
									type="search"
									className="project-start__search-input"
									placeholder={`Search ${recent.length} recent projects`}
									aria-label="Search recent projects"
									value={query}
									onChange={(event) => setQuery(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											event.preventDefault();
											openFirstMatch();
										} else if (event.key === 'Escape' && query !== '') {
											event.preventDefault();
											event.stopPropagation();
											setQuery('');
										}
									}}
									spellCheck={false}
									autoComplete="off"
									data-start-chooser-item=""
									data-terminay-recent-search="true"
								/>
							</div>
						) : null}
						{visible.matched === 0 ? (
							<p className="project-start__note" role="status">
								No recent projects match &ldquo;{query.trim()}&rdquo;.
							</p>
						) : (
							<ul
								ref={listRef}
								className="project-start__recent"
								aria-labelledby={`${titleId}-recent`}
								data-terminay-recent-folders="true"
							>
								{visible.rows.map((row) => (
									<li
										key={row.path}
										className="project-start__recent-row"
										data-terminay-recent-folder={row.path}
										data-available={row.available}
									>
										<button
											type="button"
											className="project-start__recent-open"
											// Still reachable, so a person can hear why it is not
											// offered; it opens nothing.
											aria-disabled={!row.available || busy || undefined}
											onClick={() => {
												if (row.available && !busy) onOpenRecent(row.path);
											}}
											data-start-chooser-item=""
											data-terminay-recent-open="true"
										>
											<span className="project-start__recent-name">
												{row.name}
											</span>
											<span
												className="project-start__recent-path"
												title={row.path}
											>
												{row.path}
											</span>
											{row.available ? null : (
												<span className="project-start__recent-unavailable">
													Unavailable
												</span>
											)}
										</button>
										<button
											type="button"
											className="project-start__recent-forget"
											aria-label={`Forget ${row.name}`}
											title={`Forget ${row.path}`}
											disabled={busy}
											onClick={() => onForgetRecent(row.path)}
											data-start-chooser-item=""
											data-terminay-recent-forget="true"
										>
											<X size={14} aria-hidden="true" />
										</button>
									</li>
								))}
							</ul>
						)}
						{visible.hidden > 0 ? (
							<button
								type="button"
								className="project-start__show-more"
								onClick={() => {
									focusRevealed.current = true;
									setExpanded(true);
								}}
								data-start-chooser-item=""
								data-terminay-recent-show-more="true"
							>
								Show {visible.hidden} more
							</button>
						) : null}
					</>
				)}
			</div>
		</section>
	);
}
