import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectEnvironmentSummaryDto } from './uiModel';
import { statusLabel } from './uiModel';
export type ProjectEnvironmentCreateAction = Readonly<{
	providerId: string;
	label: string;
	mode: 'profile' | 'environment';
	profileId?: string;
	description?: string;
}>;

export function ProjectEnvironmentSplitButton({
	canCreate,
	environments,
	connectionOwnerLabels,
	onCreateThisServer,
	createActions,
	onChoose,
	onCreateProvider,
	onOpen,
	onManageEnvironments,
	onManageExtensions,
}: Readonly<{
	canCreate: boolean;
	environments: readonly ProjectEnvironmentSummaryDto[];
	connectionOwnerLabels?: Readonly<Record<string, string>>;
	onCreateThisServer: () => void;
	createActions: readonly ProjectEnvironmentCreateAction[];
	onChoose: (environment: ProjectEnvironmentSummaryDto) => void;
	onCreateProvider: (action: ProjectEnvironmentCreateAction) => void;
	onOpen?: () => void;
	onManageEnvironments: () => void;
	onManageExtensions: () => void;
}>) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const rootRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const arrowRef = useRef<HTMLButtonElement>(null);
	const choices = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		return environments.filter((item) =>
			normalized.length === 0
				? true
				: `${item.name} ${item.providerLabel} ${item.endpointSummary}`
						.toLocaleLowerCase()
						.includes(normalized),
		);
	}, [environments, query]);
	const connectionGroups = useMemo(() => {
		const groups = new Map<string, ProjectEnvironmentSummaryDto[]>();
		for (const connection of choices) {
			const owner = connection.isThisServer
				? 'This Terminay Server'
				: connectionOwnerLabels?.[connection.id] ?? connection.providerLabel;
			const group = groups.get(owner) ?? [];
			group.push(connection);
			groups.set(owner, group);
		}
		return [...groups.entries()];
	}, [choices, connectionOwnerLabels]);

	useEffect(() => {
		if (!open) return;
		const closeOutside = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!rootRef.current?.contains(event.target)
			)
				setOpen(false);
		};
		window.addEventListener('pointerdown', closeOutside);
		return () => window.removeEventListener('pointerdown', closeOutside);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const menu = menuRef.current;
		const root = rootRef.current;
		if (!menu || !root) return;
		const place = () => {
			if (window.matchMedia('(max-width: 720px)').matches) {
				menu.style.position = '';
				menu.style.top = '';
				menu.style.left = '';
				menu.style.right = '';
				menu.style.width = '';
				return;
			}
			const trigger = root.getBoundingClientRect();
			const width = Math.min(420, Math.max(0, window.innerWidth - 24));
			const left = Math.min(
				Math.max(12, trigger.left),
				Math.max(12, window.innerWidth - width - 12),
			);
			menu.style.position = 'fixed';
			menu.style.top = `${Math.round(trigger.bottom + 5)}px`;
			menu.style.left = `${Math.round(left)}px`;
			menu.style.right = 'auto';
			menu.style.width = `${Math.round(width)}px`;
		};
		place();
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	}, [open, choices.length]);

	const openMenu = () => {
		setOpen(true);
		onOpen?.();
		requestAnimationFrame(() =>
			menuRef.current
				?.querySelector<HTMLElement>('input, [role="menuitem"]')
				?.focus(),
		);
	};
	const closeMenu = () => {
		setOpen(false);
		setQuery('');
		requestAnimationFrame(() => arrowRef.current?.focus());
	};
	const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const items = [
			...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
				'[role="menuitem"]',
			) ?? []),
		];
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			items[index < 0 ? 0 : (index + 1) % items.length]?.focus();
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			items[
				index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
			]?.focus();
		}
	};

	return (
		<div className="project-environment-split" ref={rootRef}>
			<button
				type="button"
				className="project-tab-add project-environment-split__primary"
				onClick={onCreateThisServer}
				disabled={!canCreate}
				aria-label="Create project on This server"
				title="Create project on This server"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 12 12"
					fill="none"
				>
					<path
						d="M6 2V10M2 6H10"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
					/>
				</svg>
			</button>
			<button
				ref={arrowRef}
				type="button"
				className="project-tab-add project-environment-split__arrow"
			aria-label="Choose project connection"
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => (open ? closeMenu() : openMenu())}
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
				>
					<path
						d="m3 4.5 3 3 3-3"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
			</button>
			{open ? (
				<div
					ref={menuRef}
					className="project-environment-menu"
					role="menu"
					aria-label="Choose project connection"
					onKeyDown={handleMenuKeyDown}
				>
					<header>
						<strong>Choose project connection</strong>
						<span>Connections are owned by this Terminay Server. Providers are managed separately.</span>
					</header>
					<label className="project-environment-menu__search">
						<span className="sr-only">Search environments</span>
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search connections"
						/>
					</label>
					<div className="project-environment-menu__items">
						{connectionGroups.map(([owner, connections]) => (
							<div className="project-environment-menu__group" key={owner}>
								<h2>{owner}</h2>
								{connections.map((environment) => (
							<button
								key={environment.id}
								type="button"
								role="menuitem"
								onClick={() => {
									closeMenu();
									onChoose(environment);
								}}
							>
								<span
									className="project-environment-menu__glyph"
									aria-hidden="true"
								>
									{environment.isThisServer
										? '›_'
										: environment.providerLabel === 'SSH'
											? '⇄'
											: '⬡'}
								</span>
								<span>
									<strong>{environment.name}</strong>
									<small>{environment.endpointSummary}</small>
								</span>
								<span
									className={`environment-status environment-status--${environment.status}`}
								>
									{statusLabel(environment.status)}
								</span>
							</button>
								))}
							</div>
						))}
						{choices.length === 0 ? (
							<p role="status">No matching environments.</p>
						) : null}
					</div>
					<footer>
						{createActions.map((action) => (
							<button
								key={`${action.providerId}:${action.profileId ?? 'profile'}`}
								type="button"
								role="menuitem"
								onClick={() => {
									closeMenu();
									onCreateProvider(action);
								}}
							>
								<span>
									<strong>{action.label}</strong>
									{action.description ? (
										<small>{action.description}</small>
									) : null}
								</span>
							</button>
						))}
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								closeMenu();
								onManageEnvironments();
							}}
						>
							Project Environments…
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								closeMenu();
								onManageExtensions();
							}}
						>
							Extensions…
						</button>
					</footer>
				</div>
			) : null}
		</div>
	);
}
