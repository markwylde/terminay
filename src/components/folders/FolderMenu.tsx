import {
	Copy,
	Download,
	FileEdit,
	FolderOpen,
	FolderPen,
	Terminal,
	Trash2,
	Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type {
	FolderMenuActionId,
	FolderMenuEntry,
} from '../../workspace/folderMenuModel';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';

const ICONS: Readonly<Record<FolderMenuActionId, ReactNode>> = {
	'commit-and-push': <Upload size={14} />,
	pull: <Download size={14} />,
	'rename-folder': <FolderPen size={14} />,
	'rename-worktree': <FileEdit size={14} />,
	'delete-worktree': <Trash2 size={14} />,
	'delete-folder': <Trash2 size={14} />,
	'copy-path': <Copy size={14} />,
	'copy-relative-path': <Copy size={14} />,
	'open-shell': <Terminal size={14} />,
	reveal: <FolderOpen size={14} />,
};

/**
 * A folder's context menu.
 *
 * What it lists and what is greyed come from `folderMenuEntries`; this draws
 * them and reports the one chosen.
 */
export function FolderMenu({
	x,
	y,
	entries,
	onAction,
	onClose,
}: Readonly<{
	x: number;
	y: number;
	entries: readonly FolderMenuEntry[];
	onAction: (action: FolderMenuActionId) => void;
	onClose: () => void;
}>) {
	const items: ContextMenuItem[] = entries.map((entry) =>
		entry.separator === true
			? { separator: true, label: '', onClick: () => {} }
			: {
					label: entry.label,
					icon: ICONS[entry.id],
					disabled: entry.disabled,
					...(entry.danger === true ? { danger: true } : {}),
					onClick: () => onAction(entry.id),
				},
	);
	return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
