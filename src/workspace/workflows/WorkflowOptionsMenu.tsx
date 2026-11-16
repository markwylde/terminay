/**
 * The workflow options menu (ADR-0127): a ⋯ control on the expanded panel,
 * the collapsed rail, the expanded drawer and the collapsed strip. It chooses
 * the device's layout and is the only place a workflow is removed. Every key
 * pressed while it is open is the menu's, never the terminal's.
 */

import type {
	SessionWorkflow,
	WorkflowClient,
	WorkflowTarget,
} from '@terminay/client-core';
import { Check, Ellipsis } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import {
	setWorkflowLayout,
	useWorkflowLayout,
	type WorkflowLayout,
} from './workflowPanelSetting';

export interface WorkflowOptionsMenuProps {
	readonly view: SessionWorkflow;
	readonly target: WorkflowTarget;
	readonly client?: WorkflowClient;
	/** Which way the menu opens from its control: down for the panel and rail, up for the drawer and strip. */
	readonly direction?: 'down' | 'up';
}

const LAYOUTS: readonly [WorkflowLayout, string, string][] = [
	['vertical', 'Vertical', 'Side panel'],
	['horizontal', 'Horizontal', 'Bottom drawer'],
];

export function WorkflowOptionsMenu(props: WorkflowOptionsMenuProps) {
	const layout = useWorkflowLayout();
	const [open, setOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [failed, setFailed] = useState(false);
	const [pending, setPending] = useState(false);
	const buttonRef = useRef<HTMLButtonElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const menuId = useId();

	const close = (returnFocus: boolean) => {
		setOpen(false);
		setConfirming(false);
		setFailed(false);
		if (returnFocus) buttonRef.current?.focus();
	};

	// Focus the checked layout, or the confirmation's Cancel, as the menu changes.
	useEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		const first =
			menu?.querySelector<HTMLElement>('[aria-checked="true"]') ??
			menu?.querySelector<HTMLElement>('button');
		first?.focus();
	}, [open, confirming]);

	// A press outside closes it, leaving focus where the press put it.
	useEffect(() => {
		if (!open) return;
		const owner = buttonRef.current?.ownerDocument;
		const onPointerDown = (event: PointerEvent) => {
			const node = event.target;
			if (
				node instanceof Node &&
				(menuRef.current?.contains(node) || buttonRef.current?.contains(node))
			)
				return;
			close(false);
		};
		owner?.addEventListener('pointerdown', onPointerDown, true);
		return () => owner?.removeEventListener('pointerdown', onPointerDown, true);
	}, [open]);

	const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// The menu's keys are its own; none reaches the terminal or an overlay.
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
			return;
		}
		if (event.key === 'Tab') {
			close(false);
			return;
		}
		if (
			event.key !== 'ArrowDown' &&
			event.key !== 'ArrowUp' &&
			event.key !== 'Home' &&
			event.key !== 'End'
		)
			return;
		event.preventDefault();
		const items = [
			...(menuRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []),
		];
		if (items.length === 0) return;
		const at = items.indexOf(event.target as HTMLElement);
		const next =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? items.length - 1
					: (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	};

	const remove = () => {
		const client = props.client;
		if (client === undefined) return;
		setFailed(false);
		setPending(true);
		void client
			.remove(props.target)
			.then(() => close(false))
			.catch(() => setFailed(true))
			.finally(() => setPending(false));
	};

	const name =
		props.view.state === 'attached' ? props.view.workflow.name : 'this workflow';

	return (
		<span className="workflow-options">
			<button
				ref={buttonRef}
				type="button"
				className="workflow-toggle workflow-options-button"
				aria-label="Workflow options"
				title="Workflow options"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				onKeyDown={(event) => {
					// With the menu closed, Escape belongs to whatever holds the button (an overlay closes).
					if (event.key === 'Escape' && !open) return;
					event.stopPropagation();
					if (event.key === 'ArrowDown' && !open) {
						event.preventDefault();
						setOpen(true);
					}
				}}
				onClick={() => (open ? close(true) : setOpen(true))}
			>
				<Ellipsis size={14} strokeWidth={2} aria-hidden="true" />
			</button>
			{open ? (
				<div
					ref={menuRef}
					id={menuId}
					className={`workflow-menu workflow-menu--${props.direction ?? 'down'}`}
					role="menu"
					aria-label="Workflow options"
					onKeyDown={onMenuKeyDown}
				>
					{confirming ? (
						<div className="workflow-menu-confirm">
							<p>
								Remove <b>{name}</b> from this terminal? The agent keeps working;
								Terminay stops tracking its steps.
							</p>
							{failed ? (
								<p className="workflow-error" role="alert">
									The workflow could not be removed.
								</p>
							) : null}
							<div className="workflow-menu-confirm-actions">
								<button
									type="button"
									role="menuitem"
									className="workflow-menu-button"
									onClick={() => {
										setConfirming(false);
										setFailed(false);
									}}
								>
									Cancel
								</button>
								<button
									type="button"
									role="menuitem"
									className="workflow-menu-button workflow-menu-button--danger"
									disabled={pending}
									onClick={remove}
								>
									Remove
								</button>
							</div>
						</div>
					) : (
						<>
							<span className="workflow-menu-label" aria-hidden="true">
								Show as
							</span>
							{LAYOUTS.map(([value, label, hint]) => (
								<button
									key={value}
									type="button"
									role="menuitemradio"
									aria-checked={layout === value}
									className="workflow-menu-item"
									onClick={() => {
										setWorkflowLayout(value);
										close(true);
									}}
								>
									<span className="workflow-menu-check" aria-hidden="true">
										{layout === value ? <Check size={13} strokeWidth={2.4} /> : null}
									</span>
									<LayoutGlyph layout={value} />
									<span className="workflow-menu-text">
										{label}
										<small aria-hidden="true">{hint}</small>
									</span>
								</button>
							))}
							{props.client === undefined ? null : (
								<>
									<hr className="workflow-menu-rule" />
									<button
										type="button"
										role="menuitem"
										className="workflow-menu-item workflow-menu-item--danger"
										onClick={() => setConfirming(true)}
									>
										Remove workflow…
									</button>
								</>
							)}
						</>
					)}
				</div>
			) : null}
		</span>
	);
}

function LayoutGlyph({ layout }: { readonly layout: WorkflowLayout }) {
	return (
		<svg
			className="workflow-menu-glyph"
			width="18"
			height="18"
			viewBox="0 0 18 18"
			aria-hidden="true"
		>
			<rect x="1.5" y="2.5" width="15" height="13" rx="2" />
			<path d={layout === 'vertical' ? 'M11.5 2.5v13' : 'M1.5 11h15'} />
		</svg>
	);
}
