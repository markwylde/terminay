/**
 * Agent replies are Markdown written by a model, so they render as untrusted
 * Markdown: raw HTML is escaped, script-capable URLs are rejected by
 * markdown-it's validator, and images show as their alt text so a reply never
 * loads a remote resource. Links leave Terminay only through the host browser.
 */

import MarkdownIt from 'markdown-it';
import type { MouseEvent } from 'react';
import { openExternalUrl } from '../../host/nativeActions';

const markdown = new MarkdownIt({
	html: false,
	linkify: true,
	breaks: false,
}).disable('image');

export function renderBotMarkdown(text: string): string {
	return markdown.render(text);
}

export function handleBotMarkdownClick(event: MouseEvent<HTMLElement>): void {
	if (!(event.target instanceof Element)) return;
	const anchor = event.target.closest('a');
	if (!anchor) return;
	event.preventDefault();
	const href = anchor.getAttribute('href');
	if (href && /^https?:\/\//i.test(href)) void openExternalUrl(href);
}
