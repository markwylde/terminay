import { Copy, FolderOpen, Terminal } from 'lucide-react';
import { type MouseEvent, useMemo, useState } from 'react';
import type { FileViewerMode } from '../../types/fileViewer';
import { getParentPath, getPathRelativeToRoot } from '../../pathUtils';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import type { TaskSection, TaskStats } from '../file-viewer/tasks/parseTasks';
import {
	KanbanBoard,
	NO_COLLAPSE,
	SectionNode,
	StatTile,
	StatsBadge,
	TASK_SORT_OPTIONS,
	type TaskCard,
	type TaskFilter,
	TaskCallout,
	TaskHero,
	TaskRow,
	TaskToolbar,
	type TaskPredicate,
	type TaskSort,
	type TaskView,
	buildPredicate,
	cardMatchesQuery,
	collectCards,
	collectSectionIds,
	isComplete,
	percent,
	sectionHasVisibleTasks,
	sortTaskCards,
	sortTaskSections,
} from '../file-viewer/tasks/taskView';
import '../file-viewer/fileViewer.css';

export type FolderTaskDocument = {
	name: string;
	path: string;
	relativeDirectory: string;
	relativePath: string;
	tree: {
		root: TaskSection;
		stats: TaskStats;
	};
};

type FolderTasksViewerProps = {
	documents: FolderTaskDocument[];
	errorText: string | null;
	ignoredDirectoryCount: number;
	isLoading: boolean;
	onOpenFile: (path: string, initialMode?: FileViewerMode) => void;
	onOpenTerminal?: (path: string) => void;
	onRefresh: () => void;
	projectRootPath: string;
	scannedDirectoryCount: number;
	scannedMarkdownCount: number;
};

function combineStats(documents: FolderTaskDocument[]): TaskStats {
	return documents.reduce<TaskStats>(
		(total, document) => ({
			total: total.total + document.tree.stats.total,
			completed: total.completed + document.tree.stats.completed,
			remaining: total.remaining + document.tree.stats.remaining,
			completedInDiff:
				total.completedInDiff + document.tree.stats.completedInDiff,
		}),
		{ total: 0, completed: 0, remaining: 0, completedInDiff: 0 },
	);
}

function compareDocumentsByName(
	a: FolderTaskDocument,
	b: FolderTaskDocument,
): number {
	return a.relativePath.localeCompare(b.relativePath, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

function compareDocumentsByProgress(
	a: FolderTaskDocument,
	b: FolderTaskDocument,
): number {
	const progressDelta = percent(b.tree.stats) - percent(a.tree.stats);
	if (progressDelta !== 0) {
		return progressDelta;
	}

	const remainingDelta = a.tree.stats.remaining - b.tree.stats.remaining;
	if (remainingDelta !== 0) {
		return remainingDelta;
	}

	return compareDocumentsByName(a, b);
}

function sortDocumentsByMode(
	documents: FolderTaskDocument[],
	sort: TaskSort,
): FolderTaskDocument[] {
	return [...documents].sort(
		sort === 'progress' ? compareDocumentsByProgress : compareDocumentsByName,
	);
}

function FileCheckIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
			<polyline points="22 4 12 14.01 9 11.01" />
		</svg>
	);
}

function FileDocIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
			<polyline points="13 2 13 9 20 9" />
		</svg>
	);
}

function FileTaskGroup({
	collapsed,
	document,
	predicate,
	onOpenFile,
	onOpenPathContextMenu,
	sort,
	onToggle,
}: {
	collapsed: ReadonlySet<string>;
	document: FolderTaskDocument;
	predicate: TaskPredicate;
	onOpenFile: (path: string, initialMode?: FileViewerMode) => void;
	onOpenPathContextMenu: (event: MouseEvent<HTMLElement>, document: FolderTaskDocument) => void;
	sort: TaskSort;
	onToggle: (id: string) => void;
}) {
	const fileId = `file:${document.path}`;
	const isCollapsed = collapsed.has(fileId);
	const rootTasks = document.tree.root.tasks.filter(predicate);
	const rootChildren = sortTaskSections(
		document.tree.root.children.filter((child) =>
			sectionHasVisibleTasks(child, predicate),
		),
		sort,
	);
	const hasVisible = rootTasks.length > 0 || rootChildren.length > 0;

	if (!hasVisible) {
		return null;
	}

	const stats = document.tree.stats;
	const complete = isComplete(stats);
	const showRelativeDirectory =
		document.relativeDirectory.length > 0 && document.relativeDirectory !== '.';

	return (
		<section
			className={`folder-tasks__file${complete ? ' folder-tasks__file--complete' : ''}`}
		>
			<button
				type="button"
				className="folder-tasks__file-header"
				onClick={() => onToggle(fileId)}
				onContextMenu={(event) => onOpenPathContextMenu(event, document)}
				onDoubleClick={() => onOpenFile(document.path, 'tasks')}
				aria-expanded={!isCollapsed}
				title={document.path}
			>
				<span
					className={`file-tasks__chevron${isCollapsed ? ' file-tasks__chevron--collapsed' : ''}`}
				>
					▾
				</span>
				<span
					className={`folder-tasks__file-icon${complete ? ' folder-tasks__file-icon--complete' : ''}`}
					aria-hidden="true"
				>
					{complete ? <FileCheckIcon /> : <FileDocIcon />}
				</span>
				<span className="folder-tasks__file-main">
					<span className="folder-tasks__file-name">{document.name}</span>
					{showRelativeDirectory ? (
						<span className="folder-tasks__file-path">
							{document.relativeDirectory}
						</span>
					) : null}
				</span>
				{complete ? (
					<span className="folder-tasks__file-done">Done</span>
				) : (
					<span className="folder-tasks__file-pct">{percent(stats)}%</span>
				)}
				<StatsBadge stats={stats} />
			</button>

			{isCollapsed ? null : (
				<div className="folder-tasks__file-body">
					{rootTasks.length > 0 ? (
						<ul className="file-tasks__list file-tasks__list--root">
							{rootTasks.map((task) => (
								<TaskRow
									key={`${document.path}:${task.id}`}
									task={task}
									documentPath={document.path}
									onOpenFile={onOpenFile}
								/>
							))}
						</ul>
					) : null}
					{rootChildren.map((child) => (
						<SectionNode
							key={`${document.path}:${child.id}`}
							section={child}
							collapsed={collapsed}
							predicate={predicate}
							onToggle={onToggle}
							sort={sort}
							keyPrefix={document.path}
							documentPath={document.path}
							onOpenFile={onOpenFile}
						/>
					))}
				</div>
			)}
		</section>
	);
}

export function FolderTasksViewer({
	documents,
	errorText,
	ignoredDirectoryCount,
	isLoading,
	onOpenFile,
	onOpenTerminal,
	onRefresh,
	projectRootPath,
	scannedDirectoryCount,
	scannedMarkdownCount,
}: FolderTasksViewerProps) {
	const stats = useMemo(() => combineStats(documents), [documents]);
	const filesComplete = useMemo(
		() => documents.filter((document) => isComplete(document.tree.stats)).length,
		[documents],
	);
	const allSectionIds = useMemo(
		() =>
			documents.flatMap((document) => [
				`file:${document.path}`,
				...collectSectionIds(document.tree.root, document.path),
			]),
		[documents],
	);
	const cardsByDocument = useMemo(
		() =>
			documents.map((document) => ({
				document,
				cards: collectCards(document.tree.root, {
					documentPath: document.path,
					fileName: document.name,
				}),
			})),
		[documents],
	);
	const allCards = useMemo<TaskCard[]>(
		() => cardsByDocument.flatMap((entry) => entry.cards),
		[cardsByDocument],
	);
	const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
	const [filter, setFilter] = useState<TaskFilter>('all');
	const [query, setQuery] = useState('');
	const [view, setView] = useState<TaskView>('list');
	const [sort, setSort] = useState<TaskSort>('progress');
	const [groupByFile, setGroupByFile] = useState(false);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		document: FolderTaskDocument;
	} | null>(null);
	const sortedDocuments = useMemo(
		() => sortDocumentsByMode(documents, sort),
		[documents, sort],
	);
	const sortedCards = useMemo(
		() => sortTaskCards(allCards, sort),
		[allCards, sort],
	);

	const toggle = (id: string) => {
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const openPathContextMenu = (
		event: MouseEvent<HTMLElement>,
		document: FolderTaskDocument,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setContextMenu({
			x: event.clientX,
			y: event.clientY,
			document,
		});
	};

	const allCollapsed =
		allSectionIds.length > 0 && allSectionIds.every((id) => collapsed.has(id));
	const isSearching = query.trim().length > 0;
	const isKanban = view === 'kanban';
	const activeCollapsed = isSearching ? NO_COLLAPSE : collapsed;
	const predicate = buildPredicate(filter, query);
	const visibleCards = sortedCards.filter((card) => cardMatchesQuery(card, query));
	const visibleLanes = sortedDocuments
		.map((document) => {
			const entry = cardsByDocument.find(
				(candidate) => candidate.document.path === document.path,
			);
			return entry
				? {
						document,
						cards: sortTaskCards(entry.cards, sort).filter((card) =>
							cardMatchesQuery(card, query),
						),
					}
				: null;
		})
		.filter(
			(entry): entry is { document: FolderTaskDocument; cards: TaskCard[] } =>
				entry !== null && entry.cards.length > 0,
		);
	const hasVisibleDocuments = documents.some((document) => {
		const root = document.tree.root;
		return (
			root.tasks.some(predicate) ||
			root.children.some((child) => sectionHasVisibleTasks(child, predicate))
		);
	});

	if (isLoading && stats.total === 0) {
		return (
			<div className="file-tasks file-tasks--empty">
				<div className="file-tasks__empty-title">Scanning folder</div>
				<div className="file-tasks__empty-hint">
					Looking for markdown checkboxes recursively.
				</div>
			</div>
		);
	}

	if (errorText && stats.total === 0) {
		return (
			<div className="file-tasks file-tasks--empty">
				<div className="file-tasks__empty-title">Unable to scan tasks</div>
				<div className="file-tasks__empty-hint">{errorText}</div>
				<button type="button" className="folder-viewer__action" onClick={onRefresh}>
					Retry
				</button>
			</div>
		);
	}

	if (stats.total === 0) {
		return (
			<div className="file-tasks file-tasks--empty">
				<div className="file-tasks__empty-title">No tasks found</div>
				<div className="file-tasks__empty-hint">
					No markdown checkboxes were found in this folder.
				</div>
			</div>
		);
	}

	const complete = isComplete(stats);

	return (
		<div className="file-tasks folder-tasks">
			<TaskHero
				stats={stats}
				meta={
					<>
						<div className="folder-tasks__scan-meta">
							{isLoading ? 'Refreshing…' : 'Up to date'} · {scannedMarkdownCount}{' '}
							markdown files scanned · {scannedDirectoryCount} folders watched
							{ignoredDirectoryCount > 0
								? ` · ${ignoredDirectoryCount} ignored`
								: ''}
						</div>
						{errorText ? (
							<div className="folder-tasks__scan-error">{errorText}</div>
						) : null}
					</>
				}
			>
				<StatTile tone="done" value={stats.completed} label="done" />
				<StatTile tone="remaining" value={stats.remaining} label="remaining" />
				<StatTile
					tone="files"
					value={`${filesComplete}/${documents.length}`}
					label="files complete"
				/>
			</TaskHero>

			{complete ? (
				<TaskCallout tone="success" icon="🎉">
					All {stats.total} tasks across {documents.length}{' '}
					{documents.length === 1 ? 'file' : 'files'} complete.
				</TaskCallout>
			) : null}

			<TaskToolbar
				view={view}
				onViewChange={setView}
				filter={filter}
				onFilterChange={setFilter}
				query={query}
				onQueryChange={setQuery}
				showFilter={!isKanban}
			>
				<select
					className="file-tasks__sort"
					value={sort}
					onChange={(event) => setSort(event.target.value as TaskSort)}
					aria-label="Sort task groups"
				>
					{TASK_SORT_OPTIONS.map((option) => (
						<option key={option.id} value={option.id}>
							{option.label}
						</option>
					))}
				</select>
				{isKanban ? (
					<button
						type="button"
						className={`file-tasks__action${groupByFile ? ' file-tasks__action--active' : ''}`}
						aria-pressed={groupByFile}
						onClick={() => setGroupByFile((current) => !current)}
					>
						Group by file
					</button>
				) : allSectionIds.length > 0 ? (
					<button
						type="button"
						className="file-tasks__action"
						onClick={() =>
							setCollapsed(allCollapsed ? new Set() : new Set(allSectionIds))
						}
					>
						{allCollapsed ? 'Expand all' : 'Collapse all'}
					</button>
				) : null}
			</TaskToolbar>

			<div className="file-tasks__scroll">
				{isKanban ? (
					visibleCards.length === 0 ? (
						<div className="file-tasks__filter-empty">
							{isSearching
								? `No groups match “${query.trim()}”.`
								: 'No task groups to show.'}
						</div>
					) : groupByFile ? (
						visibleLanes.map((lane) => (
							<section key={lane.document.path} className="file-kanban__lane">
								<button
									type="button"
									className="file-kanban__lane-header"
									onContextMenu={(event) =>
										openPathContextMenu(event, lane.document)
									}
									onDoubleClick={() => onOpenFile(lane.document.path, 'tasks')}
									title={`Open ${lane.document.path}`}
								>
									<span className="file-kanban__lane-title">
										{lane.document.name}
									</span>
									<span className="file-kanban__lane-path">
										{lane.document.relativeDirectory}
									</span>
									<span className="file-kanban__lane-count">
										{lane.cards.length}{' '}
										{lane.cards.length === 1 ? 'group' : 'groups'}
									</span>
								</button>
								<KanbanBoard
									cards={lane.cards}
									showFile={false}
									onOpenFile={onOpenFile}
								/>
							</section>
						))
					) : (
						<KanbanBoard cards={visibleCards} showFile onOpenFile={onOpenFile} />
					)
				) : (
					<>
						{!hasVisibleDocuments ? (
							<div className="file-tasks__filter-empty">
								{isSearching
									? `No tasks match “${query.trim()}”.`
									: filter === 'remaining'
										? 'Nothing left — all tasks are complete.'
										: 'No completed tasks yet.'}
							</div>
						) : null}
						{sortedDocuments.map((document) => (
							<FileTaskGroup
								key={document.path}
								collapsed={activeCollapsed}
								document={document}
								predicate={predicate}
								onOpenFile={onOpenFile}
								onOpenPathContextMenu={openPathContextMenu}
								sort={sort}
								onToggle={toggle}
							/>
						))}
					</>
				)}
			</div>
			{contextMenu ? (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={buildTaskPathContextMenuItems({
						document: contextMenu.document,
						onOpenTerminal,
						projectRootPath,
					})}
				/>
			) : null}
		</div>
	);
}

function buildTaskPathContextMenuItems(options: {
	document: FolderTaskDocument;
	onOpenTerminal?: (path: string) => void;
	projectRootPath: string;
}): ContextMenuItem[] {
	const { document, onOpenTerminal, projectRootPath } = options;
	const directoryPath = getParentPath(document.path);

	return [
		{
			label: 'Copy path',
			icon: <Copy size={14} />,
			onClick: () => void window.terminay.writeClipboardText(document.path),
		},
		{
			label: 'Copy relative path',
			icon: <Copy size={14} />,
			onClick: () =>
				void window.terminay.writeClipboardText(
					getPathRelativeToRoot(document.path, projectRootPath),
				),
		},
		{ separator: true, label: '', onClick: () => {} },
		{
			label: 'Open shell in folder',
			icon: <Terminal size={14} />,
			disabled: !onOpenTerminal,
			onClick: () => onOpenTerminal?.(directoryPath),
		},
		{
			label: 'Reveal in OS',
			icon: <FolderOpen size={14} />,
			onClick: () => void window.terminay.revealInOS(document.path),
		},
	];
}
