/**
 * An attached server's upgrade, as a row of the connection menu.
 *
 * Each row belongs to one server and says only what that server published:
 * the version on offer and either the action, the upgrade already running, or
 * why the server cannot do it and the command its operator runs instead. The
 * wide header's menu and the phone-width switcher draw the same rows, so the
 * indication is the same wherever the window is.
 */

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { writeClipboardText } from '../host/nativeActions';
import type { ServerUpgradeRow } from './serverUpgradeModel.ts';

export type ServerUpgradeMenuRowsProps = Readonly<{
	rows: readonly ServerUpgradeRow[];
	/** True when the window holds more than one server. */
	namesServers: boolean;
	onUpgrade: (profileId: string) => void;
	/** Ask that server to read its release channel now; resolves with the
	 * line to show for what it found. */
	onCheck: (profileId: string) => Promise<string>;
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

/** Ask one server to look for a newer release now, and say what it found. */
export function ServerUpgradeCheck({
	onCheck,
	profileId,
	reachable,
	variant,
}: Readonly<{
	profileId: string;
	reachable: boolean;
	onCheck: (profileId: string) => Promise<string>;
	variant: 'menu' | 'sheet';
}>) {
	const [checking, setChecking] = useState(false);
	const [result, setResult] = useState<string>();
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const check = () => {
		setChecking(true);
		void onCheck(profileId).then((line) => {
			if (!mounted.current) return;
			setChecking(false);
			setResult(line);
		});
	};
	return (
		<>
			<button
				type="button"
				className="remote-access-menu__item server-upgrade-row__check"
				{...(variant === 'menu' ? { role: 'menuitem' } : {})}
				data-server-upgrade-check
				disabled={!reachable || checking}
				onClick={check}
			>
				<span>{checking ? 'Checking for updates…' : 'Check for updates'}</span>
			</button>
			{!checking && result !== undefined ? (
				<p className="server-upgrade-row__progress" role="status">
					{result}
				</p>
			) : null}
		</>
	);
}

export function ServerUpgradeMenuRows({
	namesServers,
	onCheck,
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
						{row.available === undefined && row.failure === undefined ? (
							<RefreshCw
								className="server-upgrade-row__icon server-upgrade-row__icon--quiet"
								size={13}
								aria-hidden="true"
							/>
						) : (
							<TriangleAlert
								className="server-upgrade-row__icon"
								size={13}
								aria-hidden="true"
							/>
						)}
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
							{row.step === undefined ? 'Upgrading…' : `${row.step}…`}
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
					{row.checkable && row.action !== 'upgrading' ? (
						<ServerUpgradeCheck
							profileId={row.profileId}
							reachable={row.reachable}
							onCheck={onCheck}
							variant={variant}
						/>
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
