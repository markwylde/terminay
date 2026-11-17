import type { BotActionTarget } from '@terminay/protocol';
import {
	Check,
	Clock,
	Folder,
	LayoutTemplate,
	ListChecks,
	type LucideIcon,
	Settings,
	SquareTerminal,
	Wrench,
	X,
	Zap,
} from 'lucide-react';
import { useState } from 'react';
import { messageTime } from './BotTranscript';
import {
	actionGroupKey,
	actionLinkLabel,
	actionRevealNotice,
	type BotActionItem,
	type BotActionReveal,
	collapseActions,
	expandActionGroup,
	isActionGroupExpanded,
} from './botActions';

const ICONS: Record<BotActionTarget['kind'], LucideIcon> = {
	project: Folder,
	terminal: SquareTerminal,
	workflow: ListChecks,
	automation: Zap,
	workflowTemplate: LayoutTemplate,
	trigger: Clock,
	settings: Settings,
};

export type RevealAction = (
	target: BotActionTarget,
) => Promise<BotActionReveal>;

/** A run of consecutive Terminay actions in Chat (ADR-0134). */
export function BotActionGroup({
	botId,
	items,
	onReveal,
}: Readonly<{
	botId: string;
	items: readonly BotActionItem[];
	onReveal?: RevealAction;
}>) {
	const key = actionGroupKey(items);
	const [expanded, setExpanded] = useState(() =>
		isActionGroupExpanded(botId, key),
	);
	const { shown, hidden } = collapseActions(items, expanded);
	return (
		<div className="bots-actions" data-terminay-bot-actions={items.length}>
			{hidden > 0 ? (
				<button
					type="button"
					className="bots-actions__more"
					onClick={() => {
						expandActionGroup(botId, key);
						setExpanded(true);
					}}
				>
					Show {hidden} earlier action{hidden === 1 ? '' : 's'}
				</button>
			) : null}
			<ul className="bots-actions__list" aria-label="Terminay actions">
				{shown.map((item) => (
					<BotActionRow key={item.key} item={item} onReveal={onReveal} />
				))}
			</ul>
		</div>
	);
}

function BotActionRow({
	item,
	onReveal,
}: Readonly<{ item: BotActionItem; onReveal?: RevealAction }>) {
	const { activity } = item;
	const [notice, setNotice] = useState<string>();
	const [busy, setBusy] = useState(false);
	const Icon = activity.target ? ICONS[activity.target.kind] : Wrench;
	const failed = activity.outcome === 'failed';
	const when = new Date(item.at);
	const reveal = async () => {
		const target = activity.target;
		if (!target || !onReveal || busy) return;
		setBusy(true);
		try {
			setNotice(actionRevealNotice(target, await onReveal(target)));
		} catch {
			setNotice('Could not open it');
		} finally {
			setBusy(false);
		}
	};
	return (
		<li
			className={`bots-action${failed ? ' bots-action--failed' : ''}`}
			data-terminay-bot-action={activity.tool}
			data-terminay-bot-action-outcome={activity.outcome}
			title={`${item.text} · ${when.toLocaleString(undefined, {
				dateStyle: 'full',
				timeStyle: 'medium',
			})}`}
		>
			<Icon className="bots-action__icon" size={14} aria-hidden="true" />
			<span className="bots-action__text">
				{item.text}
				{failed && activity.reason ? (
					<span className="bots-action__reason">
						{' · '}
						{activity.reason}
					</span>
				) : null}
			</span>
			{failed ? (
				<X
					className="bots-action__mark bots-action__mark--failed"
					size={13}
					aria-label="Failed"
				/>
			) : (
				<Check
					className="bots-action__mark bots-action__mark--done"
					size={13}
					aria-label="Done"
				/>
			)}
			{activity.count > 1 ? (
				<span
					className="bots-action__count"
					data-terminay-bot-action-count={activity.count}
				>
					×{activity.count}
				</span>
			) : null}
			<time className="bots-action__time" dateTime={when.toISOString()}>
				{messageTime(item.at)}
			</time>
			{activity.target && onReveal ? (
				notice ? (
					<span className="bots-action__notice" role="status">
						{notice}
					</span>
				) : (
					<button
						type="button"
						className="bots-action__link"
						onClick={() => void reveal()}
						disabled={busy}
					>
						{actionLinkLabel(activity.target)}
					</button>
				)
			) : null}
		</li>
	);
}
