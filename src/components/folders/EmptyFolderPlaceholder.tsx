import { Plus } from 'lucide-react';
import { createContext, useContext } from 'react';
import './foldersTree.css';

/** What the placeholder says about the folder it stands in for. */
export type EmptyFolderDescription = {
	name: string;
	/** A linked folder's worktree: where a new terminal will start. */
	worktreePath?: string;
	/** Creates a terminal in this folder, and in no other. */
	onNewTerminal: () => void;
	newTerminalShortcutLabel?: string;
};

/**
 * The panel host draws its watermark with no props of its own, so the folder
 * it is empty for reaches the placeholder through context.
 */
export const EmptyFolderContext = createContext<EmptyFolderDescription | null>(
	null,
);

/**
 * What a folder's panel area shows when the folder holds no panels.
 *
 * Closing a folder's last panel closes only that panel: the folder stays
 * selected, the project stays open, and this offers the obvious next step.
 */
export function EmptyFolderPlaceholder() {
	const folder = useContext(EmptyFolderContext);
	if (folder === null) return null;
	return (
		<div className="folder-empty" data-terminay-folder-empty="true">
			<h2 className="folder-empty__title" title={folder.name}>
				{folder.name}
			</h2>
			<p className="folder-empty__text">
				No terminals are open in this folder.
			</p>
			{folder.worktreePath === undefined ? null : (
				<p className="folder-empty__text">
					A new terminal starts in{' '}
					<code className="folder-empty__path" title={folder.worktreePath}>
						{folder.worktreePath}
					</code>
				</p>
			)}
			<button
				type="button"
				className="folder-empty__action"
				data-terminay-folder-empty-new-terminal="true"
				onClick={folder.onNewTerminal}
			>
				<Plus size={14} aria-hidden="true" />
				New terminal
				{folder.newTerminalShortcutLabel ? (
					<kbd className="folder-empty__key">
						{folder.newTerminalShortcutLabel}
					</kbd>
				) : null}
			</button>
		</div>
	);
}
