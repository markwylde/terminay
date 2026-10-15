import assert from 'node:assert/strict';
import test from 'node:test';

import { projectRootFileServices } from './projectRootFileServices.ts';

test('a panel rooted at the project root uses every project-root service', () => {
	assert.deepEqual(projectRootFileServices(undefined), {
		mdxPreview: true,
		languageIntelligence: true,
	});
});

test('a linked folder panel uses no service that is bound to the project root', () => {
	assert.deepEqual(projectRootFileServices('folder-wt'), {
		mdxPreview: false,
		languageIntelligence: false,
	});
});
