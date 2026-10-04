import assert from 'node:assert/strict';
import test from 'node:test';
import {
	canLoadWholeFileContent,
	detectFileCapabilities,
	LARGE_FILE_THRESHOLD_BYTES,
	resolveFileViewerEngine,
	resolveFileViewerMode,
} from '../src/services/fileViewer/capabilities.ts';
import { formatStatusBarFileSize } from '../src/workspace/workspaceStatusBarModel.ts';

/**
 * A file as the server describes it. The capability snapshot is what decides
 * the views; the extension only names the fixture.
 */
function file(name, capabilities = {}) {
	const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
	const viewerCapabilities = {
		relativePath: name,
		size: 1024,
		previewKind: 'text',
		preferredMode: 'text',
		isBinary: false,
		isLargeFile: false,
		safePreview: true,
		canEditText: true,
		canEditHex: true,
		inspectedBytes: 1024,
		inspectionTruncated: false,
		...capabilities,
	};
	return {
		exists: true,
		extension,
		ino: null,
		isBinary: viewerCapabilities.isBinary,
		isDirectory: false,
		isFile: true,
		isLargeFile: false,
		isSymbolicLink: false,
		mimeType: null,
		mtimeMs: null,
		name,
		path: `/project/${name}`,
		size: viewerCapabilities.size,
		viewerCapabilities,
	};
}

test('a source file opens in Text and keeps HEX behind the overflow', () => {
	const capabilities = detectFileCapabilities(file('prompt.ts'));
	assert.equal(capabilities.defaultMode, 'text');
	assert.deepEqual(capabilities.primaryModes, ['text', 'preview', 'diff']);
	assert.deepEqual(capabilities.secondaryModes, ['hex']);
});

test('text recognised only by its content opens in Text, without a Preview tab', () => {
	const capabilities = detectFileCapabilities(
		file('Dockerfile', { previewKind: 'unsupported', safePreview: false }),
	);
	assert.equal(capabilities.defaultMode, 'text');
	assert.deepEqual(capabilities.primaryModes, ['text', 'diff']);
	assert.deepEqual(capabilities.secondaryModes, ['hex']);
});

test('Markdown leads with Preview and offers Tasks', () => {
	const capabilities = detectFileCapabilities(
		file('README.md', { previewKind: 'markdown', preferredMode: 'preview' }),
	);
	assert.equal(capabilities.defaultMode, 'preview');
	assert.deepEqual(capabilities.primaryModes, ['preview', 'tasks', 'text', 'diff']);
	assert.deepEqual(capabilities.secondaryModes, ['hex']);
});

test('an image offers Preview and HEX only', () => {
	const capabilities = detectFileCapabilities(
		file('logo.png', {
			previewKind: 'image',
			preferredMode: 'preview',
			isBinary: true,
			canEditText: false,
		}),
	);
	assert.equal(capabilities.defaultMode, 'preview');
	assert.deepEqual(capabilities.primaryModes, ['preview', 'hex']);
	assert.deepEqual(capabilities.secondaryModes, []);
});

test('unrecognised binary data offers HEX alone', () => {
	const capabilities = detectFileCapabilities(
		file('blob.bin', {
			previewKind: 'hex',
			preferredMode: 'hex',
			isBinary: true,
			safePreview: false,
			canEditText: false,
		}),
	);
	assert.equal(capabilities.defaultMode, 'hex');
	assert.deepEqual(capabilities.primaryModes, ['hex']);
	assert.deepEqual(capabilities.secondaryModes, []);
});

test('an unavailable view gives way to the default view, not to HEX', () => {
	const source = detectFileCapabilities(file('prompt.ts'));
	assert.equal(source.fallbackMode, 'text');
	assert.equal(resolveFileViewerMode(source, 'tasks'), 'text');

	const image = detectFileCapabilities(
		file('logo.png', {
			previewKind: 'image',
			preferredMode: 'preview',
			isBinary: true,
			canEditText: false,
		}),
	);
	assert.equal(resolveFileViewerMode(image, 'diff'), 'preview');
	assert.equal(resolveFileViewerMode(image, 'text'), 'preview');
});

test('a text file too large to preview still opens in Text', () => {
	const capabilities = detectFileCapabilities(
		file('huge.log', { safePreview: false, size: 200 * 1024 * 1024 }),
	);
	assert.equal(capabilities.defaultMode, 'text');
	assert.deepEqual(capabilities.primaryModes, ['text', 'diff']);
});

test('a large file is not read whole until Monaco is chosen for it', () => {
	const large = file('large.txt', { size: LARGE_FILE_THRESHOLD_BYTES + 1 });
	const capabilities = detectFileCapabilities(large);
	assert.equal(capabilities.shouldPromptForEngineChoice, true);
	// Opening it leaves the engine undecided while the chooser is shown.
	const pending = resolveFileViewerEngine(large, capabilities, 'auto');
	assert.equal(pending, 'auto');
	assert.equal(canLoadWholeFileContent(large, pending), false);
	assert.equal(canLoadWholeFileContent(large, 'performant'), false);
	assert.equal(canLoadWholeFileContent(large, 'monaco'), true);

	const boundary = file('boundary.txt', { size: LARGE_FILE_THRESHOLD_BYTES });
	assert.equal(canLoadWholeFileContent(boundary, 'auto'), true);
	assert.equal(canLoadWholeFileContent(boundary, 'performant'), true);
});

test('status bar file sizes stay short', () => {
	assert.equal(formatStatusBarFileSize(0), '0 B');
	assert.equal(formatStatusBarFileSize(1023), '1023 B');
	assert.equal(formatStatusBarFileSize(7844), '7.7 KB');
	assert.equal(formatStatusBarFileSize(1024 * 1024), '1.0 MB');
	assert.equal(formatStatusBarFileSize(150 * 1024 * 1024), '150 MB');
	assert.equal(formatStatusBarFileSize(Number.NaN), '');
});
