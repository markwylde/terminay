/**
 * A pull request or issue open as a tab of its own: in Home, or among a
 * folder's tabs. The tab is this device's view of the item; the server does
 * not know it exists, and closing it closes only the view. It shows the same
 * detail, with the same actions, as the list's detail pane.
 */

import type { TerminayForgeClient } from '@terminay/client-core';
import type { IDockviewPanelHeaderProps, IDockviewPanelProps } from 'dockview-react';
import { CircleDot, GitPullRequest } from 'lucide-react';
import { type CSSProperties, createContext, type MouseEvent, type ReactNode, useContext, useEffect, useState } from 'react';
import { DockTabChrome } from '../components/DockTabChrome';
import {
	type ForgeItemTarget,
	type ForgeKind,
	forgeItemPlaceholderTitle,
	forgeItemTabTitle,
	readForgeItemTarget,
} from './forgeModel.ts';
import { type ForgeEnvironment, ForgeDetailPane } from './ForgeViews.tsx';
import { useForgeDetail } from './useForge.ts';

/** The Dockview component and tab component a folder's item tab is drawn with. */
export const FORGE_ITEM_PANEL_COMPONENT = 'forgeItem';
export const FORGE_ITEM_TAB_COMPONENT = 'forgeItemTab';

/** What a folder's item tab carries in its Dockview parameters. */
export type ForgeItemPanelParams = Readonly<{
	forgeItem: ForgeItemTarget;
	color?: string;
	isFocused?: boolean;
}>;

/** The forge client and environment a folder's item tabs draw with. */
export type ForgeTabContextValue = Readonly<{
	client: TerminayForgeClient | undefined;
	environment: ForgeEnvironment;
}>;

export const ForgeTabContext = createContext<ForgeTabContextValue | null>(null);

export function ForgeKindIcon({ kind, size = 14 }: Readonly<{ kind: ForgeKind; size?: number }>) {
	return kind === 'pullRequest' ? (
		<GitPullRequest size={size} aria-hidden="true" />
	) : (
		<CircleDot size={size} aria-hidden="true" />
	);
}

/** One item's detail, filling a tab. It names the tab once the item has loaded. */
export function ForgeItemView({
	client,
	environment,
	target,
	setTitle,
}: Readonly<{
	client: TerminayForgeClient | undefined;
	environment: ForgeEnvironment;
	target: ForgeItemTarget;
	setTitle: (title: string) => void;
}>) {
	const { sourceId, reference } = target;
	const detail = useForgeDetail(client, sourceId, reference, 0);
	// The relative times are worked out when an answer arrives.
	const [now, setNow] = useState(() => Date.now());
	const loadedTitle = detail.detail?.summary.title;
	useEffect(() => {
		setNow(Date.now());
		if (loadedTitle !== undefined) setTitle(forgeItemTabTitle(reference, loadedTitle));
	}, [loadedTitle, detail.loading]);
	let content: ReactNode;
	if (client === undefined)
		content = (
			<div className="forge-failure" role="alert">
				This server does not offer pull requests and issues.
			</div>
		);
	else if (detail.detail === undefined)
		content =
			detail.error === undefined ? (
				<div className="git-panel__message">Loading…</div>
			) : (
				<div className="forge-failure" role="alert">
					{detail.error}{' '}
					<button type="button" className="forge-link" onClick={detail.reload}>
						Retry
					</button>
				</div>
			);
	else
		content = (
			<ForgeDetailPane
				entry={{ sourceId, item: detail.detail.summary, worktrees: detail.worktrees }}
				body={detail.detail.body}
				comments={detail.detail.comments}
				loading={detail.loading}
				{...(detail.error === undefined ? {} : { error: detail.error })}
				environment={environment}
				now={now}
				onReload={detail.reload}
			/>
		);
	return (
		<div className="forge-tab forge-item-tab" data-forge-item-tab={`${reference.kind}:${reference.number}`}>
			{content}
		</div>
	);
}

/** A folder's item tab: its content. */
export function ForgeItemPanel({ api, params }: IDockviewPanelProps<ForgeItemPanelParams>) {
	const context = useContext(ForgeTabContext);
	const target = readForgeItemTarget(params.forgeItem);
	if (target === undefined || context === null)
		return (
			<div className="forge-tab forge-item-tab">
				<div className="forge-failure" role="alert">
					This tab cannot show its item.
				</div>
			</div>
		);
	return (
		<ForgeItemView
			client={context.client}
			environment={context.environment}
			target={target}
			setTitle={(title) => {
				if (api.title !== title) api.setTitle(title);
			}}
		/>
	);
}

/** A folder's item tab: its chip in the strip. */
export function ForgeItemTab(props: IDockviewPanelHeaderProps<ForgeItemPanelParams>) {
	const target = readForgeItemTarget(props.params?.forgeItem);
	const [title, setTitle] = useState(props.api.title ?? '');
	useEffect(() => {
		setTitle(props.api.title ?? '');
		const subscription = props.api.onDidTitleChange((event) => setTitle(event.title));
		return () => subscription.dispose();
	}, [props.api]);
	const style = { '--tab-color': props.params?.color || '#717b85' } as CSSProperties;
	return (
		<DockTabChrome
			title={title || (target === undefined ? '' : forgeItemPlaceholderTitle(target.reference))}
			panelId={props.api.id}
			isActive={props.params?.isFocused === true}
			style={style}
			closeAriaLabel={target?.reference.kind === 'issue' ? 'Close issue tab' : 'Close pull request tab'}
			onClose={(event: MouseEvent) => {
				event.stopPropagation();
				props.api.close();
			}}
			leading={
				<span className="terminal-tab-emoji" aria-hidden="true" style={{ display: 'flex', alignItems: 'center', opacity: 0.8 }}>
					<ForgeKindIcon kind={target?.reference.kind ?? 'pullRequest'} />
				</span>
			}
		/>
	);
}
