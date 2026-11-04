import { Check, ChevronDown } from 'lucide-react';
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';

export interface GroupedSelectOption<V extends string> {
	readonly value: V;
	readonly label: string;
	readonly description?: string;
	readonly icon?: ReactNode;
	readonly disabled?: boolean;
	/** Extra attributes for tests and automation, set on the option button. */
	readonly data?: Readonly<Record<`data-${string}`, string>>;
}

export interface GroupedSelectGroup<V extends string> {
	/** Omit for an untitled group; a list with one untitled group reads as a plain select. */
	readonly label?: string;
	readonly options: readonly GroupedSelectOption<V>[];
}

/**
 * The Bots dropdown: a button that opens a grouped list of options, each with
 * an optional description line. It replaces native selects so every picker in
 * the Bots surface looks and behaves the same.
 */
export function GroupedSelect<V extends string>({
	label,
	value,
	groups,
	onChange,
	display,
	placeholder = 'Choose…',
	empty,
	disabled = false,
	data,
}: Readonly<{
	/** Accessible name of the control. */
	label: string;
	value: V;
	groups: readonly GroupedSelectGroup<V>[];
	onChange: (value: V) => void;
	/** Overrides what the closed control shows. */
	display?: ReactNode;
	placeholder?: string;
	/** Shown in the open list when there are no options. */
	empty?: ReactNode;
	disabled?: boolean;
	data?: Readonly<Record<`data-${string}`, string>>;
}>) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState<V>();
	const [above, setAbove] = useState(false);
	const [maxHeight, setMaxHeight] = useState<number>();
	const root = useRef<HTMLDivElement>(null);
	const panel = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const listId = useId();
	const options = groups.flatMap((g) => g.options);
	const enabled = options.filter((o) => !o.disabled);
	const current = options.find((o) => o.value === value);

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		window.addEventListener('mousedown', onDown);
		return () => window.removeEventListener('mousedown', onDown);
	}, [open]);

	useLayoutEffect(() => {
		if (!open || !button.current || !panel.current) return;
		const box = button.current.getBoundingClientRect();
		const clip = scrollBounds(button.current);
		const below = clip.bottom - box.bottom - 12;
		const roomAbove = box.top - clip.top - 12;
		const wanted = Math.min(panel.current.scrollHeight, 360);
		const flip = below < wanted && roomAbove > below;
		setAbove(flip);
		setMaxHeight(Math.max(140, Math.min(360, flip ? roomAbove : below)));
		revealIn(
			panel.current,
			panel.current.querySelector<HTMLElement>('[aria-selected="true"]'),
		);
	}, [open]);

	useEffect(() => {
		if (!open || active === undefined) return;
		revealIn(
			panel.current,
			panel.current?.querySelector<HTMLElement>(
				`[data-grouped-select-value="${CSS.escape(active)}"]`,
			),
		);
	}, [open, active]);

	const show = () => {
		setActive(current && !current.disabled ? current.value : enabled[0]?.value);
		setOpen(true);
	};
	const choose = (next: V) => {
		setOpen(false);
		button.current?.focus();
		if (next !== value) onChange(next);
	};
	const move = (step: number) => {
		if (!enabled.length) return;
		const at = enabled.findIndex((o) => o.value === active);
		const next =
			at === -1
				? step > 0
					? 0
					: enabled.length - 1
				: (at + step + enabled.length) % enabled.length;
		setActive(enabled[next]!.value);
	};
	const onKey = (event: KeyboardEvent) => {
		if (disabled) return;
		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				event.preventDefault();
				if (!open) show();
				else move(event.key === 'ArrowDown' ? 1 : -1);
				break;
			case 'Home':
			case 'End':
				if (!open) return;
				event.preventDefault();
				setActive((event.key === 'Home' ? enabled[0] : enabled.at(-1))?.value);
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				if (!open) show();
				else if (active !== undefined) choose(active);
				break;
			case 'Escape':
				if (!open) return;
				event.preventDefault();
				event.stopPropagation();
				setOpen(false);
				break;
			case 'Tab':
				setOpen(false);
				break;
		}
	};

	return (
		<div className="bots-dd" ref={root}>
			<button
				ref={button}
				type="button"
				role="combobox"
				className="bots-in bots-dd__btn"
				aria-label={label}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-activedescendant={
					open && active !== undefined ? `${listId}-${active}` : undefined
				}
				disabled={disabled}
				onClick={() => (open ? setOpen(false) : show())}
				onKeyDown={onKey}
				data-grouped-select-value={value}
				{...data}
			>
				{current?.icon ? (
					<span className="bots-dd__icon">{current.icon}</span>
				) : null}
				<span className="bots-grow bots-dd__value">
					{display ?? current?.label ?? (
						<span className="bots-faint">{placeholder}</span>
					)}
				</span>
				<ChevronDown
					size={14}
					aria-hidden="true"
					className={`bots-dd__chev${open ? ' bots-dd__chev--open' : ''}`}
				/>
			</button>
			{open ? (
				<div
					ref={panel}
					id={listId}
					className={`bots-card bots-dd__panel${above ? ' bots-dd__panel--above' : ''}`}
					role="listbox"
					aria-label={label}
					style={maxHeight ? { maxHeight } : undefined}
				>
					{options.length === 0 ? (
						<div className="bots-faint bots-dd__empty">
							{empty ?? 'Nothing to choose from.'}
						</div>
					) : (
						groups.map((group, index) =>
							group.options.length ? (
								<fieldset
									key={group.label ?? `group-${index}`}
									aria-label={group.label}
									className="bots-dd__group"
								>
									{group.label ? (
										<div className="bots-dd__grp" aria-hidden="true">
											{group.label}
										</div>
									) : null}
									{group.options.map((option) => {
										const selected = option.value === value;
										return (
											<button
												key={option.value}
												id={`${listId}-${option.value}`}
												type="button"
												role="option"
												tabIndex={-1}
												aria-selected={selected}
												aria-disabled={option.disabled || undefined}
												disabled={option.disabled}
												className={`bots-dd__opt${selected ? ' bots-dd__opt--on' : ''}${active === option.value ? ' bots-dd__opt--active' : ''}`}
												onMouseEnter={() =>
													option.disabled ? undefined : setActive(option.value)
												}
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => choose(option.value)}
												data-grouped-select-value={option.value}
												{...option.data}
											>
												<span className="bots-dd__check">
													{selected ? (
														<Check size={13} aria-hidden="true" />
													) : null}
												</span>
												{option.icon ? (
													<span className="bots-dd__icon">{option.icon}</span>
												) : null}
												<span className="bots-grow">
													<b>{option.label}</b>
													{option.description ? (
														<span className="bots-dd__sub">
															{option.description}
														</span>
													) : null}
												</span>
											</button>
										);
									})}
								</fieldset>
							) : null,
						)
					)}
				</div>
			) : null}
		</div>
	);
}

/** One untitled group: the shape of a plain select. */
export function plainOptions<V extends string>(
	options: readonly GroupedSelectOption<V>[],
): readonly GroupedSelectGroup<V>[] {
	return [{ options }];
}

/** The visible box of the nearest scrolling ancestor, or the window. */
function scrollBounds(el: HTMLElement): { top: number; bottom: number } {
	for (let node = el.parentElement; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (overflowY === 'auto' || overflowY === 'scroll') {
			const rect = node.getBoundingClientRect();
			return {
				top: Math.max(rect.top, 0),
				bottom: Math.min(rect.bottom, window.innerHeight),
			};
		}
	}
	return { top: 0, bottom: window.innerHeight };
}

/** Scrolls only the list so the option shows; never the page around it. */
function revealIn(
	list: HTMLElement | null,
	option: HTMLElement | null | undefined,
): void {
	if (!list || !option) return;
	const top = option.offsetTop;
	const bottom = top + option.offsetHeight;
	if (top < list.scrollTop) list.scrollTop = top - 4;
	else if (bottom > list.scrollTop + list.clientHeight)
		list.scrollTop = bottom - list.clientHeight + 4;
}
