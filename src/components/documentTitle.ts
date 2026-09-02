const FRONTMATTER_TITLE =
	/^(?:---\r?\n)[\s\S]{0,32768}?^title\s*:\s*['"]?([^\r\n'"]+)['"]?\s*$/mu;

export function titleCase(value: string): string {
	return value
		.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
		.replace(/([a-z\d])([A-Z])/gu, '$1 $2')
		.replace(/[_\-.]+/gu, ' ')
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((word) => word.slice(0, 1).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
		.join(' ');
}

export function filenameTitle(filePath: string): string {
	const name =
		filePath.split(/[\\/]/u).at(-1)?.replace(/\.mdx?$/iu, '') ?? filePath;
	return titleCase(name);
}

export function documentDisplayTitle(markdown: string, filePath: string): string {
	const title = FRONTMATTER_TITLE.exec(markdown)?.[1]?.trim();
	return title || filenameTitle(filePath);
}

export function documentTreeAccessibleName(
	title: string,
	relativePath: string,
): string {
	return title === filenameTitle(relativePath) ? title : `${title}, ${relativePath}`;
}
