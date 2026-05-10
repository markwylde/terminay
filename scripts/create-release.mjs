import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getNextVersion } from './release-utils.mjs'

const execFileAsync = promisify(execFile)

async function run(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
  })

  return stdout.trim()
}

async function getLatestTag() {
  const stdout = await run('git', ['tag', '--list', 'v*', '--sort=-version:refname'])
  return stdout.split('\n').map((line) => line.trim()).find(Boolean) ?? null
}

async function getCommitMessages(latestTag) {
  const args = latestTag
    ? ['log', `${latestTag}..HEAD`, '--format=%B%x1e']
    : ['log', '--format=%B%x1e']
  const stdout = await run('git', args)

  return stdout
    .split('\x1e')
    .map((message) => message.trim())
    .filter(Boolean)
}

async function tagExists(tag) {
  try {
    await execFileAsync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
      cwd: process.cwd(),
      env: process.env,
    })
    return true
  } catch {
    return false
  }
}

async function createGitHubRelease(tag) {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  const repository = process.env.GITHUB_REPOSITORY

  if (!token || !repository) {
    return
  }

  const releaseResponse = await fetch(`https://api.github.com/repos/${repository}/releases`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'terminay-release-script',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body: 'Release in progress.',
      draft: false,
      prerelease: false,
      generate_release_notes: false,
    }),
  })

  if (releaseResponse.ok) {
    return
  }

  if (releaseResponse.status === 422) {
    return
  }

  const error = await releaseResponse.text()
  throw new Error(`Failed to create GitHub release for ${tag}: ${error}`)
}

const latestTag = await getLatestTag()
const commitMessages = await getCommitMessages(latestTag)
const nextVersion = getNextVersion({
  latestTag,
  messages: commitMessages,
})

if (!nextVersion) {
  console.log('No release needed')
  process.exit(0)
}

const tag = `v${nextVersion}`

if (await tagExists(tag)) {
  console.log(`Tag ${tag} already exists`)
  process.exit(0)
}

await run('git', ['tag', tag])
await run('git', ['push', 'origin', tag])
await createGitHubRelease(tag)

console.log(`Created release ${tag}`)
