import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBotMarkdown } from './botMarkdown.ts';

// Attachment images and container Markdown previews share one class, so one
// rule bounds every inline transcript image.
test('attachment and container images share the bounded inline image class', () => {
	const images = new Map([
		['bot-attachment:0123456789abcdef01234567', 'blob:attachment'],
		['/tmp/shot.png', 'blob:container'],
	]);
	const html = renderBotMarkdown(
		'![a.png](bot-attachment:0123456789abcdef01234567)\n\n![shot](/tmp/shot.png)',
		images,
	);
	assert.match(
		html,
		/<img src="blob:attachment" alt="a.png" class="bots-inline-image" \/>/,
	);
	assert.match(
		html,
		/<img src="blob:container" alt="shot" class="bots-inline-image" \/>/,
	);
});
