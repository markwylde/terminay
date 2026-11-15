import { X } from 'lucide-react';
import {
	createContext,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createPortal } from 'react-dom';
import { CompactEdgeDrawer } from './CompactEdgeDrawer';
import './HomeOptionsPanel.css';

/**
 * The Home options panel: on a compact workspace, the search, filter, and view
 * controls of the Home tab in front live in a drawer from the trailing edge
 * instead of on the page (phone-review-fixes, ADR-0125).
 *
 * A section wraps those controls in `<HomeSectionOptions>`. On a wide
 * workspace the slot draws them in place. On a compact one, the slot of the
 * tab in front registers itself (its title, and whether a filter hides items)
 * and portals its controls into one element that lives for as long as the
 * workspace is compact. That element is moved into the drawer while the panel
 * is open and parked in a hidden, inert holder while it is closed, so the
 * controls stay mounted and keep their own state across opening and closing.
 */

export type HomeOptionsRegistration = Readonly<{
	tabId: string;
	title: string;
	/** A filter hides items the section would otherwise show. */
	active: boolean;
}>;

type HostValue = Readonly<{
	isCompact: boolean;
	target: HTMLElement;
	register: (registration: HomeOptionsRegistration) => void;
	unregister: (tabId: string) => void;
}>;

const HomeOptionsHostContext = createContext<HostValue | null>(null);

type TabValue = Readonly<{ tabId: string; isFront: boolean }>;

/** Provided by each Home tab, so a slot knows which tab it belongs to. */
export const HomeOptionsTabContext = createContext<TabValue | null>(null);

/** Whether this Home tab's controls go to the options panel. */
export function useHomeOptionsCompact(): boolean {
	const host = useContext(HomeOptionsHostContext);
	const tab = useContext(HomeOptionsTabContext);
	return host?.isCompact === true && tab !== null;
}

export function HomeSectionOptions({
	active = false,
	children,
	title,
}: Readonly<{ active?: boolean; children: ReactNode; title: string }>) {
	const host = useContext(HomeOptionsHostContext);
	const tab = useContext(HomeOptionsTabContext);
	const isPanel = host?.isCompact === true && tab !== null;
	const isFront = isPanel && tab.isFront;
	const tabId = tab?.tabId;
	const register = host?.register;
	const unregister = host?.unregister;

	useLayoutEffect(() => {
		if (!isFront || tabId === undefined || register === undefined) return;
		register({ tabId, title, active });
	}, [active, isFront, register, tabId, title]);
	useLayoutEffect(() => {
		if (!isFront || tabId === undefined || unregister === undefined) return;
		return () => unregister(tabId);
	}, [isFront, tabId, unregister]);

	if (!isPanel) return <>{children}</>;
	// A tab behind the one in front draws its controls nowhere.
	if (!isFront || host === null) return null;
	return createPortal(children, host.target);
}

/** The host side: owned by the workspace shell, which also owns the toggle. */
export function useHomeOptionsHost(isCompact: boolean) {
	const [target] = useState(() => {
		const element = document.createElement('div');
		element.className = 'home-options__controls';
		element.dataset.homeOptionsControls = 'true';
		return element;
	});
	const [registration, setRegistration] =
		useState<HomeOptionsRegistration | null>(null);
	const register = useCallback((next: HomeOptionsRegistration) => {
		setRegistration((current) =>
			current !== null &&
			current.tabId === next.tabId &&
			current.title === next.title &&
			current.active === next.active
				? current
				: next,
		);
	}, []);
	const unregister = useCallback((tabId: string) => {
		setRegistration((current) => (current?.tabId === tabId ? null : current));
	}, []);
	const value = useMemo<HostValue>(
		() => ({ isCompact, register, target, unregister }),
		[isCompact, register, target, unregister],
	);
	return {
		registration: isCompact ? registration : null,
		target,
		value,
	};
}

export function HomeOptionsHostProvider({
	children,
	value,
}: Readonly<{ children: ReactNode; value: HostValue }>) {
	return (
		<HomeOptionsHostContext.Provider value={value}>
			{children}
		</HomeOptionsHostContext.Provider>
	);
}

/** Moves the shared controls element into whichever container is mounted. */
function useAdopt(target: HTMLElement): RefObject<HTMLDivElement | null> {
	const ref = useRef<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		const container = ref.current;
		if (container === null) return;
		container.appendChild(target);
	});
	return ref;
}

function Holder({ target }: Readonly<{ target: HTMLElement }>) {
	const ref = useAdopt(target);
	return (
		<div
			ref={ref}
			className="home-options__holder"
			hidden
			inert
			aria-hidden="true"
		/>
	);
}

function Body({ target }: Readonly<{ target: HTMLElement }>) {
	const ref = useAdopt(target);
	return <div ref={ref} className="home-options__body" />;
}

export function HomeOptionsPanel({
	isOpen,
	onClose,
	registration,
	target,
}: Readonly<{
	isOpen: boolean;
	onClose: () => void;
	registration: HomeOptionsRegistration | null;
	target: HTMLElement;
}>) {
	const open = isOpen && registration !== null;
	return (
		<>
			{open ? null : <Holder target={target} />}
			{open ? (
				<CompactEdgeDrawer
					edge="trailing"
					label={`${registration.title} options`}
					onPressOutside={onClose}
					scrimClassName="home-options-scrim"
					className="home-options"
					drawerProps={{ 'data-home-options-panel': 'true' }}
				>
					<div className="home-options__head">
						<h2 className="home-options__title">{registration.title}</h2>
						<button
							type="button"
							className="home-options__close"
							onClick={onClose}
							aria-label="Close options"
						>
							<X size={17} aria-hidden="true" />
						</button>
					</div>
					<Body target={target} />
				</CompactEdgeDrawer>
			) : null}
		</>
	);
}
