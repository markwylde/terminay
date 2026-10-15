import { createContext, type ReactNode, useContext, useEffect } from 'react';

export type FilePanelSaveHandler = () => Promise<boolean>;
/** How a panel saves. An autosaving view is flushed before its panel closes. */
export type FilePanelSaveRegistration = Readonly<{
	save: FilePanelSaveHandler;
	autosaves: boolean;
}>;
export type FilePanelSaveRegistry = Readonly<{
	register: (panelId: string, registration: FilePanelSaveRegistration) => () => void;
}>;

const FilePanelSaveRegistryContext = createContext<FilePanelSaveRegistry | null>(null);

export function FilePanelSaveRegistryProvider({ children, registry }: Readonly<{ children: ReactNode; registry: FilePanelSaveRegistry }>) {
	return <FilePanelSaveRegistryContext.Provider value={registry}>{children}</FilePanelSaveRegistryContext.Provider>;
}

export function useFilePanelSaveRegistration(panelId: string, save: FilePanelSaveHandler, autosaves: boolean): void {
	const registry = useContext(FilePanelSaveRegistryContext);
	useEffect(() => registry?.register(panelId, { save, autosaves }), [autosaves, save, panelId, registry]);
}
