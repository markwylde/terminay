import { createContext, type ReactNode, useContext } from 'react';
import type { DisconnectedFilePanelCompatibility } from './disconnectedFilePanelCompatibility';
import type { DisconnectedFolderCompatibility } from './disconnectedFolderCompatibility';

export type DisconnectedFileCompatibility = Readonly<{
	filePanel: DisconnectedFilePanelCompatibility;
	folderPanel: DisconnectedFolderCompatibility;
}>;

const DisconnectedFileCompatibilityContext =
	createContext<DisconnectedFileCompatibility | null>(null);

export function DisconnectedFileCompatibilityProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: DisconnectedFileCompatibility;
}) {
	return (
		<DisconnectedFileCompatibilityContext.Provider value={value}>
			{children}
		</DisconnectedFileCompatibilityContext.Provider>
	);
}

export function useDisconnectedFileCompatibility(): DisconnectedFileCompatibility {
	const compatibility = useContext(DisconnectedFileCompatibilityContext);
	if (compatibility === null) {
		throw new Error('disconnected file compatibility provider is unavailable');
	}
	return compatibility;
}

export function useOptionalDisconnectedFileCompatibility(): DisconnectedFileCompatibility | null {
	return useContext(DisconnectedFileCompatibilityContext);
}

export function useDisconnectedFilePanelCompatibility(): DisconnectedFilePanelCompatibility {
	return useDisconnectedFileCompatibility().filePanel;
}

export function useDisconnectedFolderCompatibility(): DisconnectedFolderCompatibility {
	return useDisconnectedFileCompatibility().folderPanel;
}
