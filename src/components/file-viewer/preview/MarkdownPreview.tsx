import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

type MarkdownPreviewProps = {
  basePath: string
  text: string
}

function normalizeRelativeUrls(html: string, basePath: string): string {
  return html.replace(/(src|href)="(?![a-z]+:|#|\/)([^"]+)"/gi, (_match, attribute, relativePath) => {
    const resolvedPath = `${basePath}/${relativePath}`.replace(/\/{2,}/g, '/')
    return `${attribute}="file://${resolvedPath}"`
  })
}

export function MarkdownPreview({ basePath, text }: MarkdownPreviewProps) {
  const html = normalizeRelativeUrls(markdown.render(text), basePath)
  // biome-ignore lint/security/noDangerouslySetInnerHtml: We render markdown which produces HTML
  return <article className="file-preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
