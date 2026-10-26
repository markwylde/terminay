import { createContext, useContext, useEffect, useRef } from 'react';

/** Resolves true when Settings may be closed or switched to another server. */
export type SettingsLeaveGuard = () => Promise<boolean>;

export type SettingsLeaveGuardRegistry = Readonly<{
	register: (guard: SettingsLeaveGuard) => () => void;
	/** Asks the registered guard, if any. */
	confirm: () => Promise<boolean>;
}>;

/** One slot: there is one Settings surface per window. */
export function createSettingsLeaveGuardRegistry(): SettingsLeaveGuardRegistry {
	let current: SettingsLeaveGuard | undefined;
	return Object.freeze({
		register(guard) {
			current = guard;
			return () => {
				if (current === guard) current = undefined;
			};
		},
		confirm: () => (current === undefined ? Promise.resolve(true) : current()),
	});
}

const SettingsLeaveGuardContext = createContext<SettingsLeaveGuardRegistry | null>(
	null,
);

export const SettingsLeaveGuardProvider = SettingsLeaveGuardContext.Provider;

/** Lets the host ask before Settings closes; the latest guard is always the one asked. */
export function useSettingsLeaveGuard(guard: SettingsLeaveGuard): void {
	const registry = useContext(SettingsLeaveGuardContext);
	const latest = useRef(guard);
	latest.current = guard;
	useEffect(() => {
		if (registry === null) return undefined;
		return registry.register(() => latest.current());
	}, [registry]);
}
