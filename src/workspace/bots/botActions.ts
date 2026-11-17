import type { BotActionTarget, BotMessageActivity } from '@terminay/protocol';

/** One recorded Terminay action as Chat shows it (ADR-0134). */
export interface BotActionItem {
	readonly kind: 'action';
	readonly key: string;
	readonly text: string;
	readonly at: number;
	readonly activity: BotMessageActivity;
}

/** What revealing a target did: shown, gone, or not reachable from here. */
export type BotActionReveal = 'shown' | 'missing' | 'elsewhere';

/** Rows a collapsed group shows. */
export const VISIBLE_ACTIONS = 3;

/** The rows a group shows and how many earlier ones are hidden. */
export function collapseActions<T>(
	rows: readonly T[],
	expanded: boolean,
): { readonly shown: readonly T[]; readonly hidden: number } {
	if (expanded || rows.length <= VISIBLE_ACTIONS)
		return { shown: rows, hidden: 0 };
	return {
		shown: rows.slice(rows.length - VISIBLE_ACTIONS),
		hidden: rows.length - VISIBLE_ACTIONS,
	};
}

/** A group's key: its first row's, so it is stable as rows arrive or fold. */
export function actionGroupKey(rows: readonly { key: string }[]): string {
	return rows[0]?.key ?? '';
}

/** The link a row offers for its target. */
export function actionLinkLabel(target: BotActionTarget): string {
	switch (target.kind) {
		case 'project':
			return 'Open project';
		case 'terminal':
			return 'Open terminal';
		case 'workflow':
			return 'Open workflow';
		case 'automation':
			return 'Open automation';
		case 'workflowTemplate':
			return 'Open workflow template';
		case 'trigger':
			return 'Open triggers';
		case 'settings':
			return 'Open settings';
	}
}

/** What a row says after a link could not reveal its target. */
export function actionRevealNotice(
	target: BotActionTarget,
	result: BotActionReveal,
): string | undefined {
	if (result === 'shown') return undefined;
	if (result === 'elsewhere') return 'Not available from this window';
	const noun =
		target.kind === 'workflowTemplate'
			? 'workflow template'
			: target.kind === 'workflow'
				? 'terminal'
				: target.kind;
	return `This ${noun} no longer exists`;
}

/** Expanded groups, per bot, kept while the workspace runs. */
const expandedGroups = new Map<string, Set<string>>();
export function isActionGroupExpanded(botId: string, key: string): boolean {
	return expandedGroups.get(botId)?.has(key) ?? false;
}
export function expandActionGroup(botId: string, key: string): void {
	let groups = expandedGroups.get(botId);
	if (groups === undefined) {
		groups = new Set();
		expandedGroups.set(botId, groups);
	}
	groups.add(key);
}
