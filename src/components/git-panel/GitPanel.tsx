import { ChevronDown, Copy, Terminal } from 'lucide-react';
import { type JSX, type MouseEvent, useState } from 'react';
import type {
	GitChangeEntry,
	GitFileState,
	GitPanelStatus,
} from '../../types/terminay';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { FileTypeIcon } from '../../fileIcons';
import { getParentPath, getPathRelativeToRoot } from '../../pathUtils';
import './gitPanel.css';

export type GitPanelProps = {
	status: GitPanelStatus | null;
	viewMode: 'list' | 'tree';
	onOpenEntry: (entry: GitChangeEntry) => void;
	onOpenTerminal?: (path: string) => void;
};

type TreeNode =
	| { type: 'folder'; name: string; path: string; children: TreeNode[] }
	| { type: 'file'; name: string; entry: GitChangeEntry };

const FOLDER_INDENT = 12;
const ROW_BASE_INDENT = 12;

const STATE_BADGES: Record<GitFileState, string> = {
	added: 'A',
	modified: 'M',
	deleted: 'D',
	renamed: 'R',
	copied: 'C',
	untracked: 'U',
	conflicted: '!',
};

type GitGroup = {
	key: string;
	title: string;
	entries: GitChangeEntry[];
};

function splitName(relativePath: string): { dir: string; name: string } {
	const lastSlash = relativePath.lastIndexOf('/');
	if (lastSlash < 0) {
		return { dir: '', name: relativePath };
	}
	return {
		dir: relativePath.slice(0, lastSlash),
		name: relativePath.slice(lastSlash + 1),
	};
}

function getRowTitle(entry: GitChangeEntry): string {
	if (
		(entry.state === 'renamed' || entry.state === 'copied') &&
		entry.originalRelativePath
	) {
		return `${entry.originalRelativePath} → ${entry.relativePath}`;
	}
	return entry.relativePath;
}

function GitPanelRow({
	entry,
	onOpenEntry,
	onContextMenu,
}: {
	entry: GitChangeEntry;
	onOpenEntry: (entry: GitChangeEntry) => void;
	onContextMenu: (event: MouseEvent<HTMLElement>, path: string, relativePath: string, isDirectory: boolean) => void;
}) {
	const badge = STATE_BADGES[entry.state];
	const { dir, name } = splitName(entry.relativePath);
	const title = getRowTitle(entry);

	return (
		<button
			type="button"
			className="git-panel__row"
			onClick={() => onOpenEntry(entry)}
			onContextMenu={(event) =>
				onContextMenu(event, entry.path, entry.relativePath, false)
			}
			title={title}
		>
			<span
				className={`git-panel__icon git-panel__icon--${entry.state}`}
				aria-hidden="true"
			>
				<FileTypeIcon name={name} />
			</span>
			<span className="git-panel__name">{name}</span>
			{dir ? <span className="git-panel__dir">{dir}</span> : null}
			<span className={`git-panel__badge git-panel__badge--${entry.state}`}>
				{badge}
			</span>
		</button>
	);
}

function buildTree(entries: GitChangeEntry[]): TreeNode[] {
	const root: TreeNode[] = [];
	const folderIndex = new Map<string, TreeNode[]>();
	folderIndex.set('', root);

	for (const entry of entries) {
		const segments = entry.relativePath.split('/');
		const fileName = segments.pop() ?? entry.relativePath;
		let parentPath = '';
		let children = root;

		for (const segment of segments) {
			const folderPath = parentPath ? `${parentPath}/${segment}` : segment;
			let nextChildren = folderIndex.get(folderPath);
			if (!nextChildren) {
				const folderNode: TreeNode = {
					type: 'folder',
					name: segment,
					path: folderPath,
					children: [],
				};
				children.push(folderNode);
				nextChildren = folderNode.children;
				folderIndex.set(folderPath, nextChildren);
			}
			children = nextChildren;
			parentPath = folderPath;
		}

		children.push({ type: 'file', name: fileName, entry });
	}

	sortTree(root);
	return root;
}

function sortTree(nodes: TreeNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) {
			return a.type === 'folder' ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
	for (const node of nodes) {
		if (node.type === 'folder') {
			sortTree(node.children);
		}
	}
}

function GitTreeNode({
	node,
	depth,
	groupKey,
	collapsedFolders,
	onToggleFolder,
	onOpenEntry,
	onContextMenu,
	repoRoot,
}: {
	node: TreeNode;
	depth: number;
	groupKey: string;
	collapsedFolders: Set<string>;
	onToggleFolder: (key: string) => void;
	onOpenEntry: (entry: GitChangeEntry) => void;
	onContextMenu: (event: MouseEvent<HTMLElement>, path: string, relativePath: string, isDirectory: boolean) => void;
	repoRoot: string;
}): JSX.Element {
	if (node.type === 'file') {
		const { entry } = node;
		const badge = STATE_BADGES[entry.state];
		const title = getRowTitle(entry);

		return (
			<button
				type="button"
				className="git-panel__row"
				style={{ paddingLeft: depth * FOLDER_INDENT + ROW_BASE_INDENT }}
				onClick={() => onOpenEntry(entry)}
				onContextMenu={(event) =>
					onContextMenu(event, entry.path, entry.relativePath, false)
				}
				title={title}
			>
				<span
					className={`git-panel__icon git-panel__icon--${entry.state}`}
					aria-hidden="true"
				>
					<FileTypeIcon name={node.name} />
				</span>
				<span className="git-panel__name">{node.name}</span>
				<span className={`git-panel__badge git-panel__badge--${entry.state}`}>
					{badge}
				</span>
			</button>
		);
	}

	const folderKey = `${groupKey}:${node.path}`;
	const collapsed = collapsedFolders.has(folderKey);
	const folderPath = `${repoRoot.replace(/[\\/]+$/, '')}/${node.path}`;

	return (
		<>
			<button
				type="button"
				className={`git-panel__folder${
					collapsed ? ' git-panel__folder--collapsed' : ''
				}`}
				style={{ paddingLeft: depth * FOLDER_INDENT + ROW_BASE_INDENT }}
				onClick={() => onToggleFolder(folderKey)}
				onContextMenu={(event) => onContextMenu(event, folderPath, node.path, true)}
			>
				<span
					className={`git-panel__folder-chevron${
						collapsed ? ' git-panel__folder-chevron--collapsed' : ''
					}`}
					aria-hidden="true"
				>
					<ChevronDown size={14} aria-hidden />
				</span>
				<span className="git-panel__folder-name">{node.name}</span>
			</button>
			{collapsed
				? null
				: node.children.map((child) => (
						<GitTreeNode
							key={
								child.type === 'folder'
									? `f:${child.path}`
									: `l:${child.entry.relativePath}`
							}
							node={child}
							depth={depth + 1}
							groupKey={groupKey}
							collapsedFolders={collapsedFolders}
							onToggleFolder={onToggleFolder}
							onOpenEntry={onOpenEntry}
							onContextMenu={onContextMenu}
							repoRoot={repoRoot}
						/>
					))}
		</>
	);
}

export function GitPanel(props: GitPanelProps): JSX.Element {
	const { status, viewMode, onOpenEntry, onOpenTerminal } = props;
	const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
		() => new Set(),
	);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		path: string;
		relativePath: string;
		isDirectory: boolean;
	} | null>(null);

	const onToggleFolder = (key: string) => {
		setCollapsedFolders((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	};

	const openContextMenu = (
		event: MouseEvent<HTMLElement>,
		path: string,
		relativePath: string,
		isDirectory: boolean,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setContextMenu({
			x: event.clientX,
			y: event.clientY,
			path,
			relativePath,
			isDirectory,
		});
	};

	if (status === null) {
		return (
			<div className="git-panel">
				<div className="git-panel__message">Loading…</div>
			</div>
		);
	}

	if (!status.gitAvailable) {
		return (
			<div className="git-panel">
				<div className="git-panel__message">Git is not available</div>
			</div>
		);
	}

	if (!status.repoRoot) {
		return (
			<div className="git-panel">
				<div className="git-panel__message">Not a git repository</div>
			</div>
		);
	}

	if (status.entries.length === 0) {
		return (
			<div className="git-panel">
				<div className="git-panel__message">No changes</div>
			</div>
		);
	}

	const repoRoot = status.repoRoot;
	const mergeChanges: GitChangeEntry[] = [];
	const stagedChanges: GitChangeEntry[] = [];
	const changes: GitChangeEntry[] = [];

	for (const entry of status.entries) {
		if (entry.state === 'conflicted') {
			mergeChanges.push(entry);
		} else if (entry.staged) {
			stagedChanges.push(entry);
		} else {
			changes.push(entry);
		}
	}

	const groups: GitGroup[] = [
		{ key: 'merge', title: 'Merge Changes', entries: mergeChanges },
		{ key: 'staged', title: 'Staged Changes', entries: stagedChanges },
		{ key: 'changes', title: 'Changes', entries: changes },
	].filter((group) => group.entries.length > 0);

	// A single group's header would just duplicate the "Git" pane header above,
	// so only label sections when there is more than one.
	const showGroupHeaders = groups.length > 1;

	return (
		<div className="git-panel">
			{groups.map((group) => (
				<section key={group.key} className="git-panel__group">
					{showGroupHeaders ? (
						<div className="git-panel__group-header">
							<span className="git-panel__group-title">{group.title}</span>
							<span className="git-panel__group-count">
								{group.entries.length}
							</span>
						</div>
					) : null}
					{viewMode === 'tree'
						? buildTree(group.entries).map((node) => (
								<GitTreeNode
									key={
										node.type === 'folder'
											? `f:${node.path}`
											: `l:${node.entry.relativePath}`
									}
									node={node}
									depth={0}
									groupKey={group.key}
									collapsedFolders={collapsedFolders}
									onToggleFolder={onToggleFolder}
									onOpenEntry={onOpenEntry}
									onContextMenu={openContextMenu}
									repoRoot={repoRoot}
								/>
							))
						: group.entries.map((entry) => (
								<GitPanelRow
									key={`${group.key}:${entry.relativePath}`}
									entry={entry}
									onOpenEntry={onOpenEntry}
									onContextMenu={openContextMenu}
								/>
							))}
				</section>
			))}
			{contextMenu ? (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={buildGitPathContextMenuItems({
						isDirectory: contextMenu.isDirectory,
						onOpenTerminal,
						path: contextMenu.path,
						relativePath: contextMenu.relativePath,
						repoRoot,
					})}
				/>
			) : null}
		</div>
	);
}

function buildGitPathContextMenuItems(options: {
	isDirectory: boolean;
	onOpenTerminal?: (path: string) => void;
	path: string;
	relativePath: string;
	repoRoot: string;
}): ContextMenuItem[] {
	const { isDirectory, onOpenTerminal, path, relativePath, repoRoot } = options;
	const terminalPath = isDirectory ? path : getParentPath(path);

	return [
		{
			label: 'Copy path',
			icon: <Copy size={14} />,
			onClick: () => void window.terminay.writeClipboardText(path),
		},
		{
			label: 'Copy relative path',
			icon: <Copy size={14} />,
			onClick: () =>
				void window.terminay.writeClipboardText(
					relativePath || getPathRelativeToRoot(path, repoRoot),
				),
		},
		{ separator: true, label: '', onClick: () => {} },
		{
			label: 'Open shell in folder',
			icon: <Terminal size={14} />,
			disabled: !onOpenTerminal,
			onClick: () => onOpenTerminal?.(terminalPath),
		},
	];
}
