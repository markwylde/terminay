import { expect, test } from './fixtures'

test('renderer receives the embedded server client context', async ({ mainWindow }) => {
  await expect.poll(() => mainWindow.evaluate(() => (
    (window as Window & { __terminayServerClientState?: string }).__terminayServerClientState ?? 'pending'
  ))).toBe('connected')
})
