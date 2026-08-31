import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useRef } from 'react';
import { useLongPress } from '../hooks/useLongPress';
import type { AgentState } from '../types/agentStatus';
import { AgentStatusIndicator } from './AgentStatusIndicator';

export type DockTabChromeProps = {
	title?: string;
	panelId: string;
	isActive: boolean;
	hasCustomColor?: boolean;
	activityState?: 'viewed' | 'recent' | 'unviewed' | 'attention';
	agentState?: AgentState;
	agentNeedsAttention?: boolean;
	agentStatusLabel?: string;
	titleAttribute?: string;
	closeAriaLabel: string;
	style?: CSSProperties;
	onClose: (event: MouseEvent<HTMLButtonElement>) => void;
	onClick?: (event: MouseEvent<HTMLDivElement>) => void;
	onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
	onDoubleClick?: (event: MouseEvent<HTMLDivElement>) => void;
	leading?: ReactNode;
	beforeTitle?: ReactNode;
	afterTitle?: ReactNode;
};

export function DockTabChrome({
	title,
	panelId,
	isActive,
	hasCustomColor = false,
	activityState,
	agentState,
	agentNeedsAttention = false,
	agentStatusLabel,
	titleAttribute,
	closeAriaLabel,
	style,
	onClose,
	onClick,
	onContextMenu,
	onDoubleClick,
	leading,
	beforeTitle,
	afterTitle,
}: DockTabChromeProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const longPress = useLongPress(
		() => {
			const target = rootRef.current;
			if (!target || !onDoubleClick) return;
			onDoubleClick({
				currentTarget: target,
				preventDefault() {},
				stopPropagation() {},
			} as MouseEvent<HTMLDivElement>);
		},
		{ disabled: onDoubleClick === undefined },
	);
	const resolvedTitle = title ?? 'Untitled';

	return (
		<div
			ref={rootRef}
			className={`terminal-tab-content${isActive ? ' terminal-tab-content--active' : ''}`}
			data-panel-id={panelId}
			data-has-color={hasCustomColor}
			data-terminal-activity={activityState}
			title={titleAttribute ?? resolvedTitle}
			style={style}
			onPointerDown={longPress.onPointerDown}
			onPointerMove={longPress.onPointerMove}
			onPointerUp={longPress.onPointerUp}
			onPointerCancel={longPress.onPointerCancel}
			onClick={longPress.bindClick(onClick)}
			onContextMenu={(event) => {
				longPress.onContextMenu(event);
				if (event.defaultPrevented) return;
				onContextMenu?.(event);
			}}
			onDoubleClick={onDoubleClick}
		>
			{leading}
			{beforeTitle}
			{agentState ? (
				<AgentStatusIndicator
					state={agentState}
					needsAttention={agentNeedsAttention}
					label={agentStatusLabel}
				/>
			) : null}
			<span className="terminal-tab-title">{resolvedTitle}</span>
			{afterTitle}
			<button
				type="button"
				className="terminal-tab-close"
				onClick={onClose}
				onPointerDown={(event) => event.stopPropagation()}
				onDoubleClick={(event) => event.stopPropagation()}
				aria-label={closeAriaLabel}
			>
				<svg
					aria-hidden="true"
					width="10"
					height="10"
					viewBox="0 0 12 12"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M9 3L3 9M3 3L9 9"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
		</div>
	);
}
