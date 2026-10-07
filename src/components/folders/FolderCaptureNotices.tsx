import { X } from 'lucide-react';
import { useEffect } from 'react';
import {
	CAPTURE_NOTICE_DISMISS_MS,
	type CaptureNotice,
	captureNoticeText,
} from '../../workspace/folderCapture';
import './foldersTree.css';

export type FolderCaptureNoticesProps = {
	notices: readonly CaptureNotice[];
	onUndo: (notice: CaptureNotice) => void;
	onDismiss: (noticeId: number) => void;
	/**
	 * `column` sits at the foot of the Folders tree. `banner` is the full-width
	 * strip a project uses when that column is hidden, and `banner-when-narrow`
	 * the same strip shown only below the width at which an open column stops
	 * being drawn.
	 */
	placement: 'column' | 'banner' | 'banner-when-narrow';
};

/**
 * Says that a terminal was moved into the folder of the worktree it created,
 * and offers to put it back. Each notice goes away by itself after a while;
 * the clock starts when the notice is first on screen, so one that arrives
 * while another project is in front is still read.
 */
export function FolderCaptureNotices({
	notices,
	onUndo,
	onDismiss,
	placement,
}: FolderCaptureNoticesProps) {
	if (notices.length === 0) return null;
	return (
		<div
			className={`folder-capture-notices folder-capture-notices--${placement === 'column' ? 'column' : 'banner'}${placement === 'banner-when-narrow' ? ' folder-capture-notices--when-narrow' : ''}`}
		>
			{notices.map((notice) => (
				<FolderCaptureNoticeRow
					key={notice.id}
					notice={notice}
					onUndo={onUndo}
					onDismiss={onDismiss}
				/>
			))}
		</div>
	);
}

function FolderCaptureNoticeRow({
	notice,
	onUndo,
	onDismiss,
}: Readonly<{
	notice: CaptureNotice;
	onUndo: (notice: CaptureNotice) => void;
	onDismiss: (noticeId: number) => void;
}>) {
	useEffect(() => {
		const timer = window.setTimeout(
			() => onDismiss(notice.id),
			CAPTURE_NOTICE_DISMISS_MS,
		);
		return () => window.clearTimeout(timer);
	}, [notice.id, onDismiss]);
	return (
		<div className="folder-capture-notice" role="status">
			<span className="folder-capture-notice__text">
				{captureNoticeText(notice.title)}
			</span>
			<span className="folder-capture-notice__actions">
				<button
					type="button"
					className="folder-capture-notice__undo"
					onClick={() => onUndo(notice)}
				>
					Undo
				</button>
				<button
					type="button"
					className="folder-capture-notice__dismiss"
					aria-label="Dismiss"
					title="Dismiss"
					onClick={() => onDismiss(notice.id)}
				>
					<X size={13} aria-hidden="true" />
				</button>
			</span>
		</div>
	);
}
