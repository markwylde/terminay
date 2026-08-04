import type { ReactNode } from 'react'

export type CodeLanguage =
  | 'javascript'
  | 'typescript'
  | 'javascriptreact'
  | 'typescriptreact'
  | 'yaml'

const JS_TS_KEYWORDS = new Set([
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'is',
  'keyof',
  'let',
  'module',
  'namespace',
  'new',
  'null',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const JSX_ATTRIBUTE_NAMES = new Set([
  'aria-hidden',
  'className',
  'disabled',
  'href',
  'id',
  'key',
  'name',
  'onChange',
  'onClick',
  'placeholder',
  'ref',
  'role',
  'src',
  'style',
  'tabIndex',
  'title',
  'type',
  'value',
])

const YAML_KEYWORDS = new Set(['false', 'no', 'null', 'off', 'on', 'true', 'yes', '~'])

export function languageFromFilePath(filePath: string): string | undefined {
  const extension = filePath.toLowerCase().split('.').pop()
  switch (extension) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'typescriptreact'
    case 'js':
      return 'javascript'
    case 'jsx':
      return 'javascriptreact'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
      return 'markdown'
    case 'yml':
    case 'yaml':
      return 'yaml'
    case 'sh':
      return 'shell'
    default:
      return extension
  }
}

function isCodeLanguage(language: string | undefined): language is CodeLanguage {
  return (
    language === 'javascript' ||
    language === 'typescript' ||
    language === 'javascriptreact' ||
    language === 'typescriptreact' ||
    language === 'yaml'
  )
}

export function isHighlightedCodeLanguage(language: string | undefined): language is CodeLanguage {
  return isCodeLanguage(language)
}

function isIdentifierStart(character: string) {
  return /[A-Za-z_$]/.test(character)
}

function isIdentifierPart(character: string) {
  return /[A-Za-z0-9_$]/.test(character)
}

function isNumberStart(character: string) {
  return /[0-9]/.test(character)
}

function tokenizeCodeLine(line: string, language: CodeLanguage) {
  const tokens: Array<{ type: string; value: string }> = []
  let index = 0
  const supportsJsx = language === 'javascriptreact' || language === 'typescriptreact'

  const push = (type: string, value: string) => {
    if (value.length > 0) {
      tokens.push({ type, value })
    }
  }

  while (index < line.length) {
    const character = line[index]
    const nextCharacter = line[index + 1] ?? ''

    if (character === '/' && nextCharacter === '/') {
      push('comment', line.slice(index))
      break
    }

    if (character === '/' && nextCharacter === '*') {
      const endIndex = line.indexOf('*/', index + 2)
      const value = endIndex === -1 ? line.slice(index) : line.slice(index, endIndex + 2)
      push('comment', value)
      index += value.length
      continue
    }

    if (character === '\'' || character === '"' || character === '`') {
      const quote = character
      let cursor = index + 1
      while (cursor < line.length) {
        const current = line[cursor]
        if (current === '\\') {
          cursor += 2
          continue
        }
        cursor += 1
        if (current === quote) {
          break
        }
      }
      push('string', line.slice(index, cursor))
      index = cursor
      continue
    }

    if (supportsJsx && character === '<' && /[A-Za-z/_>]/.test(nextCharacter)) {
      push('tag-punctuation', character)
      index += 1

      if (line[index] === '/') {
        push('tag-punctuation', '/')
        index += 1
      }

      const tagStart = index
      while (index < line.length && /[A-Za-z0-9_.-]/.test(line[index])) {
        index += 1
      }
      push('tag-name', line.slice(tagStart, index))
      continue
    }

    if (supportsJsx && (character === '>' || character === '/')) {
      push('tag-punctuation', character)
      index += 1
      continue
    }

    if (supportsJsx && isIdentifierStart(character)) {
      const start = index
      index += 1
      while (index < line.length && isIdentifierPart(line[index])) {
        index += 1
      }
      const value = line.slice(start, index)
      if (JSX_ATTRIBUTE_NAMES.has(value) && line.slice(index).trimStart().startsWith('=')) {
        push('attribute-name', value)
      } else if (JS_TS_KEYWORDS.has(value)) {
        push('keyword', value)
      } else {
        push('plain', value)
      }
      continue
    }

    if (!supportsJsx && isIdentifierStart(character)) {
      const start = index
      index += 1
      while (index < line.length && isIdentifierPart(line[index])) {
        index += 1
      }
      const value = line.slice(start, index)
      push(JS_TS_KEYWORDS.has(value) ? 'keyword' : 'plain', value)
      continue
    }

    if (isNumberStart(character)) {
      const start = index
      index += 1
      while (index < line.length && /[0-9._xXa-fA-F]/.test(line[index])) {
        index += 1
      }
      push('number', line.slice(start, index))
      continue
    }

    push('plain', character)
    index += 1
  }

  return tokens
}

function findYamlCommentStart(line: string) {
  let quote: string | null = null

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]

    if (quote) {
      if (character === '\\' && quote === '"') {
        index += 1
        continue
      }

      if (character === quote) {
        quote = null
      }

      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
      continue
    }

    if (character === '#') {
      return index
    }
  }

  return -1
}

function findYamlMappingColon(line: string) {
  let quote: string | null = null

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1] ?? ''

    if (quote) {
      if (character === '\\' && quote === '"') {
        index += 1
        continue
      }

      if (character === quote) {
        quote = null
      }

      continue
    }

    if (character === '"' || character === '\'') {
      quote = character
      continue
    }

    if (character === ':' && (nextCharacter === '' || /\s/.test(nextCharacter))) {
      return index
    }
  }

  return -1
}

function tokenizeYamlScalar(value: string) {
  const tokens: Array<{ type: string; value: string }> = []
  let index = 0

  const push = (type: string, tokenValue: string) => {
    if (tokenValue.length > 0) {
      tokens.push({ type, value: tokenValue })
    }
  }

  while (index < value.length) {
    const character = value[index]

    if (character === '"' || character === '\'') {
      const quote = character
      let cursor = index + 1

      while (cursor < value.length) {
        const current = value[cursor]

        if (current === '\\' && quote === '"') {
          cursor += 2
          continue
        }

        cursor += 1

        if (current === quote) {
          break
        }
      }

      push('string', value.slice(index, cursor))
      index = cursor
      continue
    }

    if (/[0-9-]/.test(character)) {
      const match = value.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/i)

      if (match) {
        push('number', match[0])
        index += match[0].length
        continue
      }
    }

    if (/[A-Za-z~]/.test(character)) {
      const match = value.slice(index).match(/^[A-Za-z_~][A-Za-z0-9_-]*/)

      if (match) {
        const tokenValue = match[0]
        push(YAML_KEYWORDS.has(tokenValue.toLowerCase()) ? 'keyword' : 'plain', tokenValue)
        index += tokenValue.length
        continue
      }
    }

    if (/[[\]{},|>&*-]/.test(character)) {
      push('punctuation', character)
      index += 1
      continue
    }

    push('plain', character)
    index += 1
  }

  return tokens
}

function tokenizeYamlLine(line: string) {
  const tokens: Array<{ type: string; value: string }> = []
  const commentStart = findYamlCommentStart(line)
  const content = commentStart === -1 ? line : line.slice(0, commentStart)
  const comment = commentStart === -1 ? '' : line.slice(commentStart)
  const mappingColon = findYamlMappingColon(content)

  const push = (type: string, value: string) => {
    if (value.length > 0) {
      tokens.push({ type, value })
    }
  }

  if (mappingColon !== -1) {
    const prefix = content.slice(0, mappingColon)
    const value = content.slice(mappingColon + 1)
    const keyMatch = prefix.match(/^(\s*)(-\s*)?(.*)$/)

    if (keyMatch) {
      push('plain', keyMatch[1] ?? '')
      push('punctuation', keyMatch[2] ?? '')
      push('property', keyMatch[3] ?? '')
    } else {
      push('property', prefix)
    }

    push('punctuation', ':')
    tokens.push(...tokenizeYamlScalar(value))
  } else {
    tokens.push(...tokenizeYamlScalar(content))
  }

  push('comment', comment)

  return tokens
}

export function renderHighlightedCode(line: string, filePath: string): ReactNode {
  const language = languageFromFilePath(filePath)
  if (!isCodeLanguage(language)) {
    return line
  }

  let tokenOffset = 0
  const tokens = language === 'yaml' ? tokenizeYamlLine(line) : tokenizeCodeLine(line, language)

  return tokens.map((token) => {
    if (token.type === 'plain') {
      tokenOffset += token.value.length
      return token.value
    }

    const key = `${token.type}-${tokenOffset}-${token.value}`
    tokenOffset += token.value.length

    return (
      <span key={key} className={`file-token file-token--${token.type}`}>
        {token.value}
      </span>
    )
  })
}

export function renderHighlightedCodeBlock(text: string, filePath: string): ReactNode {
  let lineOffset = 0

  return text.split('\n').map((line, index, lines) => (
    (() => {
      const lineNumber = index + 1
      const key = `line-${lineNumber}-${lineOffset}`
      lineOffset += line.length + 1
      return (
        <span key={key} className="file-code-block__line">
          <span className="file-code-block__line-number">{lineNumber}</span>
          <span className="file-code-block__line-content">
            {renderHighlightedCode(line, filePath)}
            {index < lines.length - 1 ? '\n' : null}
          </span>
        </span>
      )
    })()
  ))
}
