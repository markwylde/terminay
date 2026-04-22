import { expect, test } from './fixtures'

test.describe('project tabs', () => {
  test('adds, edits, switches, and closes project tabs', async ({ createWorkspace, mainWindow }) => {
    const workspace = await createWorkspace({ name: 'project-tab-root' })
    const initialProjectTab = mainWindow.locator('.project-tab').first()
    await expect(initialProjectTab).toContainText('Project 1')

    await mainWindow.getByLabel('Add project tab').click()
    await expect(mainWindow.locator('.project-tab')).toHaveCount(2)
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 2')

    await mainWindow.locator('.project-tab').nth(1).dblclick()
    const editDialog = mainWindow.locator('.project-edit-modal')
    await expect(editDialog.getByRole('heading', { name: 'Edit Project Tab' })).toBeVisible()

    await editDialog.getByPlaceholder('Project name').fill('Workspace QA')
    await editDialog.locator('label').filter({ hasText: 'Root Folder' }).locator('input[type="text"]').fill(workspace.rootDir)
    await editDialog.locator('.hue-slider').fill('120')
    await editDialog.getByRole('button', { name: 'Save' }).click()

    const updatedProjectTab = mainWindow.locator('.project-tab').nth(1)
    await expect(updatedProjectTab).toContainText('Workspace QA')
    await expect(updatedProjectTab).toHaveAttribute('style', /#57db57/i)

    await initialProjectTab.click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Project 1')

    await updatedProjectTab.click()
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Workspace QA')

    await initialProjectTab.getByLabel('Close Project 1').click()
    await expect(mainWindow.locator('.project-tab')).toHaveCount(1)
    await expect(mainWindow.locator('.project-tab--active')).toContainText('Workspace QA')
  })
})
