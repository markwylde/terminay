/**
 * A session's transcript: messages, collapsible tool entries, and the plan as
 * a checklist. Shared by Chat and the Sessions tab.
 */

import type { BotProfile } from '@terminay/protocol';
import { Check, ChevronRight, Circle, LoaderCircle, X } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { BotAvatar } from './BotAvatar';
import { handleBotMarkdownClick, renderBotMarkdown } from './botMarkdown';
import type { PlanStep, TranscriptItem } from './transcriptModel';

export const BotTranscript = memo(function BotTranscript({
	items,
	bot,
}: Readonly<{
	items: readonly TranscriptItem[];
	bot: Pick<BotProfile, 'name' | 'colour' | 'avatar'>;
}>) {
	const blocks = useMemo(() => turnBlocks(items), [items]);
	return (
		<div className="bots-tx" data-terminay-bot-transcript={items.length}>
			{blocks.map((block) => {
				if (block.kind === 'user')
					return (
						<div className="bots-msg bots-msg--user" key={block.item.key}>
							<span className="bots-msg__you" aria-hidden="true">
								You
							</span>
							<div className="bots-msg__main">
								<div className="bots-msg__who">You</div>
								<div className="bots-msg__body bots-msg__body--plain">
									{block.item.text}
								</div>
							</div>
						</div>
					);
				if (block.kind === 'other') {
					const item = block.item;
					if (item.kind === 'plan')
						return <PlanList key={item.key} steps={item.steps} />;
					if (item.kind === 'truncated')
						return (
							<div
								className="bots-note bots-note--warn"
								key={item.key}
								data-terminay-bot-truncated="true"
							>
								This transcript reached its size limit. Later updates were not
								kept.
							</div>
						);
					return null;
				}
				// One agent turn: a single avatar and name over its thoughts,
				// tool runs and replies, in order.
				return (
					<div className="bots-msg" key={block.key}>
						<BotAvatar bot={bot} size="sm" />
						<div className="bots-msg__main bots-msg__turn">
							<div className="bots-msg__who">{bot.name}</div>
							{block.parts.map((part) => {
								if (Array.isArray(part))
									return part.length === 1 ? (
										<ToolEntry key={part[0]!.key} item={part[0]!} />
									) : (
										<ToolGroup key={part[0]!.key} tools={part} />
									);
								if (part.kind === 'thought')
									return (
										<details className="bots-thought" key={part.key}>
											<summary>Thinking</summary>
											<div>{part.text}</div>
										</details>
									);
								if (part.kind === 'agent')
									return <AgentText key={part.key} text={part.text} />;
								return null;
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
});

type AgentPart = TranscriptItem | ToolItem[];
type TurnBlock =
	| { kind: 'user'; item: TranscriptItem & { kind: 'user' } }
	| { kind: 'agent'; key: string; parts: AgentPart[] }
	| { kind: 'other'; item: TranscriptItem };

/** Groups the flat transcript into turns. Answered permission echoes are
 * dropped (a pending one is asked above the composer); runs of tool calls
 * fold into one line. */
function turnBlocks(items: readonly TranscriptItem[]): TurnBlock[] {
	const blocks: TurnBlock[] = [];
	for (const item of items) {
		if (item.kind === 'permission') continue;
		if (item.kind === 'user') {
			blocks.push({ kind: 'user', item });
			continue;
		}
		if (item.kind === 'plan' || item.kind === 'truncated') {
			blocks.push({ kind: 'other', item });
			continue;
		}
		let last = blocks[blocks.length - 1];
		if (last?.kind !== 'agent') {
			last = { kind: 'agent', key: item.key, parts: [] };
			blocks.push(last);
		}
		const tail = last.parts[last.parts.length - 1];
		if (item.kind === 'tool') {
			if (Array.isArray(tail)) tail.push(item);
			else last.parts.push([item]);
		} else last.parts.push(item);
	}
	return blocks;
}

function AgentText({ text }: Readonly<{ text: string }>) {
	const html = useMemo(() => renderBotMarkdown(text), [text]);
	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: delegated link clicks; links stay keyboard-focusable
		<div
			className="bots-msg__body bots-md"
			onClick={handleBotMarkdownClick}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it with html disabled escapes raw HTML
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

type ToolItem = TranscriptItem & { kind: 'tool' };

function ToolGroup({ tools }: Readonly<{ tools: readonly ToolItem[] }>) {
	const [open, setOpen] = useState(false);
	const running = tools.some(
		(t) => t.status !== 'completed' && t.status !== 'failed',
	);
	const failed = tools.filter((t) => t.status === 'failed').length;
	const current = running
		? tools.find((t) => t.status !== 'completed' && t.status !== 'failed')
		: undefined;
	return (
		<div className="bots-tool bots-tool--group" data-terminay-bot-tool-group={tools.length}>
			<button
				type="button"
				className="bots-tool__head"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronRight
					size={13}
					aria-hidden="true"
					className={open ? 'bots-rot90' : ''}
				/>
				{running ? (
					<LoaderCircle size={13} aria-hidden="true" className="bots-spin" />
				) : failed ? (
					<X size={13} aria-hidden="true" className="bots-tool__failed" />
				) : (
					<Check size={13} aria-hidden="true" className="bots-tool__done" />
				)}
				<span className="bots-tool__title">
					{running ? current?.title : `Used ${tools.length} tools`}
					{!running && failed ? ` · ${failed} failed` : ''}
				</span>
			</button>
			{open ? (
				<div className="bots-tool__group">
					{tools.map((tool) => (
						<ToolEntry key={tool.key} item={tool} />
					))}
				</div>
			) : null}
		</div>
	);
}

function ToolEntry({
	item,
}: Readonly<{ item: TranscriptItem & { kind: 'tool' } }>) {
	const [open, setOpen] = useState(false);
	const icon =
		item.status === 'completed' ? (
			<Check size={13} aria-hidden="true" />
		) : item.status === 'failed' ? (
			<X size={13} aria-hidden="true" />
		) : (
			<LoaderCircle size={13} aria-hidden="true" className="bots-spin" />
		);
	const hasDetail = item.input.length > 0 || item.output.length > 0;
	return (
		<div
			className={`bots-tool bots-tool--${item.status}`}
			data-terminay-bot-tool={item.toolCallId}
			data-terminay-bot-tool-status={item.status}
		>
			<button
				type="button"
				className="bots-tool__head"
				aria-expanded={open}
				disabled={!hasDetail}
				onClick={() => setOpen((value) => !value)}
			>
				<ChevronRight
					size={13}
					aria-hidden="true"
					className={open ? 'bots-rot90' : ''}
				/>
				{icon}
				<span className="bots-tool__title">{item.title}</span>
			</button>
			{open ? (
				<div className="bots-tool__body">
					{item.input.length > 0 ? (
						<pre className="bots-tool__out bots-mono">{item.input}</pre>
					) : null}
					{item.output.length > 0 ? (
						<pre className="bots-tool__out bots-mono">{item.output}</pre>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function PlanList({ steps }: Readonly<{ steps: readonly PlanStep[] }>) {
	if (steps.length === 0) return null;
	const done = steps.filter((step) => step.status === 'completed').length;
	return (
		<div className="bots-card bots-plan" data-terminay-bot-plan={done}>
			<div className="bots-lab">
				Plan · {done} of {steps.length}
			</div>
			<ul>
				{steps.map((step, index) => (
					<li
						// Plans are replaced whole; position is the step's identity.
						key={index}
						className={`bots-plan__step bots-plan__step--${step.status}`}
					>
						{step.status === 'completed' ? (
							<Check size={13} aria-hidden="true" />
						) : step.status === 'in_progress' ? (
							<LoaderCircle
								size={13}
								aria-hidden="true"
								className="bots-spin"
							/>
						) : (
							<Circle size={13} aria-hidden="true" />
						)}
						<span>{step.content}</span>
					</li>
				))}
			</ul>
		</div>
	);
}
