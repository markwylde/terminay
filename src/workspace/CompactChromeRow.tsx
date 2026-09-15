/**
 * The compact workspace chrome: one row, five controls.
 *
 * At phone width the three bands a wide window can afford — the application
 * menu, the project strip, the panel tab strip — cost more than the terminal
 * they frame. This row keeps what a one-handed user actually reaches for and
 * sends the rest to the unified switcher, which the breadcrumb and the
 * connection glyph both open.
 *
 * The breadcrumb says where you are rather than listing where you could go, so
 * it truncates the project before the terminal: the terminal is the thing being
 * typed into, and the one a user needs to read to know their keystrokes are
 * landing in the right place.
 */

import { ChevronDown, LayoutDashboard, Server } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

export type CompactConnectionPresentation = Readonly<{
	/** Named for assistive technology even though the glyph carries no label. */
	serverLabel: string;
	isExposed: boolean;
	isReachable: boolean;
	/** The same tone class the wide bar's connection button carries. */
	tone: string;
}>;

export type CompactChromeRowProps = Readonly<{
	/** Rendered only by hosts that draw their own application menu in-page. */
	applicationMenu?: ReactNode;
	connection: CompactConnectionPresentation;
	connectionButtonRef?: RefObject<HTMLButtonElement | null>;
	isExplorerOpen: boolean;
	isHomeSelected: boolean;
	isSwitcherOpen: boolean;
	breadcrumbButtonRef?: RefObject<HTMLButtonElement | null>;
	onOpenSwitcher: (source: 'breadcrumb' | 'connection') => void;
	onShowDashboard: () => void;
	onToggleExplorer: () => void;
	projectColor?: string;
	projectTitle: string;
	/** Absent when the active project has no terminal in front. */
	terminalTitle?: string;
	/** A pending update stays visible here; it is never worth hiding. */
	updateAction?: ReactNode;
}>;

export function CompactChromeRow({
	applicationMenu,
	breadcrumbButtonRef,
	connection,
	connectionButtonRef,
	isExplorerOpen,
	isHomeSelected,
	isSwitcherOpen,
	onOpenSwitcher,
	onShowDashboard,
	onToggleExplorer,
	projectColor,
	projectTitle,
	terminalTitle,
	updateAction,
}: CompactChromeRowProps) {
	return (
		<div className="compact-chrome" data-compact-chrome="true">
			{applicationMenu}
			<button
				type="button"
				className={`compact-chrome__icon${isExplorerOpen ? ' compact-chrome__icon--active' : ''}`}
				onClick={onToggleExplorer}
				aria-label="Toggle file explorer"
				aria-pressed={isExplorerOpen}
				title="Toggle file explorer"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 14 14"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M2.25 2.25H11.75V11.75H2.25V2.25Z"
						stroke="currentColor"
						strokeWidth="1.4"
					/>
					<path d="M5 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
				</svg>
			</button>
			<button
				type="button"
				className={`compact-chrome__icon${isHomeSelected ? ' compact-chrome__icon--active' : ''}`}
				onClick={onShowDashboard}
				aria-label="Show dashboard"
				aria-pressed={isHomeSelected}
				title="Dashboard"
				data-terminay-home-control="true"
			>
				<LayoutDashboard size={14} aria-hidden="true" />
			</button>
			<button
				ref={breadcrumbButtonRef}
				type="button"
				className="compact-breadcrumb"
				onClick={() => onOpenSwitcher('breadcrumb')}
				aria-haspopup="dialog"
				aria-expanded={isSwitcherOpen}
				aria-label={
					terminalTitle === undefined
						? `Switch terminal — ${projectTitle}`
						: `Switch terminal — ${projectTitle}, ${terminalTitle}`
				}
				data-compact-breadcrumb="true"
				style={
					projectColor === undefined
						? undefined
						: ({ '--project-color': projectColor } as React.CSSProperties)
				}
			>
				<span className="compact-breadcrumb__swatch" aria-hidden="true" />
				<span
					className="compact-breadcrumb__project"
					data-compact-breadcrumb-segment="project"
				>
					{projectTitle}
				</span>
				{terminalTitle === undefined ? null : (
					<>
						<span className="compact-breadcrumb__separator" aria-hidden="true">
							›
						</span>
						<span
							className="compact-breadcrumb__terminal"
							data-compact-breadcrumb-segment="terminal"
						>
							{terminalTitle}
						</span>
					</>
				)}
				<ChevronDown
					className="compact-breadcrumb__chevron"
					size={12}
					aria-hidden="true"
				/>
			</button>
			{updateAction}
			<button
				ref={connectionButtonRef}
				type="button"
				className={`compact-chrome__icon compact-connection ${connection.tone}`.trim()}
				onClick={() => onOpenSwitcher('connection')}
				aria-haspopup="dialog"
				aria-expanded={isSwitcherOpen}
				aria-label={`Connections — ${connection.serverLabel}, ${connection.isExposed ? 'Exposed' : 'Offline'}`}
				title={connection.serverLabel}
				data-compact-connection="true"
			>
				<Server size={15} aria-hidden="true" />
				<span
					className={`compact-connection__dot${connection.isReachable ? '' : ' compact-connection__dot--unreachable'}`}
					aria-hidden="true"
				/>
			</button>
		</div>
	);
}
