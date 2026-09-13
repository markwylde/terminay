import { ChevronDown } from 'lucide-react';
import { memo, useMemo } from 'react';
import { resolveAgentPresentation } from '../agents/agentPresentation';
import type { AgentStatusEntry } from '../types/agentStatus';
import { AgentStatusIndicator } from './AgentStatusIndicator';
import './AgentsSidebar.css';

export type AgentsSidebarItem = {
	entry: AgentStatusEntry;
	projectId: string;
	model?: string;
	prompt?: string;
	terminalTitle?: string;
};

export type AgentsSidebarProps = {
	projectId: string;
	agents: readonly AgentsSidebarItem[];
	onActivateTerminal: (
		activationTerminalSessionId: string,
		entry: AgentStatusEntry,
	) => void;
	/** A server-owned unread entry is acknowledged after its terminal is focused. */
	onAcknowledgeEntry?: (entryId: string) => void;
	expandedEntryIds: readonly string[];
	onToggleEntryExpanded: (entryId: string) => void;
	emptyLabel?: string;
	className?: string;
};

type AgentTreeNode = {
	item: AgentsSidebarItem;
	children: AgentTreeNode[];
};

/**
 * Keep navigation and acknowledgement tied to the exact snapshot entry that
 * the user selected. The server remains authoritative; this only forwards the
 * entry id through the renderer/preload boundary.
 */
export function activateAgentFromSnapshot(
	entry: AgentStatusEntry,
	onActivateTerminal: AgentsSidebarProps['onActivateTerminal'],
	onAcknowledgeEntry?: AgentsSidebarProps['onAcknowledgeEntry'],
): void {
	onActivateTerminal(entry.activationTerminalSessionId, entry);
	if (entry.unread) {
		onAcknowledgeEntry?.(entry.entryId);
	}
}

function buildAgentTree(items: readonly AgentsSidebarItem[]): AgentTreeNode[] {
	const nodes = new Map<string, AgentTreeNode>();

	for (const item of items) {
		nodes.set(item.entry.entryId, { item, children: [] });
	}

	const roots: AgentTreeNode[] = [];

	for (const item of items) {
		const node = nodes.get(item.entry.entryId);
		if (!node) {
			continue;
		}

		if (item.entry.kind === 'subagent') {
			const parent = nodes.get(item.entry.parentEntryId);
			if (parent) {
				parent.children.push(node);
				continue;
			}
		}

		roots.push(node);
	}

	return roots;
}

/**
 * The sidebar's view of the shared naming rule: it knows the terminal title
 * and the parent item, and hands both to the resolver every surface uses.
 */
function getPresentation(
	node: AgentTreeNode,
	siblingIndex: number,
	parent?: AgentsSidebarItem,
) {
	return resolveAgentPresentation(
		node.item.entry,
		{
			...(node.item.model === undefined ? {} : { model: node.item.model }),
			...(node.item.prompt === undefined ? {} : { prompt: node.item.prompt }),
			...(node.item.terminalTitle === undefined
				? {}
				: { terminalTitle: node.item.terminalTitle }),
		},
		{
			...(parent?.model === undefined ? {} : { parentModel: parent.model }),
			...(parent === undefined
				? {}
				: { parentProvider: parent.entry.provider }),
			siblingIndex,
		},
	);
}

function AgentRow({
	node,
	depth,
	siblingIndex,
	parent,
	expandedEntryIds,
	onToggleEntryExpanded,
	onActivateTerminal,
	onAcknowledgeEntry,
}: {
	node: AgentTreeNode;
	depth: number;
	siblingIndex: number;
	parent?: AgentsSidebarItem;
	expandedEntryIds: ReadonlySet<string>;
	onToggleEntryExpanded: AgentsSidebarProps['onToggleEntryExpanded'];
	onActivateTerminal: AgentsSidebarProps['onActivateTerminal'];
	onAcknowledgeEntry: AgentsSidebarProps['onAcknowledgeEntry'];
}) {
	const { entry } = node.item;
	const { metadata, name, prompt } = getPresentation(
		node,
		siblingIndex,
		parent,
	);
	const childrenExpanded = expandedEntryIds.has(entry.entryId);
	const childCount = node.children.length;
	const childGroupId = `agents-sidebar-subagents-${entry.entryId}`;

	return (
		<li className="agents-sidebar__tree-item">
			<div
				className={`agents-sidebar__row${entry.unread ? ' agents-sidebar__row--unread' : ''}`}
				data-agent-state={entry.state}
				style={{ paddingLeft: `${10 + depth * 12}px` }}
			>
				{childCount > 0 ? (
					<button
						type="button"
						className="agents-sidebar__disclosure"
						aria-label={`${childrenExpanded ? 'Collapse' : 'Expand'} ${childCount} subagent${childCount === 1 ? '' : 's'} for ${name}`}
						aria-expanded={childrenExpanded}
						aria-controls={childGroupId}
						title={`${childrenExpanded ? 'Collapse' : 'Expand'} ${childCount} subagent${childCount === 1 ? '' : 's'}`}
						onClick={() => onToggleEntryExpanded(entry.entryId)}
					>
						<ChevronDown
							className={`agents-sidebar__disclosure-chevron${childrenExpanded ? '' : ' agents-sidebar__disclosure-chevron--collapsed'}`}
							size={14}
							aria-hidden="true"
						/>
					</button>
				) : (
					<span
						className="agents-sidebar__disclosure-spacer"
						aria-hidden="true"
					/>
				)}
				<button
					type="button"
					className="agents-sidebar__agent"
					data-agent-state={entry.state}
					onClick={() =>
						activateAgentFromSnapshot(
							entry,
							onActivateTerminal,
							onAcknowledgeEntry,
						)
					}
					aria-label={`Focus ${name} terminal`}
					title={[name, metadata, prompt].filter(Boolean).join('\n')}
				>
					<AgentStatusIndicator state={entry.state} showIdle size="medium" />
					<span className="agents-sidebar__content">
						<span className="agents-sidebar__heading">
							<span className="agents-sidebar__name">{name}</span>
							{childCount > 0 ? (
								<span className="agents-sidebar__child-count">
									{childCount}
								</span>
							) : null}
							<span className="agents-sidebar__state">{entry.state}</span>
						</span>
						{metadata ? (
							<span className="agents-sidebar__metadata">{metadata}</span>
						) : null}
						{prompt ? (
							<span className="agents-sidebar__prompt">{prompt}</span>
						) : null}
					</span>
				</button>
			</div>
			{childCount > 0 && childrenExpanded ? (
				<ul id={childGroupId} className="agents-sidebar__tree">
					{node.children.map((child, index) => (
						<AgentRow
							key={child.item.entry.entryId}
							node={child}
							depth={depth + 1}
							siblingIndex={index}
							parent={node.item}
							expandedEntryIds={expandedEntryIds}
							onToggleEntryExpanded={onToggleEntryExpanded}
							onActivateTerminal={onActivateTerminal}
							onAcknowledgeEntry={onAcknowledgeEntry}
						/>
					))}
				</ul>
			) : null}
		</li>
	);
}

export const AgentsSidebar = memo(function AgentsSidebar({
	projectId,
	agents,
	onActivateTerminal,
	expandedEntryIds,
	onToggleEntryExpanded,
	emptyLabel = 'No agents in this project',
	className,
	onAcknowledgeEntry,
}: AgentsSidebarProps) {
	const tree = useMemo(
		() =>
			buildAgentTree(agents.filter((agent) => agent.projectId === projectId)),
		[agents, projectId],
	);
	const expandedEntries = useMemo(
		() => new Set(expandedEntryIds),
		[expandedEntryIds],
	);

	const classes = ['agents-sidebar', className].filter(Boolean).join(' ');

	if (tree.length === 0) {
		return (
			<div className={`${classes} agents-sidebar--empty`}>
				<p className="agents-sidebar__empty">{emptyLabel}</p>
			</div>
		);
	}

	return (
		<nav className={classes} aria-label="Project agents">
			<ul className="agents-sidebar__tree agents-sidebar__tree--root">
				{tree.map((root, index) => (
					<AgentRow
						key={root.item.entry.entryId}
						node={root}
						depth={0}
						siblingIndex={index}
						expandedEntryIds={expandedEntries}
						onToggleEntryExpanded={onToggleEntryExpanded}
						onActivateTerminal={onActivateTerminal}
						onAcknowledgeEntry={onAcknowledgeEntry}
					/>
				))}
			</ul>
		</nav>
	);
});
