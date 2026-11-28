/**
 * A server desktop tab among a project folder's tabs: its panel and its chip.
 * The tab is this device's alone; see desktopTabs.ts.
 */

import type {
	IDockviewPanelHeaderProps,
	IDockviewPanelProps,
} from 'dockview-react';
import { Monitor } from 'lucide-react';
import {
	type CSSProperties,
	type MouseEvent,
	useEffect,
	useState,
} from 'react';
import { DockTabChrome } from '../../components/DockTabChrome';
import { type DesktopTabPlace, desktopTabs } from './desktopTabs.ts';
import { useServerDesktopHub } from './ServerDesktopHub';
import { ServerDesktopTabView } from './ServerDesktopSurfaces';
import { serverDesktopTitle } from './serverDesktopModel.ts';

/** What a folder's desktop tab carries in its Dockview parameters. */
export type ServerDesktopPanelParams = Readonly<{
	tabId: string;
	serverId: string;
	place: DesktopTabPlace;
	color?: string;
	isFocused?: boolean;
}>;

export function ServerDesktopPanel({
	api,
	params,
}: IDockviewPanelProps<ServerDesktopPanelParams>) {
	const [isVisible, setIsVisible] = useState(api.isVisible);
	const [isActive, setIsActive] = useState(api.isActive);
	const hub = useServerDesktopHub();
	const label =
		hub !== null && hub.serverId === params.serverId
			? hub.serverLabel
			: undefined;
	useEffect(() => {
		const title = label === undefined ? 'Desktop' : serverDesktopTitle(label);
		if (api.title !== title) api.setTitle(title);
	}, [api, label]);
	useEffect(() => {
		setIsVisible(api.isVisible);
		setIsActive(api.isActive);
		const visibility = api.onDidVisibilityChange((event) =>
			setIsVisible(event.isVisible),
		);
		const active = api.onDidActiveChange((event) =>
			setIsActive(event.isActive),
		);
		return () => {
			visibility.dispose();
			active.dispose();
		};
	}, [api]);
	return (
		<ServerDesktopTabView
			tabId={params.tabId}
			serverId={params.serverId}
			location={params.place}
			isVisible={isVisible}
			isActive={isActive}
			closeHere={() => {
				desktopTabs.remove(params.tabId);
				api.close();
			}}
		/>
	);
}

export function ServerDesktopTabChip(
	props: IDockviewPanelHeaderProps<ServerDesktopPanelParams>,
) {
	const style = {
		'--tab-color': props.params?.color || '#717b85',
	} as CSSProperties;
	return (
		<DockTabChrome
			title={props.api.title ?? 'Desktop'}
			panelId={props.api.id}
			isActive={props.params?.isFocused === true}
			style={style}
			closeAriaLabel="Close desktop tab"
			onClose={(event: MouseEvent) => {
				event.stopPropagation();
				if (props.params?.tabId !== undefined)
					desktopTabs.remove(props.params.tabId);
				props.api.close();
			}}
			leading={
				<span
					className="terminal-tab-emoji"
					aria-hidden="true"
					style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}
				>
					<Monitor size={14} />
				</span>
			}
		/>
	);
}
