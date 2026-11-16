/**
 * The settings control a narrow bot tab shows in place of its mode switch and
 * availability button: a gear that opens a small menu with Chat, Configure,
 * and Enable bot or Disable bot.
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

type Mode = 'chat' | 'configure';

export function BotSettingsMenu({
	mode,
	onMode,
	enabled,
	onToggleEnabled,
	visible,
}: Readonly<{
	mode: Mode;
	onMode: (mode: Mode) => void;
	enabled: boolean;
	/** Absent when the server cannot change a bot's availability. */
	onToggleEnabled: (() => void) | undefined;
	visible: boolean;
}>) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);

	const close = useCallback((refocus: boolean) => {
		setOpen(false);
		if (refocus) button.current?.focus();
	}, []);

	// Close on a press outside, on any resize (the layout may have widened past
	// the narrow header), and when the tab is hidden.
	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) close(false);
		};
		const onResize = () => close(false);
		window.addEventListener('pointerdown', onPointer, true);
		window.addEventListener('resize', onResize);
		return () => {
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('resize', onResize);
		};
	}, [open, close]);
	useEffect(() => {
		if (!visible) setOpen(false);
	}, [visible]);

	// Focus the current mode when the menu opens.
	useEffect(() => {
		if (!open) return;
		menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	}, [open]);

	const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const items = Array.from(
			menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [],
		);
		const at = items.indexOf(document.activeElement as HTMLElement);
		let next: number | undefined;
		if (event.key === 'ArrowDown') next = (at + 1) % items.length;
		else if (event.key === 'ArrowUp')
			next = (at - 1 + items.length) % items.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = items.length - 1;
		else if (event.key === 'Escape' || event.key === 'Tab') {
			if (event.key === 'Escape') event.preventDefault();
			close(event.key === 'Escape');
			return;
		}
		if (next === undefined) return;
		event.preventDefault();
		items[next]?.focus();
	};

	const choose = (action: () => void) => {
		action();
		close(true);
	};

	return (
		<div className="bots-ahead__settings" ref={root}>
			<button
				ref={button}
				type="button"
				className="bots-ahead__gear"
				aria-label="Bot settings"
				title="Bot settings"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((was) => !was)}
				data-terminay-bot-settings
			>
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
					/>
				</svg>
			</button>
			{open ? (
				<div
					ref={menu}
					className="bots-ahead__menu"
					role="menu"
					aria-label="Bot settings"
					tabIndex={-1}
					onKeyDown={onMenuKey}
				>
					{(['chat', 'configure'] as const).map((item) => (
						<button
							key={item}
							type="button"
							role="menuitemradio"
							aria-checked={mode === item}
							tabIndex={-1}
							onClick={() => choose(() => onMode(item))}
							data-terminay-bot-settings-item={item}
						>
							<span className="bots-ahead__check" aria-hidden="true">
								{mode === item ? '✓' : ''}
							</span>
							{item === 'chat' ? 'Chat' : 'Configure'}
						</button>
					))}
					{onToggleEnabled === undefined ? null : (
						<>
							<hr />
							<button
								type="button"
								role="menuitem"
								tabIndex={-1}
								onClick={() => choose(onToggleEnabled)}
								data-terminay-bot-settings-item="availability"
							>
								<span className="bots-ahead__check" aria-hidden="true" />
								{enabled ? 'Disable bot' : 'Enable bot'}
							</button>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
