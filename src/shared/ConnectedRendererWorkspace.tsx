import App from '../App';
import type { QuickPushClient } from '../components/QuickPushModal';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import type { AppCommand } from '../types/terminay';
import type { AuxiliaryRouteController } from './auxiliaryRoutes';

/**
 * Host presentation capabilities that remain outside the authenticated server
 * connection. Browser hosts must omit native capabilities rather than
 * emulating Electron preload APIs.
 */
export type RendererHostAdapters = Readonly<{
	auxiliaryRoutes?: AuxiliaryRouteController;
	/** Presentation is negotiated with the host; build-mode guesses are forbidden. */
	presentation?: Readonly<{
		nativeMenus: boolean;
		nativeWindowControls: boolean;
	}>;
	subscribeAppCommands?: (
		listener: (command: AppCommand) => Promise<void> | void,
	) => () => void;
	quickPushClient?: QuickPushClient;
	onDisconnect?: () => void;
	onOpenConnectionManager?: () => void;
}>;

export type ConnectedRendererWorkspaceProps = Readonly<{
	host: RendererHostAdapters;
	terminalClientContext: Omit<TerminalPanelClientContextValue, 'projectId'>;
}>;

/** The shared, already-authenticated renderer composition.
 *
 * Desktop obtains the context through its MessagePort/preload boundary; web
 * hosts inject the context created from their canonical transport directly.
 */
export function ConnectedRendererWorkspace({
	host,
	terminalClientContext,
}: ConnectedRendererWorkspaceProps) {
	return (
		<App
			auxiliaryRoutes={host.auxiliaryRoutes}
			hostPresentation={host.presentation}
			subscribeAppCommands={host.subscribeAppCommands}
			key={terminalClientContext.serverId}
			onDisconnect={host.onDisconnect}
			onOpenConnectionManager={host.onOpenConnectionManager}
			quickPushClient={host.quickPushClient}
			terminalClientContext={terminalClientContext}
		/>
	);
}
