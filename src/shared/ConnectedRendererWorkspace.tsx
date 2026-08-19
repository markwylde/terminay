import App from '../App';
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
	onDisconnect?: () => void;
	onOpenConnectionManager?: () => void;
	onSwitchConnections?: () => void;
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
			// A replacement lane can retain both server and client identities. Its
			// terminal tree still needs a fresh attachment to the new transport.
			key={`${terminalClientContext.serverId}:${terminalClientContext.connectionGeneration ?? 'initial'}`}
			onDisconnect={host.onDisconnect}
			onOpenConnectionManager={host.onOpenConnectionManager}
			onSwitchConnections={host.onSwitchConnections}
			terminalClientContext={terminalClientContext}
		/>
	);
}
