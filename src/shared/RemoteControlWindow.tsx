import type { ReactNode } from 'react';
import type { SharedConnectionsRouteBodyProps } from './SharedConnectionsRouteBody';
import { SharedConnectionsRouteBody } from './SharedConnectionsRouteBody';
import '../settings.css';
import './RemoteControlWindow.css';

/** Settings-family chrome for the shared connections route. */
export function RemoteControlWindow(
	props: Omit<
		SharedConnectionsRouteBodyProps,
		'state' | 'embedded' | 'presentation'
	> &
		Readonly<{ exposurePanel?: ReactNode }>,
) {
	return (
		<SharedConnectionsRouteBody
			presentation="management"
			state="ready"
			{...props}
		/>
	);
}
