/**
 * How an agent is named, wherever it is shown.
 *
 * A snapshot entry carries several candidate names — a provider title, a
 * terminal title, a prompt, a provider display name — and no surface should be
 * choosing between them on its own. An agent called `Claude Code` in the
 * project sidebar and `Isolate *.paged.net tenants` on the dashboard is one
 * agent that looks like two.
 *
 * So the rule lives here and every surface reads it: the Agents pane, which
 * shows one project's agents, and the dashboard, which shows every project's.
 * Nothing here reaches a server or a snapshot store — it is a pure function of
 * one entry plus what the surface happens to know about that entry's terminal.
 */

import type { AgentStatusEntry } from '../types/agentStatus';

/** What the surface knows about an entry beyond the entry itself. */
export type AgentPresentationContext = {
	/** Resolved model name for the entry, when the surface has one. */
	model?: string;
	/** Provider-reported prompt text. */
	prompt?: string;
	/** Title of the terminal the agent was activated in. */
	terminalTitle?: string;
};

export type AgentPresentation = {
	/** Provider · model, with anything already said by the name left out. */
	metadata?: string;
	name: string;
	prompt?: string;
	/** The provider's display name on its own, for surfaces that show it alone. */
	provider: string;
};

export function providerLabel(entry: AgentStatusEntry): string {
	if (entry.providerDisplayName?.trim()) return entry.providerDisplayName.trim();
	const name = entry.provider.split('/').at(-1) ?? entry.provider;
	return name
		.replace(/[-_.]+/gu, ' ')
		.replace(/\b\w/gu, (value) => value.toUpperCase());
}

export function cleanText(value: string | undefined): string | undefined {
	const cleaned = value?.replace(/\s+/g, ' ').trim();
	return cleaned || undefined;
}

/**
 * The entry's own display name, unless it says nothing a reader could not have
 * guessed. `default`, `agent`, `subagent`, and the provider's own name are all
 * placeholders wearing a title's clothes.
 */
export function meaningfulDisplayName(
	entry: AgentStatusEntry,
): string | undefined {
	const displayName = cleanText(entry.displayName);
	if (!displayName) {
		return undefined;
	}
	const normalized = displayName.toLowerCase();
	const provider = providerLabel(entry).toLowerCase();
	return normalized === 'default' ||
		normalized === 'agent' ||
		normalized === 'subagent' ||
		normalized === provider
		? undefined
		: displayName;
}

/** `Terminal`, `Terminal 3` — a name the workspace gave, not one a person did. */
export function isGenericTerminalTitle(value: string | undefined): boolean {
	return /^terminal(?:\s+\d+)?$/i.test(value ?? '');
}

/** Join the parts that are present and not already said, case-insensitively. */
export function joinMetadata(parts: Array<string | undefined>): string {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const part of parts) {
		const cleaned = cleanText(part);
		if (!cleaned) {
			continue;
		}
		const key = cleaned.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(cleaned);
	}
	return result.join(' · ');
}

/** The name an entry falls back to when nothing better was recorded. */
export function fallbackEntryName(entry: AgentStatusEntry): string {
	if (entry.displayName?.trim()) {
		return entry.displayName.trim();
	}
	if (entry.kind === 'subagent') {
		return 'Subagent';
	}
	return providerLabel(entry);
}

/**
 * A root is named by the most specific thing anyone recorded for it: the
 * provider's title, else a terminal name a person chose, else the prompt it is
 * working on, else the provider. A subagent has no terminal of its own, so it
 * is named by its title, its prompt, or its position among its siblings.
 */
export type AgentPresentationOptions = {
	/** The parent's resolved model, so a subagent does not repeat it. */
	parentModel?: string;
	/** The parent's raw provider id, so a subagent does not repeat it. */
	parentProvider?: string;
	/** Position among its siblings, for a subagent with nothing else to go on. */
	siblingIndex?: number;
};

export function resolveAgentPresentation(
	entry: AgentStatusEntry,
	context: AgentPresentationContext = {},
	options: AgentPresentationOptions = {},
): AgentPresentation {
	const provider = providerLabel(entry);
	const displayName = meaningfulDisplayName(entry);
	const prompt = cleanText(context.prompt);
	const terminalTitle = cleanText(context.terminalTitle);

	if (entry.kind === 'root') {
		const customTerminalTitle =
			terminalTitle && !isGenericTerminalTitle(terminalTitle)
				? terminalTitle
				: undefined;
		const name =
			displayName ?? customTerminalTitle ?? prompt ?? fallbackEntryName(entry);
		const metadata = joinMetadata([
			name === terminalTitle ? undefined : terminalTitle,
			name.toLowerCase() === provider.toLowerCase() ? undefined : provider,
			name.toLowerCase() === context.model?.toLowerCase()
				? undefined
				: context.model,
		]);
		return {
			name,
			provider,
			...(metadata ? { metadata } : {}),
			...(prompt && prompt !== name ? { prompt } : {}),
		};
	}

	const name =
		displayName ?? prompt ?? `Subagent ${(options.siblingIndex ?? 0) + 1}`;
	const metadata = joinMetadata([
		options.parentProvider !== entry.provider ? provider : undefined,
		context.model && context.model !== options.parentModel
			? context.model
			: undefined,
	]);
	return {
		name,
		provider,
		...(metadata ? { metadata } : {}),
		...(prompt && prompt !== name ? { prompt } : {}),
	};
}

/** The model name a surface shows for an entry: display name, else the id. */
export function agentModelLabel(entry: AgentStatusEntry): string | undefined {
	return cleanText(entry.model?.displayName ?? entry.model?.id);
}
