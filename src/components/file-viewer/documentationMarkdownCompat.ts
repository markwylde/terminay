const VOID_ELEMENTS =
	'area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr';

// `[^>]*?` also matches quoted attribute values; a `>` inside quotes is rare
// enough in documentation that the simple form is the right trade-off.
const OPEN_VOID_TAG = new RegExp(
	`<(${VOID_ELEMENTS})(\\s[^>]*?)?\\s*(?<!/)>`,
	'giu',
);
const HAS_VOID_TAG = new RegExp(`<(?:${VOID_ELEMENTS})\\b`, 'iu');
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

/**
 * The editor parses Markdown as MDX, where an HTML void element such as
 * `<img src="a.svg">` is an unclosed JSX tag and fails the whole document.
 * Self-close those tags outside code so plain GitHub-style Markdown opens.
 */
export function selfCloseVoidHtmlElements(markdown: string): string {
	if (!HAS_VOID_TAG.test(markdown)) return markdown;
	let fence: string | undefined;
	return markdown
		.split('\n')
		.map((line) => {
			const marker = FENCE.exec(line)?.[1];
			if (fence !== undefined) {
				if (
					marker !== undefined &&
					marker[0] === fence[0] &&
					marker.length >= fence.length &&
					line.trim() === marker
				)
					fence = undefined;
				return line;
			}
			if (marker !== undefined) {
				fence = marker;
				return line;
			}
			return line
				.split(/(`+[^`]*`+)/u)
				.map((part, index) =>
					index % 2 === 1
						? part
						: part.replace(
								OPEN_VOID_TAG,
								(_, name: string, attributes = '') =>
									`<${name}${attributes.trimEnd()} />`,
							),
				)
				.join('');
		})
		.join('\n');
}
