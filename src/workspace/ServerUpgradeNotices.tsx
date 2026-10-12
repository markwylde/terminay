/**
 * How an upgrade this window watched ended, told once.
 *
 * The header's warning leaves when an upgrade succeeds, so the outcome cannot
 * live only inside a menu nobody has open. Each notice stays until it is
 * dismissed and is drawn over the workspace, never in its flow, so telling
 * the user never resizes a terminal.
 */

import { X } from 'lucide-react';
import type { ServerUpgradeNotice } from './serverUpgradeModel.ts';

export function ServerUpgradeNotices({
	notices,
	onDismiss,
}: Readonly<{
	notices: readonly ServerUpgradeNotice[];
	onDismiss: (noticeId: string) => void;
}>) {
	if (notices.length === 0) return null;
	return (
		<div className="server-upgrade-notices">
			{notices.map((notice) => (
				<div
					key={notice.id}
					className={`server-upgrade-notice server-upgrade-notice--${notice.tone}`}
					role={notice.tone === 'failure' ? 'alert' : 'status'}
					data-server-upgrade-notice={notice.tone}
				>
					<span>{notice.text}</span>
					<button
						type="button"
						className="server-upgrade-notice__dismiss"
						aria-label="Dismiss"
						onClick={() => onDismiss(notice.id)}
					>
						<X size={13} aria-hidden="true" />
					</button>
				</div>
			))}
		</div>
	);
}
