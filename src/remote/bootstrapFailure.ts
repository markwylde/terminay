import {
	describeBrowserBootstrapFailure,
	type BrowserBootstrapStep,
} from '@terminay/web';

/** Render a bounded recovery surface even when the normal application has not
 * mounted. This is intentionally DOM-only so it remains available when React,
 * the server bundle, or the session host is the failed bootstrap step. */
export function renderDirectBrowserBootstrapFailure(
	input: Readonly<{
		step: BrowserBootstrapStep;
		error: unknown;
	}>,
): void {
	const failure = describeBrowserBootstrapFailure(input);
	const root = document.getElementById('remote-root') ?? appendFallbackRoot();
	const panel = document.createElement('section');
	panel.setAttribute('aria-labelledby', 'terminay-bootstrap-failure-title');
	panel.setAttribute('data-terminay-bootstrap-failure', failure.step);
	panel.setAttribute('role', 'alert');
	panel.style.cssText =
		'box-sizing:border-box;max-width:42rem;margin:10vh auto;padding:2rem;font:16px/1.5 system-ui,sans-serif;color:#f5f8fc;background:#122033;border:1px solid #516276;border-radius:12px;';

	const title = document.createElement('h1');
	title.id = 'terminay-bootstrap-failure-title';
	title.textContent = 'Terminay could not start this workspace';
	panel.append(title);

	const summary = document.createElement('p');
	summary.textContent = failure.summary;
	panel.append(summary);

	const step = document.createElement('p');
	step.textContent = `Failed bootstrap step: ${failure.stepLabel}.`;
	panel.append(step);

	if (failure.details.length > 0) {
		const details = document.createElement('ul');
		for (const detail of failure.details) {
			const item = document.createElement('li');
			item.textContent = detail;
			details.append(item);
		}
		panel.append(details);
	}

	const recovery = document.createElement('p');
	recovery.textContent =
		'Check the browser requirements for this server, then reload this page.';
	panel.append(recovery);

	const retry = document.createElement('button');
	retry.type = 'button';
	retry.textContent = 'Reload Terminay';
	retry.addEventListener('click', () => window.location.reload());
	panel.append(retry);
	root.replaceChildren(panel);
}

function appendFallbackRoot(): HTMLElement {
	const root = document.createElement('div');
	root.id = 'remote-root';
	document.body.append(root);
	return root;
}
