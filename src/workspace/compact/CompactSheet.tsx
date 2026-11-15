/**
 * The View options sheet (ADR-0125): a compact drawer from the bottom edge,
 * drawn through `CompactEdgeDrawer`. Options apply as they change; Done only
 * closes. The building blocks below keep every section's sheet alike.
 */

import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { CompactEdgeDrawer } from '../CompactEdgeDrawer';

export function CompactSheet({
	title,
	canReset,
	onReset,
	onClose,
	children,
}: Readonly<{
	title: string;
	canReset: boolean;
	onReset: () => void;
	onClose: () => void;
	children: ReactNode;
}>) {
	return (
		<CompactEdgeDrawer
			edge="bottom"
			label={title}
			onPressOutside={onClose}
			scrimClassName="csheet-scrim"
			className="csheet"
			drawerProps={{ 'data-compact-sheet': 'true' }}
		>
			<div className="csheet__grab" aria-hidden="true" />
			<div className="csheet__head">
				<h2 className="csheet__title">{title}</h2>
				{canReset ? (
					<button
						type="button"
						className="csheet__reset"
						onClick={onReset}
						data-compact-sheet-reset="true"
					>
						Reset
					</button>
				) : null}
			</div>
			<div className="csheet__body">{children}</div>
			<div className="csheet__foot">
				<button
					type="button"
					className="csheet__done"
					onClick={onClose}
					data-compact-sheet-done="true"
				>
					Done
				</button>
			</div>
		</CompactEdgeDrawer>
	);
}

export function SheetSection({
	label,
	children,
}: Readonly<{ label: string; children: ReactNode }>) {
	return (
		<section className="csheet__section" aria-label={label}>
			<h3 className="csheet__label">{label}</h3>
			{children}
		</section>
	);
}

export function SheetSegment<V extends string>({
	label,
	options,
	value,
	onChange,
}: Readonly<{
	label: string;
	options: readonly Readonly<{ value: V; label: string }>[];
	value: V;
	onChange: (value: V) => void;
}>) {
	return (
		<SheetSection label={label}>
			<div className="csheet__segment" role="radiogroup" aria-label={label}>
				{options.map((option) => (
					<button
						key={option.value}
						type="button"
						role="radio"
						aria-checked={option.value === value}
						onClick={() => onChange(option.value)}
						data-compact-sheet-option={`${label}:${option.value}`}
					>
						{option.label}
					</button>
				))}
			</div>
		</SheetSection>
	);
}

export function SheetToggle({
	label,
	hint,
	checked,
	onChange,
}: Readonly<{
	label: string;
	hint?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}>) {
	return (
		<div className="csheet__item">
			<label className="csheet__row">
				<span className="csheet__row-label">{label}</span>
				<input
					type="checkbox"
					role="switch"
					className="csheet__switch"
					checked={checked}
					onChange={(event) => onChange(event.target.checked)}
				/>
			</label>
			{hint === undefined ? null : <p className="csheet__hint">{hint}</p>}
		</div>
	);
}

export function SheetSelect<V extends string>({
	label,
	value,
	options,
	onChange,
}: Readonly<{
	label: string;
	value: V;
	options: readonly Readonly<{ value: V; label: string }>[];
	onChange: (value: V) => void;
}>) {
	return (
		<label className="csheet__row csheet__row--select">
			<span className="csheet__row-label">{label}</span>
			<span className="csheet__select">
				<select
					value={value}
					onChange={(event) => onChange(event.target.value as V)}
					aria-label={label}
				>
					{options.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label}
						</option>
					))}
				</select>
				<ChevronDown size={15} aria-hidden="true" />
			</span>
		</label>
	);
}

export function SheetChecklist({
	label,
	items,
	onToggle,
	onAll,
}: Readonly<{
	label: string;
	items: readonly Readonly<{
		id: string;
		label: string;
		color?: string;
		count?: number;
		checked: boolean;
	}>[];
	onToggle: (id: string, checked: boolean) => void;
	onAll?: Readonly<{ label: string; onActivate: () => void }>;
}>) {
	return (
		<SheetSection label={label}>
			{onAll === undefined ? null : (
				<button
					type="button"
					className="csheet__all"
					onClick={onAll.onActivate}
				>
					{onAll.label}
				</button>
			)}
			<ul className="csheet__list">
				{items.map((item) => (
					<li key={item.id}>
						<label className="csheet__row">
							<input
								type="checkbox"
								className="csheet__check-input"
								checked={item.checked}
								onChange={(event) => onToggle(item.id, event.target.checked)}
								data-compact-sheet-check={item.id}
							/>
							<span className="csheet__check" aria-hidden="true">
								<Check size={14} />
							</span>
							{item.color === undefined ? null : (
								<span
									className="csheet__swatch"
									style={{ background: item.color }}
									aria-hidden="true"
								/>
							)}
							<span className="csheet__row-label">{item.label}</span>
							{item.count === undefined ? null : (
								<span className="csheet__count">{item.count}</span>
							)}
						</label>
					</li>
				))}
			</ul>
		</SheetSection>
	);
}

/** A plain row in the sheet: a label and whatever sits at its end. */
export function SheetRow({
	label,
	children,
}: Readonly<{ label: ReactNode; children?: ReactNode }>) {
	return (
		<div className="csheet__row">
			<span className="csheet__row-label">{label}</span>
			{children}
		</div>
	);
}
