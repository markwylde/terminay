import type { IDockviewPanelHeaderProps } from 'dockview';
import { MouseEvent } from 'react';
import { DockTabChrome } from '../DockTabChrome';
import type { FolderPanelInstanceParams } from './types';
import './folderViewer.css';

export function FolderTab(
	props: IDockviewPanelHeaderProps<FolderPanelInstanceParams>,
) {
	const isFocused = props.params?.isFocused === true;
	const onClose = (event: MouseEvent) => {
		event.stopPropagation();
		props.api.close();
	};

	return (
		<DockTabChrome
			title={props.api.title}
			panelId={props.api.id}
			isActive={isFocused}
			titleAttribute={props.params?.folderPath ?? props.api.title}
			closeAriaLabel="Close folder tab"
			onClose={onClose}
			leading={
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
			}
		/>
	);
}
