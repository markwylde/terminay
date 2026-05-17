import type { Monaco } from '@monaco-editor/react'

const FILE_VIEWER_THEME = 'terminay-file-viewer-dark'
let didDefineTheme = false

export function configureFileViewerMonaco(monaco: Monaco) {
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === 'yaml')) {
    monaco.languages.register({
      id: 'yaml',
      aliases: ['YAML', 'yaml', 'YML', 'yml'],
      extensions: ['.yaml', '.yml'],
      mimetypes: ['application/x-yaml', 'text/yaml', 'text/x-yaml'],
    })
  }

  monaco.languages.setLanguageConfiguration('yaml', {
    comments: {
      lineComment: '#',
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: '\'', close: '\'' },
    ],
  })

  monaco.languages.setMonarchTokensProvider('yaml', {
    tokenPostfix: '.yaml',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.bracket' },
      { open: '[', close: ']', token: 'delimiter.square' },
    ],
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'comment'],
        [/^(\s*)(-\s*)([^:#\n][^:#\n]*?)(:)(?=\s|$)/, ['white', 'delimiter', 'type', 'delimiter']],
        [/^(\s*)([^:#\n][^:#\n]*?)(:)(?=\s|$)/, ['white', 'type', 'delimiter']],
        [/#.*$/, 'comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'[^']*'/, 'string'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/\b(?:true|false|yes|no|on|off|null|~)\b/i, 'keyword'],
        [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/i, 'number'],
        [/[{}[\],]/, 'delimiter'],
        [/[-?|>]/, 'delimiter'],
      ],
    },
  })

  if (!didDefineTheme) {
    didDefineTheme = true
    monaco.editor.defineTheme(FILE_VIEWER_THEME, {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'key.yaml', foreground: '7cc7ff' },
        { token: 'type.yaml', foreground: '7cc7ff' },
        { token: 'delimiter.yaml', foreground: 'dce2f0' },
        { token: 'operators.yaml', foreground: 'dce2f0' },
        { token: 'string.yaml', foreground: 'c7e88d' },
        { token: 'keyword.yaml', foreground: 'ff8f70' },
        { token: 'number.yaml', foreground: 'f7c46c' },
        { token: 'comment.yaml', foreground: '8b9bb5', fontStyle: 'italic' },
      ],
      colors: {},
    })
  }
}

export { FILE_VIEWER_THEME }
