import MarkdownIt from 'markdown-it';

// Release notes arrive over the network, so they are rendered as untrusted
// Markdown: raw HTML is escaped (`html: false`), markdown-it's link validator
// rejects script-capable URL schemes, and images are rendered as their alt
// text so opening the dialog never loads a remote resource.
const releaseNotesMarkdown = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: true,
}).disable('image');

export function renderReleaseNotesHtml(markdown: string): string {
	return releaseNotesMarkdown.render(markdown);
}

/** Only web links leave the dialog, and only through the host's browser. */
export function releaseNoteLinkTarget(href: string | null): string | null {
	if (href === null) return null;
	return /^https?:\/\//i.test(href) ? href : null;
}
