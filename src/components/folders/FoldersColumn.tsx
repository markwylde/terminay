import { MoreHorizontal } from 'lucide-react';
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
	isMenuOpen = false,
	onOpenMenu,
	...tree
}: FoldersTreeProps & {
	/** Pinned beneath the tree, such as a notice about what just moved. */
	footer?: ReactNode;
	isMenuOpen?: boolean;
	/** Opens the menu of what is done to the folders as a list. */
	onOpenMenu?: (anchor: { x: number; y: number }) => void;
}) {
	return (
		<div className="folders-column" data-terminay-folders-column="true">
			<div className="folders-column__header">
				<span className="folders-column__title">Folders</span>
				{onOpenMenu === undefined ? null : (
					<button
						type="button"
						className={`folders-column__menu${isMenuOpen ? ' folders-column__menu--active' : ''}`}
						aria-label="Folders actions"
						aria-haspopup="menu"
						aria-expanded={isMenuOpen}
						title="Folders actions"
						onClick={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							onOpenMenu({ x: rect.left, y: rect.bottom + 4 });
						}}
					>
						<MoreHorizontal size={14} aria-hidden="true" />
					</button>
				)}
			</div>
			<div className="folders-column__body">
				<FoldersTree {...tree} />
			</div>
			{footer}
		</div>
	);
}
