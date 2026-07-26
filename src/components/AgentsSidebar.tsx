import { type CSSProperties, memo, useMemo } from 'react';
import type { AgentProvider, AgentStatusEntry } from '../types/agentStatus';
import { AgentStatusIndicator } from './AgentStatusIndicator';
import './AgentsSidebar.css';

export type AgentsSidebarItem = {
	entry: AgentStatusEntry;
	projectId: string;
	model?: string;
	prompt?: string;
};

export type AgentsSidebarProps = {
	projectId: string;
	agents: readonly AgentsSidebarItem[];
	onActivateTerminal: (
		activationTerminalSessionId: string,
		entry: AgentStatusEntry,
	) => void;
	emptyLabel?: string;
	className?: string;
};

type AgentTreeNode = {
	item: AgentsSidebarItem;
	children: AgentTreeNode[];
};

const PROVIDER_LABELS: Record<AgentProvider, string> = {
	codex: 'Codex',
	'claude-code': 'Claude Code',
};

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

function getEntryName(entry: AgentStatusEntry): string {
	if (entry.displayName?.trim()) {
		return entry.displayName.trim();
	}

	if (entry.kind === 'subagent') {
		return 'Subagent';
	}

	return PROVIDER_LABELS[entry.provider];
}

function AgentRow({
	node,
	depth,
	onActivateTerminal,
}: {
	node: AgentTreeNode;
	depth: number;
	onActivateTerminal: AgentsSidebarProps['onActivateTerminal'];
}) {
	const { entry } = node.item;
	const name = getEntryName(entry);
	const provider = PROVIDER_LABELS[entry.provider];
	const metadata = node.item.model
		? `${provider} · ${node.item.model}`
		: provider;

	return (
		<li className="agents-sidebar__tree-item">
			<button
				type="button"
				className={`agents-sidebar__agent${entry.unread ? ' agents-sidebar__agent--unread' : ''}`}
				data-agent-state={entry.state}
				style={{ '--agents-sidebar-depth': depth } as CSSProperties}
				onClick={() =>
					onActivateTerminal(entry.activationTerminalSessionId, entry)
				}
				aria-label={`Focus ${name} terminal`}
				title={
					node.item.prompt
						? `${name}\n${metadata}\n${node.item.prompt}`
						: `${name}\n${metadata}`
				}
			>
				<span className="agents-sidebar__tree-guide" aria-hidden="true" />
				<AgentStatusIndicator state={entry.state} showIdle />
				<span className="agents-sidebar__content">
					<span className="agents-sidebar__heading">
						<span className="agents-sidebar__name">{name}</span>
						<span className="agents-sidebar__state">{entry.state}</span>
					</span>
					<span className="agents-sidebar__metadata">{metadata}</span>
					{node.item.prompt ? (
						<span className="agents-sidebar__prompt">{node.item.prompt}</span>
					) : null}
				</span>
			</button>
			{node.children.length > 0 ? (
				<ul className="agents-sidebar__tree">
					{node.children.map((child) => (
						<AgentRow
							key={child.item.entry.entryId}
							node={child}
							depth={depth + 1}
							onActivateTerminal={onActivateTerminal}
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
	emptyLabel = 'No agents in this project',
	className,
}: AgentsSidebarProps) {
	const tree = useMemo(
		() =>
			buildAgentTree(agents.filter((agent) => agent.projectId === projectId)),
		[agents, projectId],
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
				{tree.map((root) => (
					<AgentRow
						key={root.item.entry.entryId}
						node={root}
						depth={0}
						onActivateTerminal={onActivateTerminal}
					/>
				))}
			</ul>
		</nav>
	);
});
