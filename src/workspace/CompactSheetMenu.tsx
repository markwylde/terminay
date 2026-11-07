/**
 * The compact switcher's action sheet: one menu shape for a row, a folder, and
 * the server control, so a phone learns one gesture for "what can I do here".
 *
 * It layers over the drawer, not the workspace: a press outside it or the
 * dismiss key closes only the sheet, and focus goes back to what opened it.
 * The shell owns that order; this only draws.
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export type CompactSheetItem =
	| Readonly<{ kind: 'separator'; key: string }>
	| Readonly<{ kind: 'note'; key: string; text: string }>
	| Readonly<{ kind: 'custom'; key: string; node: ReactNode }>
	| Readonly<{
			kind: 'action';
			key: string;
			label: string;
			icon?: ReactNode;
			danger?: boolean;
			disabled?: boolean;
			/** Marks an entry, such as the launcher this device chose last. */
			hint?: string;
			checked?: boolean;
			onSelect: () => void;
	  }>;

export function CompactSheetMenu({
	className,
	header,
	items,
	label,
	onClose,
}: Readonly<{
	className?: string;
	/** Drawn above the entries, outside the menu's own list. */
	header?: ReactNode;
	items: readonly CompactSheetItem[];
	label: string;
	onClose: () => void;
}>) {
	const menuRef = useRef<HTMLDivElement>(null);
	// The sheet is opened by a deliberate press, so it takes focus at once:
	// it is a menu, and a menu is driven from where focus lands.
	useEffect(() => {
		menuRef.current
			?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')
			?.focus();
	}, []);
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		const entries = Array.from(
			menuRef.current?.querySelectorAll<HTMLButtonElement>(
				'[role^="menuitem"]:not(:disabled)',
			) ?? [],
		);
		if (entries.length === 0) return;
		event.preventDefault();
		const at = entries.indexOf(document.activeElement as HTMLButtonElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		entries[(at + step + entries.length) % entries.length]?.focus();
	};
	return (
		<div
			className="compact-drawer__sheet-scrim"
			data-compact-sheet-scrim="true"
			onPointerDown={(event) => {
				if (event.target !== event.currentTarget) return;
				event.preventDefault();
				onClose();
			}}
		>
			<div
				className={`compact-drawer__sheet${className === undefined ? '' : ` ${className}`}`}
				data-compact-sheet="true"
			>
				{header}
				<div
					ref={menuRef}
					role="menu"
					aria-label={label}
					className="compact-drawer__sheet-items"
					onKeyDown={onKeyDown}
				>
					{items.map((item) => {
						switch (item.kind) {
							case 'separator':
								return (
									<hr
										key={item.key}
										className="compact-drawer__sheet-separator"
									/>
								);
							case 'note':
								return (
									<p key={item.key} className="compact-drawer__sheet-note">
										{item.text}
									</p>
								);
							case 'custom':
								return <div key={item.key}>{item.node}</div>;
							case 'action':
								return (
									<button
										key={item.key}
										type="button"
										role={
											item.checked === undefined ? 'menuitem' : 'menuitemradio'
										}
										{...(item.checked === undefined
											? {}
											: { 'aria-checked': item.checked })}
										className={`compact-drawer__sheet-item${item.danger ? ' compact-drawer__sheet-item--danger' : ''}`}
										disabled={item.disabled === true}
										data-compact-sheet-item={item.key}
										onClick={item.onSelect}
									>
										{item.icon === undefined ? null : (
											<span
												className="compact-drawer__sheet-icon"
												aria-hidden="true"
											>
												{item.icon}
											</span>
										)}
										<span className="compact-drawer__sheet-label">
											{item.label}
										</span>
										{item.hint === undefined ? null : (
											<span className="compact-drawer__sheet-hint">
												{item.hint}
											</span>
										)}
									</button>
								);
						}
						return null;
					})}
				</div>
			</div>
		</div>
	);
}
