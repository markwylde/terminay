import { expect, test } from './fixtures'
import { sendAppCommand } from './support/app'

test('a completed new-terminal command exposes only its active presentation', async ({
  mainWindow,
}) => {
  await sendAppCommand(mainWindow, 'new-terminal')

  const tabs = mainWindow.locator('.terminal-tab-content')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.filter({ hasText: 'Terminal 2' })).toHaveClass(
    /terminal-tab-content--active/,
  )

  const visiblePanels = mainWindow.locator('.terminal-panel:visible')
  await expect(visiblePanels).toHaveCount(1)
  await expect(visiblePanels).toHaveAttribute(
    'data-terminay-terminal-session-id',
    /.+/,
  )
})
