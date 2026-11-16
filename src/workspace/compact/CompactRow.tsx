/**
 * The row anatomy every compact section page uses: a leading mark, a one-line
 * title with a trailing age or count, one detail line, and optional chips.
 * Activation covers the row's main area; anything at its end (a switch, a
 * more control) sits outside that button so it is never nested in it.
 */

import type { ReactNode } from 'react';
// The shared status colours and breathing keyframes the row marks use.
import '../../components/AgentStatusIndicator.css';

export type CompactTone = 'attention' | 'working' | 'done' | 'idle' | 'muted';

export function StatusMark({
	tone,
	label,
}: Readonly<{ tone: CompactTone; label?: string }>) {
	return label === undefined ? (
		<span className={`crow__mark crow__mark--${tone}`} aria-hidden="true" />
	) : (
		<span
			className={`crow__mark crow__mark--${tone}`}
			role="img"
			aria-label={label}
		/>
	);
}

export function CompactChip({
	tone,
	children,
	title,
}: Readonly<{
	tone?: 'attention' | 'working' | 'done' | 'info' | 'merged';
	children: ReactNode;
	title?: string;
}>) {
	return (
		<span
			className={`crow__chip${tone === undefined ? '' : ` crow__chip--${tone}`}`}
			title={title}
		>
			{children}
		</span>
	);
}

export function CompactGroupHeader({
	label,
	count,
	color,
}: Readonly<{ label: ReactNode; count?: ReactNode; color?: string }>) {
	return (
		<div className="crow-group" data-compact-group="true">
			{color === undefined ? null : (
				<span
					className="crow-group__swatch"
					style={{ background: color }}
					aria-hidden="true"
				/>
			)}
			<span className="crow-group__label">{label}</span>
			{count === undefined ? null : (
				<span className="crow-group__count">{count}</span>
			)}
		</div>
	);
}

export function CompactRow({
	lead,
	title,
	trailing,
	detail,
	detailTone,
	meta,
	chips,
	aside,
	onActivate,
	activateLabel,
	isDimmed = false,
	variant,
	rowProps,
}: Readonly<{
	lead: ReactNode;
	title: ReactNode;
	trailing?: ReactNode;
	detail?: ReactNode;
	detailTone?: 'attention';
	meta?: ReactNode;
	chips?: ReactNode;
	/** At the row's end, outside the activation area. */
	aside?: ReactNode;
	onActivate?: () => void;
	activateLabel?: string;
	isDimmed?: boolean;
	variant?: 'avatar';
	rowProps?: Record<`data-${string}`, string | undefined>;
}>) {
	const body = (
		<>
			<span className="crow__lead">{lead}</span>
			<span className="crow__body">
				<span className="crow__title-line">
					<span className="crow__title">{title}</span>
					{trailing === undefined ? null : (
						<span className="crow__trailing">{trailing}</span>
					)}
				</span>
				{detail === undefined ? null : (
					<span
						className={`crow__detail${detailTone === 'attention' ? ' crow__detail--attention' : ''}`}
					>
						{detail}
					</span>
				)}
				{meta === undefined ? null : <span className="crow__meta">{meta}</span>}
				{chips === undefined ? null : (
					<span className="crow__chips">{chips}</span>
				)}
			</span>
		</>
	);
	return (
		<div
			className={`crow${isDimmed ? ' crow--dimmed' : ''}${variant === 'avatar' ? ' crow--avatar' : ''}`}
			{...rowProps}
		>
			{onActivate === undefined ? (
				<div className="crow__main">{body}</div>
			) : (
				<button
					type="button"
					className="crow__main"
					onClick={onActivate}
					aria-label={activateLabel}
				>
					{body}
				</button>
			)}
			{aside === undefined ? null : <div className="crow__aside">{aside}</div>}
		</div>
	);
}

export function CompactEmpty({
	icon,
	title,
	children,
	action,
}: Readonly<{
	icon?: ReactNode;
	title: ReactNode;
	children?: ReactNode;
	action?: Readonly<{ label: string; onActivate: () => void }>;
}>) {
	return (
		<div className="cempty" data-compact-empty="true">
			{icon === undefined ? null : (
				<div className="cempty__icon" aria-hidden="true">
					{icon}
				</div>
			)}
			<p className="cempty__title">{title}</p>
			{children === undefined ? null : (
				<p className="cempty__body">{children}</p>
			)}
			{action === undefined ? null : (
				<button
					type="button"
					className="cempty__action"
					onClick={action.onActivate}
					data-home-clear-filters="true"
				>
					{action.label}
				</button>
			)}
		</div>
	);
}

/** A card at the end of a list that opens something: the engine, a sub-list. */
export function CompactLinkRow({
	icon,
	label,
	detail,
	count,
	onActivate,
	dataAttr,
}: Readonly<{
	icon: ReactNode;
	label: ReactNode;
	detail?: ReactNode;
	count?: ReactNode;
	onActivate: () => void;
	dataAttr: string;
}>) {
	return (
		<button
			type="button"
			className="clink"
			onClick={onActivate}
			{...{ [dataAttr]: 'true' }}
		>
			<span className="clink__icon" aria-hidden="true">
				{icon}
			</span>
			<span className="clink__body">
				<span className="clink__label">{label}</span>
				{detail === undefined ? null : (
					<span className="clink__detail">{detail}</span>
				)}
			</span>
			{count === undefined ? null : (
				<span className="clink__count">{count}</span>
			)}
			<span className="clink__chevron" aria-hidden="true">
				›
			</span>
		</button>
	);
}
