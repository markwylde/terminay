import type { McpServerCommand } from './index'

/** The Codex TOML table name we register. */
export const CODEX_TABLE = 'mcp_servers.terminay'

/**
 * Matches the `[mcp_servers.terminay]` table header on its own line, allowing
 * optional surrounding whitespace. Used both to detect installation and to
 * locate the block for replacement/removal.
 */
export const CODEX_HEADER_RE = /^[ \t]*\[mcp_servers\.terminay\][ \t]*$/m

/** Escape a string value for embedding inside a TOML basic (double-quoted) string. */
function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Render a TOML array of quoted strings, e.g. `["a", "b"]`. */
function renderTomlStringArray(values: string[]): string {
  const items = values.map((value) => `"${escapeTomlString(value)}"`)
  return `[${items.join(', ')}]`
}

/** Render an inline TOML table of string values, e.g. `{ A = "1" }`. */
function renderTomlInlineTable(values: Record<string, string>): string {
  const pairs = Object.entries(values).map(
    ([key, value]) => `${key} = "${escapeTomlString(value)}"`,
  )
  return `{ ${pairs.join(', ')} }`
}

/**
 * Build the `[mcp_servers.terminay]` block for the given launch command. The
 * returned string has no trailing newline.
 */
export function renderCodexBlock(server: McpServerCommand): string {
  const lines = [
    '[mcp_servers.terminay]',
    `command = "${escapeTomlString(server.command)}"`,
    `args = ${renderTomlStringArray(server.args)}`,
  ]
  if (server.env !== undefined) {
    lines.push(`env = ${renderTomlInlineTable(server.env)}`)
  }
  return lines.join('\n')
}

/** True when the content contains a `[mcp_servers.terminay]` table header. */
export function hasCodexBlock(content: string): boolean {
  return CODEX_HEADER_RE.test(content)
}

/**
 * Locate the `[mcp_servers.terminay]` block within `content`. Returns the
 * `[start, end)` line offsets (into the array of lines) or `null` if absent.
 * The block runs from its header up to (but not including) the next line that
 * begins a new table (`[`), or to EOF.
 */
function findCodexBlock(lines: string[]): { start: number; end: number } | null {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (CODEX_HEADER_RE.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) {
    return null
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[ \t]*\[/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

/**
 * Insert or replace the `[mcp_servers.terminay]` block in `content`. When the
 * block is absent it is appended; when present, only that block is swapped and
 * the rest of the file is preserved verbatim.
 */
export function upsertCodexBlock(content: string, block: string): string {
  const blockLines = block.split('\n')

  if (content.length === 0) {
    return `${block}\n`
  }

  const lines = content.split('\n')
  const found = findCodexBlock(lines)

  if (found) {
    const next = [...lines.slice(0, found.start), ...blockLines, ...lines.slice(found.end)]
    return next.join('\n')
  }

  // Append, ensuring a blank line separates the new block from existing content.
  const trimmed = content.replace(/\n+$/, '')
  return `${trimmed}\n\n${block}\n`
}

/**
 * Remove the `[mcp_servers.terminay]` block from `content`, preserving the rest
 * of the file. Idempotent: returns `content` unchanged when no block exists.
 */
export function removeCodexBlock(content: string): string {
  const lines = content.split('\n')
  const found = findCodexBlock(lines)
  if (!found) {
    return content
  }
  const next = [...lines.slice(0, found.start), ...lines.slice(found.end)]
  // Collapse the gap left behind: trim a leading blank line if we removed a
  // block that was preceded by one, then normalise trailing whitespace.
  return next.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '\n')
}
