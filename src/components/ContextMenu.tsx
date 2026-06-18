import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuTrailingAction = {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
};

export type ContextMenuItem = {
	label: string;
	onClick: () => void;
	icon?: ReactNode;
	danger?: boolean;
	disabled?: boolean;
	separator?: boolean;
	key?: string;
	/** Optional secondary action rendered as a button on the right edge of the row. */
	trailingAction?: ContextMenuTrailingAction;
};

type ContextMenuProps = {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
	portalContainer?: HTMLElement;
};

export function ContextMenu({ x, y, items, onClose, portalContainer }: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	const ownerWindow = portalContainer?.ownerDocument.defaultView ?? window;

	const getItemKey = (item: ContextMenuItem, index: number) => {
		if (item.key) {
			return item.key;
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
		<div
			ref={menuRef}
			className="context-menu"
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
						<div className="context-menu__separator" />
					) : (
						<div
							className={`context-menu__row${item.trailingAction ? ' context-menu__row--has-trailing' : ''}`}
						>
							<button
								type="button"
								className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
								disabled={item.disabled}
								onClick={() => {
									if (item.disabled) {
										return;
									}
									item.onClick();
									onClose();
								}}
							>
								{item.icon && <span className="context-menu__icon">{item.icon}</span>}
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
