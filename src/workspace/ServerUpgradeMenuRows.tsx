/**
 * An attached server's upgrade, as a row of the connection menu.
 *
 * Each row belongs to one server and says only what that server published:
 * the version on offer and either the action, the upgrade already running, or
 * why the server cannot do it and the command its operator runs instead. The
 * wide header's menu and the phone-width switcher draw the same rows, so the
 * indication is the same wherever the window is.
 */

import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { writeClipboardText } from '../host/nativeActions';
import type { ServerUpgradeRow } from './serverUpgradeModel.ts';

export type ServerUpgradeMenuRowsProps = Readonly<{
	rows: readonly ServerUpgradeRow[];
	/** True when the window holds more than one server. */
	namesServers: boolean;
	onUpgrade: (profileId: string) => void;
	/** `menu` inside the header's menu, where the action is a menu item;
	 * `sheet` in the phone-width switcher, which is a list, not a menu. */
	variant: 'menu' | 'sheet';
}>;

/** The host command for a server that cannot upgrade itself, with a copy. */
export function ServerUpgradeCommand({
	command,
}: Readonly<{ command: string }>) {
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(reset.current), []);
	// A different command under the same control has not been copied.
	useEffect(() => {
		clearTimeout(reset.current);
		setCopied(false);
		setFailed(false);
	}, [command]);
	const copy = () => {
		clearTimeout(reset.current);
		void writeClipboardText(command).then(
			() => {
				setFailed(false);
				setCopied(true);
				reset.current = setTimeout(() => setCopied(false), 2000);
			},
			() => {
				setCopied(false);
				setFailed(true);
			},
		);
	};
	return (
		<div className="server-upgrade-row__command">
			<code>{command}</code>
			<button
				type="button"
				className="server-upgrade-row__copy"
				aria-label="Copy upgrade command"
				onClick={copy}
			>
				{copied ? 'Copied' : 'Copy'}
			</button>
			<span className="server-upgrade-row__copy-status" role="status">
				{copied
					? 'Copied to the clipboard.'
					: failed
						? 'Could not copy. Select the command instead.'
						: ''}
			</span>
		</div>
	);
}

export function ServerUpgradeMenuRows({
	namesServers,
	onUpgrade,
	rows,
	variant,
}: ServerUpgradeMenuRowsProps) {
	if (rows.length === 0) return null;
	return (
		<>
			{rows.map((row) => (
				// biome-ignore lint/a11y/useSemanticElements: one server's block inside a menu or a list; a fieldset would restyle both.
				<div
					key={row.profileId}
					className={`server-upgrade-row server-upgrade-row--${variant}`}
					role="group"
					aria-label={`${row.label} upgrade`}
					data-server-upgrade-profile-id={row.profileId}
					data-server-upgrade-state={row.action}
				>
					<div className="server-upgrade-row__summary">
						<TriangleAlert
							className="server-upgrade-row__icon"
							size={13}
							aria-hidden="true"
						/>
						<span>
							{namesServers ? (
								<span className="server-upgrade-row__server">
									{row.label} ·{' '}
								</span>
							) : null}
							{row.available === undefined
								? `Running ${row.version}`
								: `Update available · ${row.available}`}
						</span>
					</div>
					{row.failure === undefined ? null : (
						<p className="remote-access-menu__diagnostic">{row.failure}</p>
					)}
					{row.action === 'upgrading' ? (
						<p className="server-upgrade-row__progress" role="status">
							Upgrading…
						</p>
					) : null}
					{row.action === 'upgrade' ? (
						<button
							type="button"
							className="remote-access-menu__item server-upgrade-row__action"
							{...(variant === 'menu' ? { role: 'menuitem' } : {})}
							disabled={!row.reachable}
							onClick={() => onUpgrade(row.profileId)}
						>
							<span>Upgrade server…</span>
						</button>
					) : null}
					{row.action === 'manual' ? (
						<>
							<p className="remote-access-menu__diagnostic">{row.reason}</p>
							{row.command === undefined ? null : (
								<ServerUpgradeCommand command={row.command} />
							)}
						</>
					) : null}
				</div>
			))}
		</>
	);
}
