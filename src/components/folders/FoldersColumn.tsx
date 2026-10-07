import type { ReactNode } from 'react';
import { FoldersTree, type FoldersTreeProps } from './FoldersTree';
import './foldersTree.css';

/**
 * The Folders tree as a project's left column.
 *
 * The band above the tree is the project chrome, the same band the panel tab
 * strip and the sidebar's group tabs draw, so the colour runs unbroken across
 * all three columns.
 */
export function FoldersColumn({
	footer,
	...tree
}: FoldersTreeProps & {
	/** Pinned beneath the tree, such as a notice about what just moved. */
	footer?: ReactNode;
}) {
	return (
		<div className="folders-column" data-terminay-folders-column="true">
			<div className="folders-column__header">
				<span className="folders-column__title">Folders</span>
			</div>
			<div className="folders-column__body">
				<FoldersTree {...tree} />
			</div>
			{footer}
		</div>
	);
}
