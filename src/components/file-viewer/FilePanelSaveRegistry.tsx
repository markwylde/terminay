import { createContext, type ReactNode, useContext, useEffect } from 'react';

export type FilePanelSaveHandler = () => Promise<boolean>;
export type FilePanelSaveRegistry = Readonly<{
	register: (panelId: string, handler: FilePanelSaveHandler) => () => void;
}>;

const FilePanelSaveRegistryContext = createContext<FilePanelSaveRegistry | null>(null);

export function FilePanelSaveRegistryProvider({ children, registry }: Readonly<{ children: ReactNode; registry: FilePanelSaveRegistry }>) {
	return <FilePanelSaveRegistryContext.Provider value={registry}>{children}</FilePanelSaveRegistryContext.Provider>;
}

export function useFilePanelSaveRegistration(panelId: string, handler: FilePanelSaveHandler): void {
	const registry = useContext(FilePanelSaveRegistryContext);
	useEffect(() => registry?.register(panelId, handler), [handler, panelId, registry]);
}
