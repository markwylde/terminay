import type { IDockviewPanelHeaderProps } from 'dockview';
import { CSSProperties, MouseEvent, useMemo } from 'react';
import { DockTabChrome } from '../DockTabChrome';
import type { FolderPanelInstanceParams } from './types';
import './folderViewer.css';

const DEFAULT_TAB_COLOR = '#0a0a0a';

export function FolderTab(
	props: IDockviewPanelHeaderProps<FolderPanelInstanceParams>,
) {
	const isFocused = props.params?.isFocused === true;
	const color = props.params?.color;
	const emoji = props.params?.emoji;
	const hasCustomColor =
		typeof color === 'string' && color !== DEFAULT_TAB_COLOR;
	const style = useMemo(() => {
		return {
			'--tab-color': color || '#717b85',
		} as CSSProperties;
	}, [color]);
	const onClose = (event: MouseEvent) => {
		event.stopPropagation();
		props.api.close();
	};
	const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();
		const customEvent = new CustomEvent('terminay-edit-terminal', {
			bubbles: true,
			detail: { panelId: props.api.id },
		});
		event.currentTarget.dispatchEvent(customEvent);
	};

	return (
		<DockTabChrome
			title={props.api.title}
			panelId={props.api.id}
			isActive={isFocused}
			hasCustomColor={hasCustomColor}
			titleAttribute="Double-click to edit tab"
			style={style}
			onDoubleClick={onDoubleClick}
			closeAriaLabel="Close folder tab"
			onClose={onClose}
			leading={
				emoji ? (
					<span className="terminal-tab-emoji">{emoji}</span>
				) : (
					<span className="terminal-tab-emoji" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
						</svg>
					</span>
				)
			}
		/>
	);
}
