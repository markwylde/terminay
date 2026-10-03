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

  // JSON highlighting is a tokenizer here, not Monaco's JSON language service,
  // so no JSON worker is bundled or started.
  if (!monaco.languages.getLanguages().some((language: { id: string }) => language.id === 'json')) {
    monaco.languages.register({
      id: 'json',
      aliases: ['JSON', 'json'],
      extensions: ['.json', '.jsonc', '.babelrc', '.eslintrc', '.prettierrc'],
      mimetypes: ['application/json'],
    })
  }
  monaco.languages.setLanguageConfiguration('json', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '"', close: '"', notIn: ['string'] },
    ],
  })
  monaco.languages.setMonarchTokensProvider('json', {
    tokenPostfix: '.json',
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'key'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
        [/\b(?:true|false|null)\b/, 'keyword'],
        [/[{}\[\]]/, '@brackets'],
        [/[,:]/, 'delimiter'],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/\s+/, 'white'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  })

  if (!didDefineTheme) {
    didDefineTheme = true
    monaco.editor.defineTheme(FILE_VIEWER_THEME, {
      base: 'vs-dark',
      inherit: true,
      // Mirrors the Preview palette (`.file-token--*` in fileViewer.css) so
      // switching between Preview and Text does not recolour the file.
      rules: [
        { token: '', foreground: 'dce2f0' },
        { token: 'identifier', foreground: 'dce2f0' },
        { token: 'type.identifier', foreground: 'dce2f0' },
        { token: 'key', foreground: '7cc7ff' },
        { token: 'key.yaml', foreground: '7cc7ff' },
        { token: 'type', foreground: '7cc7ff' },
        { token: 'type.yaml', foreground: '7cc7ff' },
        { token: 'tag', foreground: '7cc7ff' },
        { token: 'attribute.name', foreground: 'c792ea' },
        { token: 'attribute.value', foreground: 'c7e88d' },
        { token: 'string.key.json', foreground: '7cc7ff' },
        { token: 'string.value.json', foreground: 'c7e88d' },
        { token: 'delimiter', foreground: 'a5abb7' },
        { token: 'delimiter.yaml', foreground: 'a5abb7' },
        { token: 'operators', foreground: 'a5abb7' },
        { token: 'operators.yaml', foreground: 'a5abb7' },
        { token: 'string', foreground: 'c7e88d' },
        { token: 'string.yaml', foreground: 'c7e88d' },
        { token: 'regexp', foreground: 'c7e88d' },
        { token: 'keyword', foreground: 'ff8f70' },
        { token: 'keyword.yaml', foreground: 'ff8f70' },
        { token: 'number', foreground: 'f7c46c' },
        { token: 'number.yaml', foreground: 'f7c46c' },
        { token: 'comment', foreground: '6b7787' },
        { token: 'comment.yaml', foreground: '6b7787' },
      ],
      // The editor sits on the panel surface (`--tab-bg`), not vs-dark grey.
      colors: {
        'editor.background': '#0d1014',
        'editor.foreground': '#dce2f0',
        'editorGutter.background': '#0d1014',
        'editorStickyScroll.background': '#0d1014',
        'editorLineNumber.foreground': '#dce2f040',
        'editorLineNumber.activeForeground': '#dce2f0a6',
        'editor.lineHighlightBackground': '#ffffff08',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#57b7ff40',
        'editor.inactiveSelectionBackground': '#57b7ff26',
        'editorCursor.foreground': '#dce2f0',
        'editorIndentGuide.background1': '#ffffff0a',
        'editorIndentGuide.activeBackground1': '#ffffff1f',
        'editorWidget.background': '#15191f',
        'editorWidget.border': '#ffffff14',
        'editorHoverWidget.background': '#15191f',
        'editorHoverWidget.border': '#ffffff14',
        'editorOverviewRuler.border': '#00000000',
        'scrollbar.shadow': '#00000000',
        'scrollbarSlider.background': '#ffffff14',
        'scrollbarSlider.hoverBackground': '#ffffff26',
        'scrollbarSlider.activeBackground': '#ffffff33',
      },
    })
  }
}

export { FILE_VIEWER_THEME }
