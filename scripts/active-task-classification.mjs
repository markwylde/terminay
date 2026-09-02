import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const OPERATIONAL_ONLY_PATTERNS = Object.freeze([
  /\bdeploy (?:the )?(?:public|hosted|production) (?:host|service|site|environment)\b/iu,
  /\bpublish (?:signed |verified )?(?:desktop |standalone |release )?artifacts?\b/iu,
  /\bnotari[sz]e\b/iu,
  /\brun (?:the )?(?:complete )?.*\bnative (?:release )?runners?\b/iu,
  /\b(?:acquire|collect|produce|record|supply) .*\b(?:hosted|physical|native-runner) evidence\b/iu,
])

export function classifyUncheckedItem(text) {
  const pattern = OPERATIONAL_ONLY_PATTERNS.find((candidate) => candidate.test(text))
  return pattern === undefined
    ? Object.freeze({ operationalOnly: false })
    : Object.freeze({ operationalOnly: true, pattern: pattern.source })
}

export async function auditActiveTaskClassifications(root = process.cwd()) {
  const changesDirectory = join(root, 'openspec/changes')
  const taskFiles = (await readdir(changesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => `${entry.name}/tasks.md`)
    .sort()
  const violations = []

  for (const file of taskFiles) {
    const text = await readFile(join(changesDirectory, file), 'utf8')
    const lines = text.split(/\r?\n/u)
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^\s*-\s+\[\s\]\s+(.+)$/u.exec(lines[index])
      if (match === null) continue
      const itemText = readChecklistTitle(lines, index, match[1])
      const classification = classifyUncheckedItem(itemText)
      if (!classification.operationalOnly) continue
      violations.push(Object.freeze({
        file: `openspec/changes/${file}`,
        line: index + 1,
        text: itemText,
        pattern: classification.pattern,
      }))
    }
  }

  return Object.freeze({
    taskFiles: Object.freeze(taskFiles.map((file) => `openspec/changes/${file}`)),
    violations: Object.freeze(violations),
  })
}

function readChecklistTitle(lines, startIndex, firstLine) {
  const parts = [firstLine.trim()]
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/[.!?]$/u.test(parts.at(-1))) break
    const line = lines[index]
    if (
      line.trim() === ''
      || /^\s*(?:#{1,6}\s|-\s+\[[ xX]\]\s)/u.test(line)
      || !/^\s{2,}\S/u.test(line)
    ) break
    parts.push(line.trim())
  }
  return parts.join(' ')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await auditActiveTaskClassifications()
  if (report.violations.length > 0) {
    for (const violation of report.violations) {
      console.error(`${violation.file}:${violation.line}: operational-only unchecked checkbox: ${violation.text}`)
    }
    process.exitCode = 1
  }
}
