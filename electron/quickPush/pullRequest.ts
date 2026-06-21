export type RemoteWebInfo = {
  host: string | null
  owner: string | null
  repo: string | null
  webUrl: string | null
}

function trimGitSuffix(value: string): string {
  return value.replace(/\.git$/i, '').replace(/\/+$/, '')
}

function parsePathParts(pathname: string): { owner: string; repo: string } | null {
  const parts = pathname
    .replace(/^\/+/, '')
    .split('/')
    .filter((part) => part.length > 0)
  if (parts.length < 2) {
    return null
  }

  const owner = parts[parts.length - 2]
  const repo = trimGitSuffix(parts[parts.length - 1])
  return owner && repo ? { owner, repo } : null
}

export function parseRemoteWebInfo(remoteUrl: string): RemoteWebInfo {
  const trimmed = remoteUrl.trim()
  if (!trimmed) {
    return { host: null, owner: null, repo: null, webUrl: null }
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'ssh:') {
      const host = parsed.hostname
      const parts = parsePathParts(parsed.pathname)
      return {
        host,
        owner: parts?.owner ?? null,
        repo: parts?.repo ?? null,
        webUrl: parts ? `https://${host}/${parts.owner}/${parts.repo}` : null,
      }
    }
  } catch {
    // Fall through to the raw URL fallback below.
  }

  const scpLike = trimmed.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/)
  if (scpLike) {
    const host = scpLike[1]
    const parts = parsePathParts(scpLike[2])
    return {
      host,
      owner: parts?.owner ?? null,
      repo: parts?.repo ?? null,
      webUrl: parts ? `https://${host}/${parts.owner}/${parts.repo}` : null,
    }
  }

  return { host: null, owner: null, repo: null, webUrl: /^https?:\/\//.test(trimmed) ? trimGitSuffix(trimmed) : null }
}

export function isGithubRemote(remoteUrl: string): boolean {
  const host = parseRemoteWebInfo(remoteUrl).host?.toLowerCase()
  return host === 'github.com' || host === 'www.github.com'
}
