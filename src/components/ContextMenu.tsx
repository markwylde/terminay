import {
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useEffect,
	useRef,
} from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuTrailingAction = {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
};

export type ContextMenuItem = {
	label: string;
	onClick?: () => void;
	icon?: ReactNode;
	danger?: boolean;
	disabled?: boolean;
	separator?: boolean;
	heading?: boolean;
	key?: string;
	/** Optional secondary action rendered as a button on the right edge of the row. */
	trailingAction?: ContextMenuTrailingAction;
};

/**
 * Opt-in keyboard mode: menu roles, Up/Down/Home/End between enabled items,
 * and, with `autoFocus`, focus on the first enabled item when the menu opens.
 * Without it the menu renders and behaves as it always has.
 */
export type ContextMenuKeyboard = {
	autoFocus: boolean;
};

type ContextMenuProps = {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
	portalContainer?: HTMLElement;
	keyboard?: ContextMenuKeyboard;
	/** Accessible name for the menu in keyboard mode. */
	label?: string;
};

const ENABLED_ITEM = '.context-menu__item:not(:disabled)';

export function ContextMenu({
	x,
	y,
	items,
	onClose,
	portalContainer,
	keyboard,
	label,
}: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const ownerWindow = portalContainer?.ownerDocument.defaultView ?? window;
	const autoFocus = keyboard?.autoFocus === true;

	useEffect(() => {
		if (!autoFocus) {
			return;
		}
		menuRef.current?.querySelector<HTMLButtonElement>(ENABLED_ITEM)?.focus();
	}, [autoFocus]);

	const moveFocus = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const menu = menuRef.current;
		if (!keyboard || !menu) {
			return;
		}
		const enabled = [...menu.querySelectorAll<HTMLButtonElement>(ENABLED_ITEM)];
		if (enabled.length === 0) {
			return;
		}
		const at = enabled.indexOf(event.target as HTMLButtonElement);
		let next: number | undefined;
		if (event.key === 'ArrowDown')
			next = at < 0 ? 0 : (at + 1) % enabled.length;
		else if (event.key === 'ArrowUp')
			next =
				at < 0
					? enabled.length - 1
					: (at - 1 + enabled.length) % enabled.length;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = enabled.length - 1;
		if (next === undefined) {
			return;
		}
		event.preventDefault();
		enabled[next].focus();
	};

	const getItemKey = (item: ContextMenuItem, index: number) => {
		if (item.key) {
			return item.key;
		}

		if (item.heading) {
			return `heading-${item.label}`;
		}

		if (!item.separator) {
			return item.label;
		}

		const previousLabel = items[index - 1]?.label ?? 'start';
		const nextLabel = items[index + 1]?.label ?? 'end';
		return `${previousLabel}-separator-${nextLabel}`;
	};

	useEffect(() => {
		const handleClickOutside = (event: globalThis.MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onClose();
			}
		};

		ownerWindow.addEventListener('mousedown', handleClickOutside);
		ownerWindow.addEventListener('keydown', handleKeyDown);
		return () => {
			ownerWindow.removeEventListener('mousedown', handleClickOutside);
			ownerWindow.removeEventListener('keydown', handleKeyDown);
		};
	}, [onClose, ownerWindow]);

	// Adjust position if it goes off-screen
	const menuWidth = 200;
	const menuHeight = items.length * 32;
	const adjustedX = Math.min(x, ownerWindow.innerWidth - menuWidth - 10);
	const adjustedY = Math.min(y, ownerWindow.innerHeight - menuHeight - 10);

	return createPortal(
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: The role is `menu` whenever aria-label is set; Biome cannot resolve the expression.
		<div
			ref={menuRef}
			className="context-menu"
			role={keyboard ? 'menu' : undefined}
			aria-label={keyboard ? label : undefined}
			onKeyDown={keyboard ? moveFocus : undefined}
			style={{
				position: 'fixed',
				left: adjustedX,
				top: adjustedY,
				zIndex: 10000,
			}}
		>
			{items.map((item, index) => (
				<div key={getItemKey(item, index)}>
					{item.separator ? (
						<div
							className="context-menu__separator"
							role={keyboard ? 'separator' : undefined}
						/>
					) : item.heading ? (
						<div className="context-menu__heading">{item.label}</div>
					) : (
						<div
							className={`context-menu__row${item.trailingAction ? ' context-menu__row--has-trailing' : ''}`}
						>
							<button
								type="button"
								className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
								role={keyboard ? 'menuitem' : undefined}
								disabled={item.disabled}
								onClick={() => {
									if (item.disabled) {
										return;
									}
									item.onClick?.();
									onClose();
								}}
							>
								{item.icon && (
									<span className="context-menu__icon">{item.icon}</span>
								)}
								<span className="context-menu__label">{item.label}</span>
							</button>
							{item.trailingAction && (
								<button
									type="button"
									className="context-menu__trailing"
									disabled={item.trailingAction.disabled}
									aria-label={item.trailingAction.label}
									title={item.trailingAction.label}
									onClick={(event) => {
										event.stopPropagation();
										if (item.trailingAction?.disabled) {
											return;
										}
										item.trailingAction?.onClick();
										onClose();
									}}
								>
									{item.trailingAction.icon}
								</button>
							)}
						</div>
					)}
				</div>
			))}
		</div>,
		portalContainer ?? document.body,
	);
}
