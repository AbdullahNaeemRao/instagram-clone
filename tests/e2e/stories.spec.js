const { test, expect } = require('@playwright/test');
const { accounts, OCR_FIXTURE_IMAGE } = require('./helpers/accounts');
const { login } = require('./helpers/session');
const { query, waitFor } = require('./helpers/db');

test('user can upload, view, and delete their own story', async ({ page }) => {
  test.setTimeout(180000);

  await login(page, accounts.poetry);

  await page.getByTestId('story-bubble-own').click();
  await expect(page.getByTestId('story-upload-modal')).toBeVisible();
  await page.getByTestId('story-upload-input').setInputFiles(OCR_FIXTURE_IMAGE);
  await page.getByTestId('story-upload-submit').click();
  await expect(page.getByTestId('story-upload-modal')).toHaveCount(0);

  const storyId = await waitFor(async () => {
    const result = await query(
      `SELECT s.id
       FROM stories s
       JOIN users u ON u.id = s.user_id
       WHERE u.email = $1
         AND s.created_at >= NOW() - INTERVAL '24 HOURS'
       ORDER BY s.id DESC
       LIMIT 1`,
      [accounts.poetry.email]
    );
    return result.rows[0]?.id || null;
  }, { timeout: 30000, interval: 1000, message: 'uploaded story' });

  await page.reload();
  await expect(page.getByTestId('home-feed')).toBeVisible();

  await page.getByTestId('story-bubble-own').click();
  await expect(page.getByTestId('story-viewer')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByTestId('story-delete').click();

  await waitFor(async () => {
    const result = await query('SELECT 1 FROM stories WHERE id = $1', [storyId]);
    return result.rows.length === 0 ? true : null;
  }, { timeout: 30000, interval: 1000, message: 'deleted story' });

  await expect(page.getByTestId('story-viewer')).toHaveCount(0);
  await expect(page.getByTestId('home-feed')).toBeVisible();
});
