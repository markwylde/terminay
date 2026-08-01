const BOOT_TIMEOUT_MS = 15_000;

const root = document.getElementById('root');
if (root === null) throw new Error('Terminay renderer root is unavailable');

const BOOTSTRAP_STYLE_ID = 'terminay-bootstrap-style';
const TERMINAY_LOGO_PATH = '/terminay.svg';
const AUXILIARY_VIEWS = new Set([
	'edit-tab',
	'settings',
	'macros',
	'recordings',
]);
const isAuxiliaryView = AUXILIARY_VIEWS.has(
	new URLSearchParams(window.location.search).get('view') ?? '',
);

const installBootstrapStyle = () => {
	if (document.getElementById(BOOTSTRAP_STYLE_ID) !== null) return;
	const style = document.createElement('style');
	style.id = BOOTSTRAP_STYLE_ID;
	style.textContent = `
    :root {
      color-scheme: light dark;
    }

    html,
    body,
    #root {
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
    }

    body {
      background: #f6f7f9;
      color: #17202c;
    }

    .terminay-server-connecting {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 32px;
      overflow: hidden;
      background:
        radial-gradient(circle at center, rgba(255, 255, 255, 0.7), rgba(246, 247, 249, 0) 42%),
        #f6f7f9;
      color: #17202c;
      font-family: 'Open Sans', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    }

    .terminay-server-connecting__content {
      display: grid;
      justify-items: center;
      gap: 14px;
    }

    .terminay-server-connecting__logo {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      box-shadow: 0 18px 48px rgba(20, 29, 40, 0.18);
    }

    .terminay-server-connecting__text {
      margin: 0;
      color: #536170;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
    }

    .terminay-server-connecting[role='alert'] .terminay-server-connecting__text {
      color: #a83a3a;
    }

    @media (prefers-color-scheme: dark) {
      body {
        background: #0d1014;
        color: #dce2f0;
      }

      .terminay-server-connecting {
        background:
          radial-gradient(circle at center, rgba(49, 68, 91, 0.32), rgba(13, 16, 20, 0) 44%),
          #0d1014;
        color: #dce2f0;
      }

      .terminay-server-connecting__logo {
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.38);
      }

      .terminay-server-connecting__text {
        color: #9ba9ba;
      }

      .terminay-server-connecting[role='alert'] .terminay-server-connecting__text {
        color: #ff9f9f;
      }
    }
  `;
	document.head.append(style);
};

const renderStatus = (message: string, failed = false) => {
	installBootstrapStyle();
	const status = document.createElement('main');
	status.className = 'terminay-server-connecting';
	if (failed) {
		status.setAttribute('role', 'alert');
	} else {
		status.setAttribute('role', 'status');
		status.setAttribute('aria-busy', 'true');
	}
	const content = document.createElement('div');
	content.className = 'terminay-server-connecting__content';
	const logo = document.createElement('img');
	logo.className = 'terminay-server-connecting__logo';
	logo.src = TERMINAY_LOGO_PATH;
	logo.alt = '';
	logo.setAttribute('aria-hidden', 'true');
	const statusText = document.createElement('p');
	statusText.className = 'terminay-server-connecting__text';
	statusText.textContent = message;
	content.append(logo, statusText);
	status.append(content);
	root.replaceChildren(status);
};

if (isAuxiliaryView) {
	installBootstrapStyle();
} else {
	renderStatus('Loading Terminay…');
}

let settled = false;
const timeout = window.setTimeout(() => {
	if (settled) return;
	settled = true;
	renderStatus('Terminay renderer modules did not become ready in time.', true);
}, BOOT_TIMEOUT_MS);

void import('./rendererApp.tsx')
	.then((module) => {
		if (settled) return;
		settled = true;
		window.clearTimeout(timeout);
		module.mountRendererApp(root);
	})
	.catch(() => {
		if (settled) return;
		settled = true;
		window.clearTimeout(timeout);
		renderStatus('Terminay renderer modules could not be loaded.', true);
	});
