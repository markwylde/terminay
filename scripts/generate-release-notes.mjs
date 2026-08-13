import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { requestReleaseNotes } from './release-notes-openrouter.mjs'

const tag = process.argv[2]
const execFileAsync = promisify(execFile)

if (!tag) {
  console.error('Missing release tag argument')
  process.exit(1)
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error('OPENROUTER_API_KEY is required to generate AI release notes')
  process.exit(1)
}

async function runGit(args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  })

  return stdout.trim()
}

async function getPreviousTag(targetTag) {
  const stdout = await runGit(['tag', '--list', 'v*', '--sort=-version:refname'])
  const tags = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const tagIndex = tags.indexOf(targetTag)

  if (tagIndex === -1) {
    throw new Error(`Release tag ${targetTag} does not exist locally`)
  }

  return tags[tagIndex + 1] ?? null
}

async function getReleaseContext(targetTag) {
  const previousTag = await getPreviousTag(targetTag)
  const range = previousTag ? `${previousTag}..${targetTag}` : targetTag
  const commitRange = previousTag ? range : targetTag
  const diffRange = previousTag
    ? [range]
    : [await runGit(['hash-object', '-t', 'tree', '/dev/null']), targetTag]
  const [commits, changedFiles, diffStat] = await Promise.all([
    runGit(['log', '--reverse', '--format=%h %s', commitRange]),
    runGit(['diff', '--name-only', ...diffRange]),
    runGit(['diff', '--stat', ...diffRange]),
  ])

  return {
    previousTag,
    range,
    commits: commits || '(no commits found)',
    changedFiles: changedFiles || '(no changed files found)',
    diffStat: diffStat || '(no diff stat available)',
  }
}

const promptPath = resolve(
  process.cwd(),
  '.github/prompts/github-create-release.md',
)

const releaseContext = await getReleaseContext(tag)
const instructions = await readFile(promptPath, 'utf8')
const message = [
  'Generate the markdown changelog body for Terminay release',
  tag,
  '.',
  `Only summarize changes in ${releaseContext.range}.`,
  releaseContext.previousTag
    ? `The previous release tag is ${releaseContext.previousTag}.`
    : 'There is no previous release tag.',
  'Do not include features, fixes, or dependency updates from earlier releases.',
  'Write the markdown changelog body to RELEASE.md with no extra text.',
  '',
  'Allowed release context:',
  '',
  `Target tag: ${tag}`,
  `Previous tag: ${releaseContext.previousTag ?? '(none)'}`,
  `Git range: ${releaseContext.range}`,
  '',
  'Commits in range:',
  releaseContext.commits,
  '',
  'Changed files in range:',
  releaseContext.changedFiles,
  '',
  'Diff stat:',
  releaseContext.diffStat,
].join('\n')

const notes = await requestReleaseNotes({
  apiKey: process.env.OPENROUTER_API_KEY,
  instructions,
  message,
})

const releasePath = resolve(process.cwd(), 'RELEASE.md')
await writeFile(releasePath, notes, { mode: 0o600 })
