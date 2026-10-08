import { useEffect, useId, useRef } from 'react';
import type { FolderPanelsAnswer } from '../../workspace/folderDeleteFlow';

export type FolderPanelsQuestionProps = {
	folderName: string;
	/** True when deleting removes the folder's worktree from disk too. */
	deletesWorktree: boolean;
	panelCount: number;
	onAnswer: (answer: FolderPanelsAnswer) => void;
};

/**
 * Asked before a folder that still holds panels is deleted: what becomes of
 * them. Nothing has been deleted when this is shown, and Cancel, Escape, and a
 * click outside all leave everything as it is.
 */
export function FolderPanelsQuestion({
	folderName,
	deletesWorktree,
	panelCount,
	onAnswer,
}: FolderPanelsQuestionProps) {
	const titleId = useId();
	const moveRef = useRef<HTMLButtonElement | null>(null);
	const pointerStartedOnBackdropRef = useRef(false);
	const title = deletesWorktree ? 'Delete Worktree' : 'Delete Folder';
	const panels = panelCount === 1 ? '1 panel' : `${panelCount} panels`;

	useEffect(() => {
		// The harmless answer takes focus, so Enter never closes a terminal.
		moveRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			onAnswer('cancel');
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onAnswer]);

	return (
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current =
					event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldCancel =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;
				if (shouldCancel) onAnswer('cancel');
			}}
		>
			<div
				className="project-edit-modal folder-panels-question"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						{title}
					</h2>
				</div>
				<p className="folder-panels-question__text">
					<strong>{folderName}</strong> still holds {panels}. What should
					happen to {panelCount === 1 ? 'it' : 'them'}?
				</p>
				<p className="folder-panels-question__hint">
					Moving keeps every terminal running in General. Closing asks first
					about any terminal that is still busy.
					{deletesWorktree
						? ' The worktree is deleted afterwards, once you confirm it.'
						: ''}
				</p>
				<div className="project-edit-actions">
					<button type="button" onClick={() => onAnswer('cancel')}>
						Cancel
					</button>
					<button type="button" onClick={() => onAnswer('close')}>
						Close them
					</button>
					<button
						ref={moveRef}
						type="submit"
						onClick={() => onAnswer('move')}
					>
						Move to General
					</button>
				</div>
			</div>
		</div>
	);
}
