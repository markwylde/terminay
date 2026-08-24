import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import { resolveDesktopUserDataPath } from '../electron/userDataNamespace.ts';

test('source development cannot share the installed Terminay authority by default', () => {
	const appDataPath = path.resolve('/tmp/terminay-app-data');
	assert.equal(
		resolveDesktopUserDataPath({ appDataPath, isPackaged: false }),
		path.join(appDataPath, 'Terminay Development'),
	);
	assert.equal(
		resolveDesktopUserDataPath({ appDataPath, isPackaged: true }),
		undefined,
	);
});

test('an explicit isolated profile takes precedence in every composition', () => {
	const customPath = path.resolve('/tmp/terminay-explicit-profile');
	for (const isPackaged of [false, true]) {
		assert.equal(
			resolveDesktopUserDataPath({
				appDataPath: path.resolve('/tmp/terminay-app-data'),
				customPath: `  ${customPath}  `,
				isPackaged,
			}),
			customPath,
		);
	}
});
