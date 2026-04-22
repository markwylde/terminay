import { type ReactNode, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export type ContextMenuItem = {
	label: string;
	onClick: () => void;
	icon?: ReactNode;
	danger?: boolean;
	separator?: boolean;
	key?: string;
};

type ContextMenuProps = {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

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

		window.addEventListener('mousedown', handleClickOutside);
		window.addEventListener('keydown', handleKeyDown);
		return () => {
			window.removeEventListener('mousedown', handleClickOutside);
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [onClose]);

	// Adjust position if it goes off-screen
	const menuWidth = 200;
	const menuHeight = items.length * 32;
	const adjustedX = Math.min(x, window.innerWidth - menuWidth - 10);
	const adjustedY = Math.min(y, window.innerHeight - menuHeight - 10);

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
						<button
							type="button"
							className={`context-menu__item${item.danger ? ' context-menu__item--danger' : ''}`}
							onClick={() => {
								item.onClick();
								onClose();
							}}
						>
							{item.icon && <span className="context-menu__icon">{item.icon}</span>}
							<span className="context-menu__label">{item.label}</span>
						</button>
					)}
				</div>
			))}
		</div>,
		document.body,
	);
}
