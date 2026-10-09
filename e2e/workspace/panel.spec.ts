import { test, expect } from '@playwright/test';

test('workspace: shared files, safe editing, uploads/downloads and a persistent terminal', async ({
  page,
}, testInfo) => {
  test.setTimeout(45000);
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('/c/new');
  await page.getByTestId('nav-panel-workspace').click();
  const panel = page.getByRole('region', { name: 'Workspace', exact: true });
  await expect(panel.getByRole('button', { name: 'readme.txt', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'readme.txt', exact: true }).click();
  const editor = panel.getByRole('textbox', { name: 'Text file editor' });
  await expect(editor).toHaveValue('Shared workspace\n');
  await editor.fill('Edited in LibreChat\n');
  await panel.getByRole('button', { name: 'Save file', exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'File saved.' })).toBeVisible();
  await panel.getByRole('button', { name: 'Reload file' }).click();
  await expect(editor).toHaveValue('Edited in LibreChat\n');
  await panel.locator('input[type=file]').setInputFiles({
    name: 'uploaded.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Upload preserved\n'),
  });
  await expect(panel.getByRole('button', { name: 'uploaded.txt', exact: true })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download uploaded.txt', exact: true }).click();
  const result = await downloaded;
  expect(result.suggestedFilename()).toBe('uploaded.txt');
  const stream = await result.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe('Upload preserved\n');
  await panel.getByRole('button', { name: 'image.bin', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('not an editable UTF-8');
  await panel.getByRole('button', { name: 'readme.txt', exact: true }).click();
  await expect(editor).toHaveValue('Edited in LibreChat\n');
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Close terminal', exact: true })).toBeVisible();
  await page.keyboard.type('echo workspace');
  await page.keyboard.press('Enter');
  await expect(panel.locator('.xterm-accessibility-tree')).toContainText(
    'workspace terminal ready',
  );
  await page.getByTestId('nav-panel-conversations').click();
  await expect(panel).toBeHidden();
  await page.getByTestId('nav-panel-workspace').click();
  await expect(panel.getByRole('button', { name: 'Close terminal', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('color-theme', 'dark'));
  await page.reload();
  await panel.getByRole('button', { name: 'readme.txt', exact: true }).click();
  await panel.getByRole('button', { name: 'Open terminal', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Close terminal', exact: true })).toBeVisible();
  await page.keyboard.type('echo workspace');
  await page.keyboard.press('Enter');
  await expect(panel.locator('.xterm-accessibility-tree')).toContainText(
    'workspace terminal ready',
  );
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Close terminal', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByRole('button', { name: 'Open sidebar', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Workspace', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-dark.png'), fullPage: true });
  expect(failures).toEqual([]);
});
