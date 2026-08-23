import { ChevronDown, GripVertical } from 'lucide-react';
import type {
	CSSProperties,
	JSX,
	KeyboardEvent,
	PointerEvent,
	ReactNode,
	Ref,
} from 'react';
import './sidebar.css';

export type SidebarPaneDropPosition = 'before' | 'after';

export type SidebarPaneReorderProps = {
	dragging: boolean;
	dropPosition: SidebarPaneDropPosition | null;
	onMove: (direction: -1 | 1) => void;
	onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
	panelId: string;
};

export type SidebarPaneProps = {
	/** Stable project-sidebar identity, used by the flat layout controller. */
	paneId?: string;
	/** DOM id used by a resize separator's aria-controls relationship. */
	paneDomId?: string;
	/** The flat layout observes this rendered title row as the pane hard minimum. */
	headerRef?: Ref<HTMLDivElement>;
	title: string;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	count?: number;
	accessory?: ReactNode;
	/** Interactive controls shown at the right of the header, outside the collapse toggle. */
	actions?: ReactNode;
	className?: string;
	style?: CSSProperties;
	reorder?: SidebarPaneReorderProps;
	children: ReactNode;
};

export function SidebarPane(props: SidebarPaneProps): JSX.Element {
	const {
		title,
		collapsed,
		onToggleCollapsed,
		count,
		accessory,
		actions,
		className,
		style,
		paneId,
		paneDomId,
		headerRef,
		reorder,
		children,
	} = props;

	const rootClassName = [
		'sidebar-pane',
		collapsed ? 'sidebar-pane--collapsed' : '',
		reorder?.dragging ? 'sidebar-pane--dragging' : '',
		reorder?.dropPosition ? `sidebar-pane--drop-${reorder.dropPosition}` : '',
		className ?? '',
	]
		.filter(Boolean)
		.join(' ');

	const chevronClassName = [
		'sidebar-pane__chevron',
		collapsed ? 'sidebar-pane__chevron--collapsed' : '',
	]
		.filter(Boolean)
		.join(' ');

	return (
		<section
			id={paneDomId}
			className={rootClassName}
			style={style}
			data-sidebar-pane-id={paneId}
			data-sidebar-panel-id={reorder?.panelId}
		>
			<div
				className="sidebar-pane__header-row"
				data-sidebar-pane-title={title}
				data-sidebar-panel-drop-id={reorder?.panelId}
				ref={headerRef}
			>
				{reorder ? (
					<button
						type="button"
						className="sidebar-pane__drag-handle"
						aria-label={`Reorder ${title} panel`}
						title={`Drag to reorder ${title}`}
						onPointerDown={reorder.onPointerDown}
						onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
							if (event.key === 'ArrowUp') {
								event.preventDefault();
								reorder.onMove(-1);
							} else if (event.key === 'ArrowDown') {
								event.preventDefault();
								reorder.onMove(1);
							}
						}}
					>
						<GripVertical size={13} aria-hidden="true" />
					</button>
				) : null}
				<button
					type="button"
					className="sidebar-pane__header"
					onClick={onToggleCollapsed}
					aria-expanded={!collapsed}
				>
					<ChevronDown
						className={chevronClassName}
						size={14}
						aria-hidden="true"
					/>
					<span className="sidebar-pane__title">{title}</span>
					{typeof count === 'number' ? (
						<span className="sidebar-pane__count">{count}</span>
					) : null}
				</button>
				{accessory || actions ? (
					<div className="sidebar-pane__header-aside">
						{accessory ? (
							<span className="sidebar-pane__accessory">{accessory}</span>
						) : null}
						{actions ? (
							<span className="sidebar-pane__actions">{actions}</span>
						) : null}
					</div>
				) : null}
			</div>
			{collapsed ? null : <div className="sidebar-pane__body">{children}</div>}
		</section>
	);
}
