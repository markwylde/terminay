import { FolderOpen } from 'lucide-react';
import type { JSX } from 'react';
import './projectStart.css';

export type NoRootFolderStateProps = Readonly<{
	/** Which pane says it, for tests and styling. */
	pane: 'explorer' | 'git' | 'documentation';
	onOpenFolder: () => void;
}>;

/**
 * What the Explorer, Changes, and Documentation panes of a project with no
 * root folder show. They have nothing to read until the project is given a
 * root, so they ask for none and offer to choose one.
 */
export function NoRootFolderState({
	pane,
	onOpenFolder,
}: NoRootFolderStateProps): JSX.Element {
	return (
		<div className="no-root-folder" data-terminay-no-root-folder={pane}>
			<p className="no-root-folder__text">No root folder</p>
			<button
				type="button"
				className="no-root-folder__action"
				onClick={onOpenFolder}
				data-terminay-no-root-open-folder="true"
			>
				<FolderOpen size={14} aria-hidden="true" />
				Open a folder
			</button>
		</div>
	);
}
