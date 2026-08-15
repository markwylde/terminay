import type { SharedConnectionsRouteBodyProps } from './SharedConnectionsRouteBody';
import { SharedConnectionsRouteBody } from './SharedConnectionsRouteBody';
import '../settings.css';
import './RemoteControlWindow.css';

/** Settings-family chrome for the shared connections route. */
export function RemoteControlWindow(
	props: Omit<SharedConnectionsRouteBodyProps, 'state' | 'embedded'>,
) {
	return (
		<div className="remote-control-window">
			<header className="remote-control-window__header">
				<h1>Remote Control</h1>
				<p>Choose and manage the Terminay server for this workspace.</p>
			</header>
			<div className="remote-control-window__body">
				<SharedConnectionsRouteBody embedded state="ready" {...props} />
			</div>
		</div>
	);
}
