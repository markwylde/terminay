import MarkdownIt from 'markdown-it'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'

function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.after('inline', 'task_list_items', (state: StateCore) => {
    for (let index = 2; index < state.tokens.length; index += 1) {
      const token = state.tokens[index]
      const previousToken = state.tokens[index - 1]
      const listItemToken = state.tokens[index - 2]

      if (
        token.type !== 'inline' ||
        previousToken.type !== 'paragraph_open' ||
        listItemToken.type !== 'list_item_open' ||
        !token.children
      ) {
        continue
      }

      const taskMarkerMatch = token.content.match(/^\[( |x|X)?\]\s*/)

      if (!taskMarkerMatch) {
        continue
      }

      const isChecked = taskMarkerMatch[1]?.toLowerCase() === 'x'
      const checkboxToken = new state.Token('html_inline', '', 0)
      checkboxToken.content = `<input class="file-preview-markdown__task-checkbox" type="checkbox" disabled${isChecked ? ' checked' : ''}>`

      token.content = token.content.slice(taskMarkerMatch[0].length)
      token.children.unshift(checkboxToken)

      const firstTextToken = token.children.find((child: Token) => child.type === 'text')

      if (firstTextToken?.content.startsWith(taskMarkerMatch[0])) {
        firstTextToken.content = firstTextToken.content.slice(taskMarkerMatch[0].length)
      }

      listItemToken.attrJoin('class', 'file-preview-markdown__task-list-item')
    }
  })
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
}).use(taskListPlugin)

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

function normalizeTaskListMarkers(text: string): string {
  return text.replace(/^([ \t]{0,3}[*+-])\s*\[( |x|X)?\]/gm, (_match, bullet, checkedMarker = ' ') => {
    const normalizedMarker = checkedMarker.toLowerCase() === 'x' ? 'x' : ' '
    return `${bullet} [${normalizedMarker}]`
  })
}

export function MarkdownPreview({ basePath, text }: MarkdownPreviewProps) {
  const html = normalizeRelativeUrls(markdown.render(normalizeTaskListMarkers(text)), basePath)
  // biome-ignore lint/security/noDangerouslySetInnerHtml: We render markdown which produces HTML
  return <article className="file-preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />
}
