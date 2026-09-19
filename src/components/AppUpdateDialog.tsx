import { Sparkles, X } from 'lucide-react';
import type { JSX, MouseEvent } from 'react';
import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { releaseNoteLinkTarget, renderReleaseNotesHtml } from '../appUpdateNotes';
import { openExternalUrl } from '../host/nativeActions';
import type { AppUpdateStatus } from '../types/terminay';
import './appUpdateDialog.css';

export interface AppUpdateDialogProps {
	status: AppUpdateStatus;
	open: boolean;
	isInstalling: boolean;
	installError: string | null;
	onClose: () => void;
	onInstall: () => void;
}

function handleNotesClick(event: MouseEvent<HTMLElement>): void {
	if (!(event.target instanceof Element)) return;
	const anchor = event.target.closest('a');
	if (!anchor) return;
	event.preventDefault();
	const target = releaseNoteLinkTarget(anchor.getAttribute('href'));
	if (target) void openExternalUrl(target);
}

export function AppUpdateDialog({
	status,
	open,
	isInstalling,
	installError,
	onClose,
	onInstall,
}: AppUpdateDialogProps): JSX.Element | null {
	const titleId = useId();
	const pointerStartedOnBackdropRef = useRef(false);
	const isReady = status.state === 'ready';
	const notes = useMemo(
		() =>
			(status.releaseNotes ?? []).map((note) => ({
				...note,
				html: renderReleaseNotesHtml(note.markdown),
			})),
		[status.releaseNotes],
	);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	const releaseUrl = status.releaseUrl;
	const isBeta = status.channel === 'beta';

	// Portalled out of the title bar so its window-drag regions cannot sit
	// over the dialog.
	return createPortal(
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current =
					event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldClose =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;
				if (shouldClose) onClose();
			}}
		>
			<div
				className="project-edit-modal project-edit-modal--wide app-update-dialog"
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				data-terminay-app-update-dialog="true"
			>
				<div className="project-edit-modal-titlebar">
					<h2 id={titleId} className="project-edit-modal-title">
						<Sparkles
							size={14}
							aria-hidden="true"
							className="app-update-dialog__title-icon"
						/>
						What's new in {status.latestVersion ?? 'Terminay'}
						{isBeta ? ' (beta)' : ''}
					</h2>
					<button
						type="button"
						className="project-edit-modal-close"
						onClick={onClose}
						aria-label="Close What's new"
						title="Close"
					>
						<X size={12} aria-hidden="true" />
					</button>
				</div>

				<p className="app-update-dialog__summary">
					{isReady
						? `Version ${status.latestVersion} has been downloaded. You're on ${status.currentVersion}. Restart to install it now, or it installs the next time you quit Terminay.`
						: `Version ${status.latestVersion} is available. You're on ${status.currentVersion}. This installation can't update itself, so download it from the release page.`}
				</p>

				<div className="app-update-dialog__notes">
					{notes.length > 0 ? (
						notes.map((note) => (
							<section
								key={note.version}
								className="app-update-dialog__release"
							>
								<h3 className="app-update-dialog__release-title">
									{note.url ? (
										<button
											type="button"
											className="app-update-dialog__release-link"
											onClick={() => void openExternalUrl(note.url as string)}
										>
											{note.version}
										</button>
									) : (
										note.version
									)}
								</h3>
								<article
									className="app-update-dialog__markdown"
									onClick={handleNotesClick}
									// Rendered by renderReleaseNotesHtml: raw HTML escaped, no images.
									dangerouslySetInnerHTML={{ __html: note.html }}
								/>
							</section>
						))
					) : (
						<div className="app-update-dialog__empty" role="note">
							{status.releaseNotesError ??
								(status.releaseNotes === undefined || status.releaseNotes === null
									? 'Loading release notes…'
									: 'No release notes were published for this update.')}
						</div>
					)}
				</div>

				{installError ? (
					<div className="app-update-dialog__error">{installError}</div>
				) : null}

				<div className="project-edit-actions">
					{releaseUrl ? (
						<button type="button" onClick={() => void openExternalUrl(releaseUrl)}>
							Open release page
						</button>
					) : null}
					<button type="button" onClick={onClose}>
						Later
					</button>
					{isReady ? (
						<button
							type="button"
							className="app-update-dialog__primary"
							disabled={isInstalling}
							onClick={onInstall}
						>
							{isInstalling ? 'Restarting…' : 'Restart to update'}
						</button>
					) : null}
				</div>
			</div>
		</div>,
		document.body,
	);
}
