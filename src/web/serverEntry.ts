import { bootstrapHostedBrowserSession } from './sessionTransportHost';

const root = document.getElementById('web-root');

function renderBootstrapFailure(rootElement: HTMLElement): void {
	const panel = document.createElement('main');
	panel.className = 'terminay-bootstrap-loading';
	panel.setAttribute('role', 'alert');
	const content = document.createElement('section');
	content.className = 'terminay-bootstrap-loading__error';
	const heading = document.createElement('h1');
	heading.textContent = 'Terminay could not start.';
	const message = document.createElement('p');
	message.textContent = 'Reload to try connecting again.';
	const retry = document.createElement('button');
	retry.type = 'button';
	retry.textContent = 'Reload';
	retry.addEventListener('click', () => window.location.reload());
	content.append(heading, message, retry);
	panel.append(content);
	rootElement.replaceChildren(panel);
}

async function mountWorkspace(rootElement: HTMLElement): Promise<void> {
	try {
		if (window.__TERMINAY_HOSTED_SESSION_AUTHORITY__ === undefined) {
			const { mountSessionWorkspace } = await import('./main');
			mountSessionWorkspace(rootElement);
			return;
		}
		// Consume the hosted shell authority before asynchronous application-module
		// loading. Later browser modules use only the sealed session host.
		bootstrapHostedBrowserSession();
		const { launchDirectBrowserWorkspace } = await import('../remote/main');
		await launchDirectBrowserWorkspace(rootElement);
	} catch (error) {
		console.error('Terminay bootstrap failed', error);
		renderBootstrapFailure(rootElement);
	}
}

if (root !== null) void mountWorkspace(root);
