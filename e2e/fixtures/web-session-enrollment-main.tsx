import { mountSessionWorkspace } from '../../src/web/main';

const root = document.getElementById('web-session-enrollment-root');
if (root === null) throw new Error('web session enrollment root is missing');
mountSessionWorkspace(root);
