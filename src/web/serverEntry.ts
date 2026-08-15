import { bootstrapHostedBrowserSession } from './sessionTransportHost';

const root = document.getElementById('web-root');

if (root !== null) {
	if (window.__TERMINAY_HOSTED_SESSION_AUTHORITY__ === undefined) {
		void import('./main').then(({ mountSessionWorkspace }) =>
			mountSessionWorkspace(root),
		);
	} else {
		// Consume the hosted shell authority before asynchronous application-module
		// loading. Later browser modules use only the sealed session host.
		bootstrapHostedBrowserSession();
		void import('../remote/main').then(({ launchDirectBrowserWorkspace }) =>
			launchDirectBrowserWorkspace(root),
		);
	}
}
