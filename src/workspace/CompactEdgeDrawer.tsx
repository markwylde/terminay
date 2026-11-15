import {
	type HTMLAttributes,
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
} from 'react';
import './CompactEdgeDrawer.css';

/**
 * A compact edge drawer (ADR-0125): a navigation surface that slides in from
 * one edge of a phone-width workspace and leaves a strip of the page beside
 * it. A press on that strip, or the dismiss key, closes the topmost layer.
 * The compact switcher (leading edge) and every compact section page's View
 * options sheet (bottom edge) are drawn through this one shell; neither is an
 * in-page window.
 */
export type CompactEdgeDrawerProps = Readonly<{
	edge: 'leading' | 'trailing' | 'bottom';
	/** The drawer's accessible name. */
	label: string;
	children: ReactNode;
	/** A press beside the drawer. */
	onPressOutside: () => void;
	/**
	 * The dismiss key. Defaults to `onPressOutside`; a drawer with layers of
	 * its own closes the topmost one here.
	 */
	onEscape?: () => void;
	/** Whether Escape is handled at all right now (e.g. not during a drag). */
	isEscapeEnabled?: () => boolean;
	/** Where focus goes when the drawer opens; the first control otherwise. */
	initialFocusRef?: RefObject<HTMLElement | null>;
	/** Extra classes for the scrim and the drawer, for a drawer's own look. */
	scrimClassName?: string;
	className?: string;
	scrimProps?: HTMLAttributes<HTMLDivElement> &
		Record<`data-${string}`, string>;
	drawerProps?: HTMLAttributes<HTMLDivElement> &
		Record<`data-${string}`, string>;
}>;

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		(element) =>
			!element.closest('[inert]') && element.getClientRects().length > 0,
	);
}

export function CompactEdgeDrawer({
	edge,
	label,
	children,
	onPressOutside,
	onEscape,
	isEscapeEnabled,
	initialFocusRef,
	scrimClassName,
	className,
	scrimProps,
	drawerProps,
}: CompactEdgeDrawerProps) {
	const drawerRef = useRef<HTMLDivElement>(null);
	const escapeRef = useRef(onEscape ?? onPressOutside);
	escapeRef.current = onEscape ?? onPressOutside;
	const enabledRef = useRef(isEscapeEnabled);
	enabledRef.current = isEscapeEnabled;

	// The dismiss key belongs to the topmost layer; the drawer is above the
	// workspace, so it takes the key before anything behind it.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			if (enabledRef.current !== undefined && !enabledRef.current()) return;
			event.stopPropagation();
			escapeRef.current();
		};
		window.addEventListener('keydown', onKeyDown, { capture: true });
		return () =>
			window.removeEventListener('keydown', onKeyDown, { capture: true });
	}, []);

	// Focus moves into the drawer when it opens and stays there: Tab wraps.
	useEffect(() => {
		const drawer = drawerRef.current;
		if (drawer === null) return;
		const frame = window.requestAnimationFrame(() => {
			if (drawer.contains(document.activeElement)) return;
			const target = initialFocusRef?.current ?? focusables(drawer)[0];
			target?.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [initialFocusRef]);

	// Whatever moves focus behind the scrim — Tab past a control the list
	// above did not count, a script, assistive technology — it comes back.
	useEffect(() => {
		let frame = 0;
		const onFocusIn = (event: FocusEvent) => {
			const target = event.target;
			// Another layer above this one (a menu, a picker) owns its focus.
			if (
				target instanceof Element &&
				target.closest('[role="dialog"], [role="menu"], [role="listbox"]') !==
					null &&
				!drawerRef.current?.contains(target)
			)
				return;
			// Checked a frame later: a drawer that is closing hands focus back to
			// the control that opened it, and is gone by then.
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(() => {
				const drawer = drawerRef.current;
				if (drawer === null || !drawer.isConnected) return;
				const active = document.activeElement;
				if (active !== null && drawer.contains(active)) return;
				if (
					active instanceof Element &&
					active !== document.body &&
					active.closest('[role="dialog"], [role="menu"], [role="listbox"]') !==
						null
				)
					return;
				(focusables(drawer)[0] ?? drawer).focus({ preventScroll: true });
			});
		};
		document.addEventListener('focusin', onFocusIn);
		return () => {
			window.cancelAnimationFrame(frame);
			document.removeEventListener('focusin', onFocusIn);
		};
	}, []);

	return (
		<div
			{...scrimProps}
			className={`compact-edge-scrim${scrimClassName === undefined ? '' : ` ${scrimClassName}`}`}
			data-compact-edge={edge}
			onPointerDown={(event) => {
				scrimProps?.onPointerDown?.(event);
				if (event.target !== event.currentTarget) return;
				// The default mousedown action would move focus to the body right
				// after it is handed back to the control that opened the drawer.
				event.preventDefault();
				onPressOutside();
			}}
		>
			<div
				{...drawerProps}
				ref={drawerRef}
				className={`compact-edge-drawer compact-edge-drawer--${edge}${className === undefined ? '' : ` ${className}`}`}
				role="dialog"
				aria-modal="true"
				tabIndex={-1}
				aria-label={label}
				onKeyDown={(event) => {
					drawerProps?.onKeyDown?.(event);
					if (event.key !== 'Tab' || event.defaultPrevented) return;
					const drawer = drawerRef.current;
					if (drawer === null) return;
					const items = focusables(drawer);
					if (items.length === 0) return;
					const first = items[0];
					const last = items[items.length - 1];
					if (event.shiftKey && document.activeElement === first) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first?.focus();
					}
				}}
			>
				{children}
			</div>
		</div>
	);
}
