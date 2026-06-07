import { ChevronDown } from 'lucide-react';
import type { JSX, ReactNode } from 'react';
import './sidebar.css';

export type SidebarPaneProps = {
	title: string;
	collapsed: boolean;
	onToggleCollapsed: () => void;
	count?: number;
	accessory?: ReactNode;
	/** Interactive controls shown at the right of the header, outside the collapse toggle. */
	actions?: ReactNode;
	className?: string;
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
		children,
	} = props;

	const rootClassName = [
		'sidebar-pane',
		collapsed ? 'sidebar-pane--collapsed' : '',
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
		<section className={rootClassName}>
			<div className="sidebar-pane__header-row">
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
