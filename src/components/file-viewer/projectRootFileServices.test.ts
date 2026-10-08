import assert from 'node:assert/strict';
import test from 'node:test';

import {
	presentationForFolder,
	projectRootFileServices,
} from './projectRootFileServices.ts';

test('a panel rooted at the project root uses every project-root service', () => {
	assert.deepEqual(projectRootFileServices(undefined), {
		documentation: true,
		mdxPreview: true,
		languageIntelligence: true,
	});
});

test('a linked folder panel uses no service that is bound to the project root', () => {
	assert.deepEqual(projectRootFileServices('folder-wt'), {
		documentation: false,
		mdxPreview: false,
		languageIntelligence: false,
	});
});

test('Documentation is shown as the plain file viewer in a linked folder and nowhere else', () => {
	assert.equal(presentationForFolder('documentation', 'folder-wt'), 'file-viewer');
	assert.equal(presentationForFolder('file-viewer', 'folder-wt'), 'file-viewer');
	assert.equal(presentationForFolder('documentation', undefined), 'documentation');
	assert.equal(presentationForFolder('file-viewer', undefined), 'file-viewer');
	// "Keep what the panel has" stays undecided for the caller in any folder.
	assert.equal(presentationForFolder(undefined, 'folder-wt'), undefined);
	assert.equal(presentationForFolder(undefined, undefined), undefined);
});
