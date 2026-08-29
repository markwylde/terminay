import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectEnvironmentSummaryDto } from './uiModel';
import { chooserSecondaryText, statusDotTone, statusLabel } from './uiModel';
import './projectEnvironments.css';

export type ProjectEnvironmentCreateAction = Readonly<{
	providerId: string;
	label: string;
	mode: 'profile' | 'environment';
	profileId?: string;
}>;

export type ProjectEnvironmentChooserProvider = Readonly<{
	providerId: string;
	displayName: string;
	profileForm?: unknown;
	createForm?: unknown;
}>;

export type ProjectEnvironmentChooserProfile = Readonly<{
	id: string;
	providerId: string;
	name: string;
}>;

type ChooserGroup = Readonly<{
	id: string;
	label: string;
	hideHeading?: boolean;
	connections: readonly ProjectEnvironmentSummaryDto[];
	createAction?: ProjectEnvironmentCreateAction;
}>;

function providerShortName(displayName: string): string {
	return displayName.replace(/ (server|vm)$/iu, '');
}

function isPuzedDisplayName(displayName: string): boolean {
	return displayName.toLocaleLowerCase().includes('puzed');
}

function ownedConnections(
	profileId: string,
	environments: readonly ProjectEnvironmentSummaryDto[],
): ProjectEnvironmentSummaryDto[] {
	return environments.filter(
		(item) => item.profileId === profileId && !item.isThisServer,
	);
}

function isProviderInstance(
	profile: ProjectEnvironmentChooserProfile,
	provider: ProjectEnvironmentChooserProvider | undefined,
	environments: readonly ProjectEnvironmentSummaryDto[],
): boolean {
	if (provider?.createForm !== undefined) return true;
	const owned = ownedConnections(profile.id, environments);
	if (owned.length > 1) return true;
	return owned.length === 1 && owned[0]?.name !== profile.name;
}

function createActionForProfile(
	provider: ProjectEnvironmentChooserProvider | undefined,
	profile: ProjectEnvironmentChooserProfile,
): ProjectEnvironmentCreateAction | undefined {
	if (provider?.createForm === undefined) return undefined;
	const shortName = providerShortName(provider.displayName);
	return {
		providerId: provider.providerId,
		profileId: profile.id,
		mode: 'environment',
		label: isPuzedDisplayName(provider.displayName)
			? `Create VM in ${profile.name}`
			: `New ${shortName} connection`,
	};
}

export function buildChooserGroups(
	environments: readonly ProjectEnvironmentSummaryDto[],
	providers: readonly ProjectEnvironmentChooserProvider[],
	profiles: readonly ProjectEnvironmentChooserProfile[],
): ChooserGroup[] {
	const assigned = new Set<string>();
	const groups: ChooserGroup[] = [];
	const thisServer = environments.filter((item) => item.isThisServer);
	for (const item of thisServer) assigned.add(item.id);
	if (thisServer.length > 0) {
		groups.push({
			id: 'this-server',
			label: 'This Terminay Server',
			hideHeading: true,
			connections: thisServer,
		});
	}
	const providerById = new Map(
		providers.map((provider) => [provider.providerId, provider]),
	);
	const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
	for (const profile of profiles) {
		const provider = providerById.get(profile.providerId);
		if (!isProviderInstance(profile, provider, environments)) continue;
		const connections = ownedConnections(profile.id, environments).filter(
			(item) => !assigned.has(item.id),
		);
		for (const item of connections) assigned.add(item.id);
		const createAction = createActionForProfile(provider, profile);
		groups.push({
			id: `provider:${profile.id}`,
			label: profile.name,
			connections,
			...(createAction === undefined ? {} : { createAction }),
		});
	}
	for (const provider of providers) {
		if (provider.profileForm === undefined || provider.createForm !== undefined)
			continue;
		const connections = environments.filter(
			(item) =>
				item.providerId === provider.providerId && !assigned.has(item.id),
		);
		for (const item of connections) assigned.add(item.id);
		const shortName = providerShortName(provider.displayName);
		groups.push({
			id: `type:${provider.providerId}`,
			label: shortName,
			connections,
			createAction: {
				providerId: provider.providerId,
				mode: 'profile',
				label: `Add ${shortName} connection`,
			},
		});
	}
	const leftovers = new Map<
		string,
		{ label: string; connections: ProjectEnvironmentSummaryDto[] }
	>();
	for (const item of environments) {
		if (assigned.has(item.id)) continue;
		const profile =
			item.profileId === undefined
				? undefined
				: profileById.get(item.profileId);
		const provider = providerById.get(item.providerId);
		const key = profile?.id ?? item.providerId;
		const label = profile?.name ?? provider?.displayName ?? item.providerLabel;
		const bucket = leftovers.get(key) ?? { label, connections: [] };
		bucket.connections.push(item);
		leftovers.set(key, bucket);
	}
	for (const [key, group] of leftovers) {
		groups.push({
			id: `other:${key}`,
			label: group.label,
			connections: group.connections,
		});
	}
	return groups;
}

export function ProjectEnvironmentSplitButton({
	canCreate,
	environments,
	providers,
	profiles,
	onCreateThisServer,
	onChoose,
	onCreateProvider,
	onOpen,
	onManageEnvironments,
}: Readonly<{
	canCreate: boolean;
	environments: readonly ProjectEnvironmentSummaryDto[];
	providers: readonly ProjectEnvironmentChooserProvider[];
	profiles: readonly ProjectEnvironmentChooserProfile[];
	onCreateThisServer: () => void;
	onChoose: (environment: ProjectEnvironmentSummaryDto) => void;
	onCreateProvider: (action: ProjectEnvironmentCreateAction) => void;
	onOpen?: () => void;
	onManageEnvironments: () => void;
}>) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const rootRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const arrowRef = useRef<HTMLButtonElement>(null);
	const groups = useMemo(() => {
		const all = buildChooserGroups(environments, providers, profiles);
		const normalized = query.trim().toLocaleLowerCase();
		if (normalized.length === 0) return all;
		return all
			.filter((group) => {
				if (group.label.toLocaleLowerCase().includes(normalized)) return true;
				return group.connections.some((item) =>
					`${item.name} ${item.providerLabel} ${item.endpointSummary} ${chooserSecondaryText(item)}`
						.toLocaleLowerCase()
						.includes(normalized),
				);
			})
			.map((group) =>
				group.label.toLocaleLowerCase().includes(normalized)
					? group
					: {
							...group,
							connections: group.connections.filter((item) =>
								`${item.name} ${item.providerLabel} ${item.endpointSummary} ${chooserSecondaryText(item)}`
									.toLocaleLowerCase()
									.includes(normalized),
							),
						},
			);
	}, [environments, profiles, providers, query]);
	const showSearch = environments.length > 6 || query.length > 0;

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
				menu.classList.remove('project-environment-menu--attached');
				menu.style.position = '';
				menu.style.top = '';
				menu.style.left = '';
				menu.style.right = '';
				menu.style.width = '';
				return;
			}
			const trigger = root.getBoundingClientRect();
			const width = Math.min(300, Math.max(0, window.innerWidth - 24));
			const left = Math.min(
				Math.max(12, trigger.left),
				Math.max(12, window.innerWidth - width - 12),
			);
			menu.classList.add('project-environment-menu--attached');
			menu.style.position = 'fixed';
			menu.style.top = `${Math.round(trigger.bottom)}px`;
			menu.style.left = `${Math.round(left)}px`;
			menu.style.right = 'auto';
			menu.style.width = `${Math.round(width)}px`;
		};
		place();
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	}, [open, groups.length]);

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
		<div
			className={`project-environment-split${open ? ' project-environment-split--open' : ''}`}
			ref={rootRef}
		>
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
					{showSearch ? (
						<label className="project-environment-menu__search">
							<span className="sr-only">Search environments</span>
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search connections"
							/>
						</label>
					) : null}
					<div className="project-environment-menu__items">
						{groups.map((group) => (
							<section
								className="project-environment-menu__group"
								key={group.id}
							>
								{group.hideHeading === true &&
								group.createAction === undefined ? null : (
									<div className="project-environment-menu__group-header">
										{group.hideHeading === true ? (
											<span />
										) : (
											<h2>{group.label}</h2>
										)}
										{group.createAction === undefined ? null : (
											<button
												type="button"
												role="menuitem"
												className="project-environment-menu__add"
												aria-label={group.createAction.label}
												title={group.createAction.label}
												onClick={() => {
													const action = group.createAction;
													if (action === undefined) return;
													closeMenu();
													onCreateProvider(action);
												}}
											>
												<svg
													aria-hidden="true"
													width="12"
													height="12"
													viewBox="0 0 12 12"
													fill="none"
												>
													<path
														d="M6 2V10M2 6H10"
														stroke="currentColor"
														strokeWidth="1.5"
														strokeLinecap="round"
													/>
												</svg>
											</button>
										)}
									</div>
								)}
								{group.connections.map((environment) => (
									<button
										key={environment.id}
										type="button"
										role="menuitem"
										className="project-environment-menu__item"
										title={environment.endpointSummary}
										onClick={() => {
											closeMenu();
											onChoose(environment);
										}}
									>
										<span
											className={`project-environment-menu__dot project-environment-menu__dot--${statusDotTone(environment.status)}`}
											aria-hidden="true"
										/>
										<span className="project-environment-menu__text">
											<span className="project-environment-menu__name">
												{environment.name}
											</span>
											<small>{chooserSecondaryText(environment)}</small>
										</span>
										<span className="sr-only">
											{statusLabel(environment.status)}
										</span>
									</button>
								))}
							</section>
						))}
						{groups.length === 0 ? (
							<p className="project-environment-menu__empty" role="status">
								No matching environments.
							</p>
						) : null}
					</div>
					<footer>
						<button
							type="button"
							role="menuitem"
							className="project-environment-menu__item"
							onClick={() => {
								closeMenu();
								onManageEnvironments();
							}}
						>
							Project Environments…
						</button>
					</footer>
				</div>
			) : null}
		</div>
	);
}
