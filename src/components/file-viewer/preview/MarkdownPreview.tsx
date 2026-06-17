import hljs from 'highlight.js/lib/common'
import MarkdownIt from 'markdown-it'
import { escapeHtml } from 'markdown-it/lib/common/utils.mjs'
import type { RenderRule } from 'markdown-it/lib/renderer.mjs'
import type StateCore from 'markdown-it/lib/rules_core/state_core.mjs'
import type Token from 'markdown-it/lib/token.mjs'
import { type MouseEvent, useMemo } from 'react'

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

function tableWrapPlugin(md: MarkdownIt) {
  const renderToken: RenderRule = (tokens, index, options, _env, self) =>
    self.renderToken(tokens, index, options)
  const renderTableOpen = md.renderer.rules.table_open ?? renderToken
  const renderTableClose = md.renderer.rules.table_close ?? renderToken

  md.renderer.rules.table_open = (tokens, index, options, env, self) =>
    `<div class="file-preview-markdown__table-wrap">${renderTableOpen(tokens, index, options, env, self)}`

  md.renderer.rules.table_close = (tokens, index, options, env, self) =>
    `${renderTableClose(tokens, index, options, env, self)}</div>`
}

function highlightCode(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      const highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value
      return `<pre><code class="hljs language-${escapeHtml(language)}">${highlighted}</code></pre>`
    } catch {
      // Fall through to the escaped, unhighlighted output below.
    }
  }

  return `<pre><code class="hljs">${escapeHtml(code)}</code></pre>`
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight: highlightCode,
})
  .use(taskListPlugin)
  .use(tableWrapPlugin)

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

function handlePreviewClick(event: MouseEvent<HTMLElement>) {
  if (!(event.target instanceof Element)) {
    return
  }

  const anchor = event.target.closest('a')
  const href = anchor?.getAttribute('href')

  if (!href || href.startsWith('#')) {
    return
  }

  if (/^(https?|mailto):/i.test(href)) {
    event.preventDefault()
    void window.terminay?.openExternal(href)
    return
  }

  if (href.startsWith('file://')) {
    event.preventDefault()
    try {
      const filePath = decodeURIComponent(new URL(href).pathname)
      window.dispatchEvent(new CustomEvent('terminay-open-file', { detail: { path: filePath } }))
    } catch {
      // Ignore malformed file URLs.
    }
  }
}

export function MarkdownPreview({ basePath, text }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    return normalizeRelativeUrls(markdown.render(normalizeTaskListMarkers(text)), basePath)
  }, [basePath, text])

  return (
    <article
      className="file-preview-markdown"
      onClick={handlePreviewClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
