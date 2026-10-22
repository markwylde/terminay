import { useEffect, useId, useRef, useState } from 'react';
import type { FolderPanelsAnswer } from '../../workspace/folderDeleteFlow';

/** How many of a folder's terminals have a non-shell process running. */
export type RunningTerminals = {
	count: number;
	/** True when the server could not say for every terminal. */
	limited: boolean;
};

export type FolderDeleteDialogProps = {
	folderName: string;
	/** The worktree deleting removes from disk, for a linked folder. */
	worktree?: { path: string; warning: string };
	panelCount: number;
	running: RunningTerminals;
	onAnswer: (answer: FolderPanelsAnswer) => void;
};

/**
 * The one question a folder or worktree delete asks: what becomes of its
 * panels, and whether to go ahead at all. Nothing has been deleted when this is
 * shown, and nothing is asked after Delete. Cancel, Escape, and a click outside
 * all leave everything as it is.
 */
export function FolderDeleteDialog({
	folderName,
	worktree,
	panelCount,
	running,
	onAnswer,
}: FolderDeleteDialogProps) {
	const titleId = useId();
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	const pointerStartedOnBackdropRef = useRef(false);
	const [outcome, setOutcome] = useState<'move' | 'close'>('move');
	const title = worktree === undefined ? 'Delete Folder' : 'Delete Worktree';
	const panels = panelCount === 1 ? '1 panel' : `${panelCount} panels`;
	const them = panelCount === 1 ? 'it' : 'them';

	useEffect(() => {
		// Cancel takes focus, so Enter never deletes a worktree from disk.
		cancelRef.current?.focus();
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
				className="project-edit-modal folder-delete-dialog"
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						{title}
					</h2>
				</div>
				<div className="folder-delete-dialog__body">
					<div className="folder-delete-dialog__subject">
						<p className="folder-delete-dialog__text">
							Delete <strong>{folderName}</strong>?
						</p>
						{worktree === undefined ? null : (
							<p className="folder-delete-dialog__path">{worktree.path}</p>
						)}
					</div>
					{worktree === undefined ? null : (
						<p
							className="folder-delete-dialog__warning"
							data-folder-delete-warning=""
						>
							{worktree.warning}
						</p>
					)}
					{panelCount === 0 ? null : (
						<fieldset className="folder-delete-dialog__panels">
							<legend className="folder-delete-dialog__text">
								It still holds {panels}. What should happen to {them}?
							</legend>
							<label className="folder-delete-dialog__option">
								<input
									type="radio"
									name="folder-delete-panels"
									value="move"
									checked={outcome === 'move'}
									onChange={() => setOutcome('move')}
								/>
								<span>
									<span className="folder-delete-dialog__label">
										Move to General
									</span>
									<span className="folder-delete-dialog__hint">
										Every terminal keeps running.
									</span>
								</span>
							</label>
							<label className="folder-delete-dialog__option">
								<input
									type="radio"
									name="folder-delete-panels"
									value="close"
									checked={outcome === 'close'}
									onChange={() => setOutcome('close')}
								/>
								<span>
									<span className="folder-delete-dialog__label">
										Close {them}
									</span>
									{outcome === 'close' ? (
										<RunningNote running={running} />
									) : null}
								</span>
							</label>
						</fieldset>
					)}
				</div>
				<div className="project-edit-actions">
					<button
						ref={cancelRef}
						type="button"
						onClick={() => onAnswer('cancel')}
					>
						Cancel
					</button>
					<button
						type="submit"
						className="folder-delete-dialog__delete"
						onClick={() => onAnswer(outcome)}
					>
						Delete
					</button>
				</div>
			</div>
		</div>
	);
}

export function RunningNote({ running }: { running: RunningTerminals }) {
	if (running.count > 0)
		return (
			<span
				className="folder-delete-dialog__hint folder-delete-dialog__hint--warning"
				data-folder-delete-running={running.count}
			>
				{running.count === 1
					? '1 terminal has a process running. Closing stops it.'
					: `${running.count} terminals have a process running. Closing stops them.`}
			</span>
		);
	if (running.limited)
		return (
			<span className="folder-delete-dialog__hint folder-delete-dialog__hint--warning">
				Terminay could not check whether these terminals are busy. Closing stops
				anything running.
			</span>
		);
	return null;
}
