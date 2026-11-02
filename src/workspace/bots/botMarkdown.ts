/**
 * Agent replies are Markdown written by a model, so they render as untrusted
 * Markdown: raw HTML is escaped, script-capable URLs are rejected by
 * markdown-it's validator, and images resolve only through authenticated container reads; remote images
 * remain text so a reply never loads a remote resource. Links leave Terminay only through the host browser.
 */

import MarkdownIt from 'markdown-it';
import type { MouseEvent } from 'react';
import { openExternalUrl } from '../../host/nativeActions';

const markdown = new MarkdownIt({
	html: false,
	linkify: true,
	breaks: false,
});

export function botMarkdownImagePaths(text: string): string[] {
	const paths = new Set<string>();
	const visit = (tokens: ReturnType<typeof markdown.parse>) => {
		for (const token of tokens) {
			if (token.type === 'image') {
				const path = String(token.attrGet('src') ?? '');
				if (path && localImagePath(path)) paths.add(path);
			}
			if (token.children) visit(token.children);
		}
	};
	visit(markdown.parse(text, {}));
	return [...paths];
}
function localImagePath(path: string): boolean {
if(/^bot-attachment:[a-f0-9]{24}$/.test(path))return true;
	return (
		(path.startsWith('/tmp/') || path.startsWith('/home/bot/')) &&
		![...path].some((char) => char.charCodeAt(0) < 32) &&
		!path
			.split('/')
			.slice(1)
			.some((p) => !p || p === '.' || p === '..')
	);
}
markdown.renderer.rules.image = (tokens, index, _options, env) => {
	const token = tokens[index]!;
	const path = String(token.attrGet('src') ?? '');
	const alt = markdown.utils.escapeHtml(token.content || 'Image');
	if (!localImagePath(path)) return `<span>${alt}</span>`;
	const images = env?.images as ReadonlyMap<string, string | null> | undefined;
	const url = images?.get(path);
	if (url?.startsWith('blob:'))
		return `<img src="${markdown.utils.escapeHtml(url)}" alt="${alt}" class="bots-inline-image" />`;
	return `<span class="bots-faint">${images?.has(path) ? 'Image unavailable' : 'Loading image'}: ${alt}</span>`;
};

export function renderBotMarkdown(
	text: string,
	images?: ReadonlyMap<string, string | null>,
): string {
	return markdown.render(text, { images });
}

export function handleBotMarkdownClick(event: MouseEvent<HTMLElement>): void {
	if (!(event.target instanceof Element)) return;
	const anchor = event.target.closest('a');
	if (!anchor) return;
	event.preventDefault();
	const href = anchor.getAttribute('href');
	if (href && /^https?:\/\//i.test(href)) void openExternalUrl(href);
}
