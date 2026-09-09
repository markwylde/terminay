import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The file the hosted UI archive loader reads to serve a workspace.
 *
 * `loadHostedUiArchive` defaults to this name, and an embedded server passes
 * the directory that contains it. A standalone archive that stages a UI bundle
 * without it pairs a device successfully and then serves a placeholder — which
 * looks like a rendering fault from the device and like a healthy server from
 * the host, because every transport signal is green.
 *
 * Keeping the name here, and checking it at both build and probe time, is what
 * stops an artifact shipping a UI its own server cannot serve.
 */
export const HOSTED_UI_ENTRY = 'server.html'

export async function assertHostedUiEntry(uiDirectory, entry = HOSTED_UI_ENTRY) {
  const path = join(uiDirectory, entry)
  const info = await lstat(path).catch(() => undefined)
  if (info === undefined || !info.isFile()) {
    throw new Error(
      `staged web UI bundle has no hosted archive entry: ${entry} is missing from ${uiDirectory}. The standalone artifact must stage the server-served workspace UI (dist-web), not the Desktop renderer bundle (dist).`,
    )
  }
  return path
}
